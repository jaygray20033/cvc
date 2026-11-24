import { Role, SHIPPING_STOP_SUGGESTIONS } from '@cvc/shared';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { AccessPayload } from '../common/decorators/current-user.decorator';
import { NotificationsService } from '../notifications/notifications.service';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SystemSettingsService } from '../settings/system-settings.service';
import type {
  AddShipmentStopInput,
  ConfirmReceiptInput,
  CreateShipmentInput,
  UpdateShipmentInput,
} from './shipments.dto';

// P4.19 C/D — carriers are external and entered by hand (D13). Supplier
// accounts enter factory→carrier milestones, sales/admin handle international,
// warehouse and domestic legs; the buyer reads the timeline and confirms
// receipt (which reuses the P4.16 SHIPPING → RECEIVED transition).
const SHIPMENT_NOT_FOUND = 'Vận đơn không tồn tại.';
const ORDER_NOT_FOUND = 'Đơn hàng không tồn tại.';

const SHIPMENT_INCLUDE = Prisma.validator<Prisma.ShipmentInclude>()({
  stops: { orderBy: { occurredAt: 'asc' } },
  order: {
    select: {
      id: true,
      orderNo: true,
      buyerId: true,
      supplierId: true,
      status: true,
      currency: true,
      supplier: { select: { accounts: { select: { userId: true } } } },
      dealRoom: { select: { id: true } },
    },
  },
});

type ShipmentWithRelations = Prisma.ShipmentGetPayload<{ include: typeof SHIPMENT_INCLUDE }>;
type OrderRef = ShipmentWithRelations['order'];
type ViewerRole = 'buyer' | 'supplier' | 'staff';

@Injectable()
export class ShipmentsService {
  private readonly logger = new Logger(ShipmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly orders: OrdersService,
    private readonly settings: SystemSettingsService,
  ) {}

  // POST /orders/:id/shipments
  async create(actor: AccessPayload, orderId: string, input: CreateShipmentInput) {
    const order = await this.loadOrder(orderId);
    const role = await this.resolveRole(order, actor);
    if (!role) throw new NotFoundException(ORDER_NOT_FOUND);
    if (role === 'buyer') {
      throw new ForbiddenException('Chỉ nhà cung cấp hoặc sales được nhập vận đơn.');
    }
    if (!['FINAL_PAYMENT', 'SHIPPING'].includes(order.status)) {
      throw new ConflictException({
        code: 'ORDER_NOT_READY_FOR_SHIPMENT',
        message: 'Đơn chưa thanh toán đủ hoặc chưa tới bước vận chuyển.',
      });
    }
    if (input.proofFileObjectId) {
      await this.assertFile(actor, input.proofFileObjectId);
    }

    const shipment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.shipment.create({
        data: {
          orderId,
          createdById: actor.sub,
          carrier: input.carrier,
          trackingNo: input.trackingNo,
          trackingUrl: input.trackingUrl ?? null,
          shippedAt: input.shippedAt ?? null,
          expectedAt: input.expectedAt ?? null,
          proofFileObjectId: input.proofFileObjectId ?? null,
          status: 'PREPARING',
        },
        include: SHIPMENT_INCLUDE,
      });
      await tx.orderEvent.create({
        data: {
          orderId,
          type: 'shipment.created',
          actorId: actor.sub,
          message: `Vận đơn ${input.carrier} · ${input.trackingNo}.`,
          data: {
            shipmentId: created.id,
            carrier: input.carrier,
            trackingNo: input.trackingNo,
            trackingUrl: input.trackingUrl ?? null,
            expectedAt: input.expectedAt?.toISOString() ?? null,
          },
        },
      });
      return created;
    });

    await this.notifyParties(order, 'shipment.created', {
      orderNo: order.orderNo,
      carrier: shipment.carrier,
      trackingNo: shipment.trackingNo,
    });
    this.emitRealtime(order.id, { shipmentId: shipment.id, status: shipment.status });
    this.logger.log({ orderId, shipmentId: shipment.id, actor: actor.sub }, 'shipment created');
    return this.view(shipment, role);
  }

  // PUT /shipments/:id
  async update(actor: AccessPayload, shipmentId: string, input: UpdateShipmentInput) {
    const shipment = await this.loadShipment(shipmentId);
    const role = await this.requireWriter(shipment, actor);
    if (['DELIVERED', 'RETURNED'].includes(shipment.status)) {
      throw this.conflict('SHIPMENT_CLOSED', 'Vận đơn đã kết thúc, không sửa được nữa.');
    }
    this.assertStatusMove(shipment.status, input.status);

    const deliveredAt =
      input.status === 'DELIVERED' ? (input.deliveredAt ?? new Date()) : input.deliveredAt;
    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.shipment.updateMany({
        where: { id: shipment.id, status: shipment.status },
        data: {
          ...(input.carrier !== undefined ? { carrier: input.carrier } : {}),
          ...(input.trackingNo !== undefined ? { trackingNo: input.trackingNo } : {}),
          ...(input.trackingUrl !== undefined ? { trackingUrl: input.trackingUrl } : {}),
          ...(input.shippedAt !== undefined ? { shippedAt: input.shippedAt } : {}),
          ...(input.expectedAt !== undefined ? { expectedAt: input.expectedAt } : {}),
          ...(deliveredAt !== undefined ? { deliveredAt } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
      });
      if (changed.count === 0) {
        throw this.conflict('INVALID_SHIPMENT_STATE', 'Vận đơn vừa được cập nhật bởi người khác.');
      }
      if (input.status === 'DELIVERED') {
        await tx.shipmentStop.create({
          data: {
            shipmentId: shipment.id,
            type: 'DELIVERED',
            occurredAt: deliveredAt ?? new Date(),
            description: 'Đã giao hàng.',
            enteredById: actor.sub,
          },
        });
      }
      await tx.orderEvent.create({
        data: {
          orderId: shipment.orderId,
          type: 'shipment.updated',
          actorId: actor.sub,
          message: `Cập nhật vận đơn ${shipment.trackingNo}.`,
          data: {
            shipmentId: shipment.id,
            status: input.status ?? shipment.status,
            carrier: input.carrier ?? shipment.carrier,
            trackingNo: input.trackingNo ?? shipment.trackingNo,
          },
        },
      });
      return tx.shipment.findUniqueOrThrow({
        where: { id: shipment.id },
        include: SHIPMENT_INCLUDE,
      });
    });

    if (input.status === 'DELIVERED') {
      await this.notifyParties(shipment.order, 'shipment.delivered', {
        orderNo: shipment.order.orderNo,
        carrier: updated.carrier,
        trackingNo: updated.trackingNo,
      });
    }
    this.emitRealtime(shipment.orderId, { shipmentId: shipment.id, status: updated.status });
    return this.view(updated, role);
  }

  // POST /shipments/:id/stops — append a hand-entered milestone.
  async addStop(actor: AccessPayload, shipmentId: string, input: AddShipmentStopInput) {
    const shipment = await this.loadShipment(shipmentId);
    const role = await this.requireWriter(shipment, actor);
    if (['DELIVERED', 'RETURNED'].includes(shipment.status)) {
      throw this.conflict('SHIPMENT_CLOSED', 'Vận đơn đã kết thúc, không thêm mốc được nữa.');
    }
    const occurredAt = input.occurredAt ?? new Date();
    const delivered = input.type === 'DELIVERED';
    const nextStatus = delivered
      ? 'DELIVERED'
      : shipment.status === 'PREPARING'
        ? 'IN_TRANSIT'
        : shipment.status;

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.shipmentStop.create({
        data: {
          shipmentId: shipment.id,
          type: input.type,
          description: input.description,
          location: input.location ?? null,
          occurredAt,
          enteredById: actor.sub,
        },
      });
      if (nextStatus !== shipment.status) {
        const changed = await tx.shipment.updateMany({
          where: { id: shipment.id, status: shipment.status },
          data: {
            status: nextStatus,
            ...(delivered ? { deliveredAt: occurredAt } : {}),
          },
        });
        if (changed.count === 0) {
          throw this.conflict('INVALID_SHIPMENT_STATE', 'Vận đơn vừa thay đổi trạng thái.');
        }
      }
      await tx.orderEvent.create({
        data: {
          orderId: shipment.orderId,
          type: 'shipment.stop',
          actorId: actor.sub,
          message: `${input.description}${input.location ? ` (${input.location})` : ''}.`,
          data: {
            shipmentId: shipment.id,
            type: input.type,
            location: input.location ?? null,
            occurredAt: occurredAt.toISOString(),
          },
        },
      });
      return tx.shipment.findUniqueOrThrow({
        where: { id: shipment.id },
        include: SHIPMENT_INCLUDE,
      });
    });

    if (delivered) {
      await this.notifyParties(shipment.order, 'shipment.delivered', {
        orderNo: shipment.order.orderNo,
        trackingNo: shipment.trackingNo,
      });
    }
    this.emitRealtime(shipment.orderId, {
      shipmentId: shipment.id,
      status: updated.status,
      stop: input.type,
    });
    return this.view(updated, role);
  }

  // GET /orders/:id/shipments — buyer timeline + quick-pick suggestions.
  async listForOrder(actor: AccessPayload, orderId: string) {
    const order = await this.loadOrder(orderId);
    const role = await this.resolveRole(order, actor);
    if (!role) throw new NotFoundException(ORDER_NOT_FOUND);
    const shipments = await this.prisma.shipment.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
      include: SHIPMENT_INCLUDE,
    });
    return {
      orderId,
      items: shipments.map((shipment) => this.view(shipment, role)),
      stopSuggestions: SHIPPING_STOP_SUGGESTIONS,
    };
  }

  // GET /shipments/:id
  async detail(actor: AccessPayload, shipmentId: string) {
    const shipment = await this.loadShipment(shipmentId);
    const role = await this.resolveRole(shipment.order, actor);
    if (!role) throw new NotFoundException(SHIPMENT_NOT_FOUND);
    return { ...this.view(shipment, role), stopSuggestions: SHIPPING_STOP_SUGGESTIONS };
  }

  // POST /orders/:id/confirm-receipt — buyer confirms; reuses P4.16.
  async confirmReceipt(actor: AccessPayload, orderId: string, input: ConfirmReceiptInput) {
    const order = await this.loadOrder(orderId);
    if (order.buyerId !== actor.sub) {
      const role = await this.resolveRole(order, actor);
      if (!role) throw new NotFoundException(ORDER_NOT_FOUND);
      throw new ForbiddenException('Chỉ khách hàng của đơn được xác nhận nhận hàng.');
    }
    const view = await this.orders.transition(actor, orderId, {
      to: 'RECEIVED',
      reason: input.note ?? 'Khách xác nhận đã nhận hàng.',
    });
    await this.notifySupplier(order, 'order.receipt_confirmed', {
      orderNo: order.orderNo,
    });
    return view;
  }

  // -------------------------------------------------------- stale reminders

  // Cron sweep: in-transit shipments with no milestone for N days.
  async remindStale(now = new Date()): Promise<{ reminded: number }> {
    const days = await this.settings.get<number>('shipping.staleAfterDays');
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    const rows = await this.prisma.shipment.findMany({
      where: {
        status: 'IN_TRANSIT',
        OR: [
          { lastReminderAt: null },
          { lastReminderAt: { lt: new Date(now.getTime() - 86_400_000) } },
        ],
      },
      take: 100,
      include: {
        stops: { orderBy: { occurredAt: 'desc' }, take: 1, select: { occurredAt: true } },
        order: {
          select: {
            id: true,
            orderNo: true,
            buyerId: true,
            supplier: { select: { accounts: { select: { userId: true } } } },
          },
        },
      },
    });

    let reminded = 0;
    for (const row of rows) {
      const lastActivity = row.stops[0]?.occurredAt ?? row.updatedAt;
      if (lastActivity >= cutoff) continue;
      const ids = new Set(row.order.supplier.accounts.map((account) => account.userId));
      ids.add(row.order.buyerId);
      for (const userId of ids) {
        await this.notifications.emit('shipping.stale', userId, {
          orderId: row.order.id,
          orderNo: row.order.orderNo,
          trackingNo: row.trackingNo,
          carrier: row.carrier,
          days,
        });
      }
      await this.prisma.shipment.update({
        where: { id: row.id },
        data: { lastReminderAt: now },
      });
      reminded += 1;
    }
    return { reminded };
  }

  // ---------------------------------------------------------------- helpers

  private async loadShipment(shipmentId: string): Promise<ShipmentWithRelations> {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: SHIPMENT_INCLUDE,
    });
    if (!shipment) throw new NotFoundException(SHIPMENT_NOT_FOUND);
    return shipment;
  }

  private async loadOrder(orderId: string): Promise<OrderRef> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNo: true,
        buyerId: true,
        supplierId: true,
        status: true,
        currency: true,
        supplier: { select: { accounts: { select: { userId: true } } } },
        dealRoom: { select: { id: true } },
      },
    });
    if (!order) throw new NotFoundException(ORDER_NOT_FOUND);
    return order;
  }

  private async resolveRole(order: OrderRef, actor: AccessPayload): Promise<ViewerRole | null> {
    if (order.buyerId === actor.sub) return 'buyer';
    const supplierId = await this.supplierIdFor(actor.sub);
    if (supplierId && supplierId === order.supplierId) return 'supplier';
    if (actor.role === Role.Admin || actor.role === Role.Sales || actor.role === Role.Inspector) {
      return 'staff';
    }
    return null;
  }

  private async requireWriter(
    shipment: ShipmentWithRelations,
    actor: AccessPayload,
  ): Promise<ViewerRole> {
    const role = await this.resolveRole(shipment.order, actor);
    if (!role) throw new NotFoundException(SHIPMENT_NOT_FOUND);
    if (role === 'buyer') {
      throw new ForbiddenException('Chỉ nhà cung cấp hoặc sales được cập nhật vận đơn.');
    }
    return role;
  }

  private async supplierIdFor(userId: string): Promise<string | null> {
    const account = await this.prisma.supplierAccount.findUnique({
      where: { userId },
      select: { supplierId: true },
    });
    return account?.supplierId ?? null;
  }

  private assertStatusMove(current: string, next?: string): void {
    if (!next || next === current) return;
    const allowed: Record<string, string[]> = {
      PREPARING: ['IN_TRANSIT', 'DELIVERED', 'RETURNED'],
      IN_TRANSIT: ['DELIVERED', 'RETURNED'],
      DELIVERED: [],
      RETURNED: [],
    };
    if (!(allowed[current] ?? []).includes(next)) {
      throw this.conflict('INVALID_SHIPMENT_STATE', `Không thể chuyển ${current} → ${next}.`);
    }
  }

  private async assertFile(actor: AccessPayload, fileObjectId: string): Promise<void> {
    const file = await this.prisma.fileObject.findUnique({
      where: { id: fileObjectId },
      select: { ownerId: true, status: true, scanStatus: true },
    });
    if (!file) throw new NotFoundException('Tệp phiếu gửi không tồn tại.');
    if (file.ownerId !== actor.sub) {
      throw new ForbiddenException('Bạn chỉ được dùng tệp do mình tải lên.');
    }
    if (file.status !== 'READY' || file.scanStatus === 'INFECTED') {
      throw this.conflict('FILE_NOT_READY', 'Tệp phiếu gửi chưa sẵn sàng hoặc không an toàn.');
    }
  }

  private view(shipment: ShipmentWithRelations, role: ViewerRole) {
    return {
      id: shipment.id,
      orderId: shipment.orderId,
      orderNo: shipment.order.orderNo,
      orderStatus: shipment.order.status,
      status: shipment.status,
      carrier: shipment.carrier,
      trackingNo: shipment.trackingNo,
      trackingUrl: shipment.trackingUrl,
      proofFileObjectId: shipment.proofFileObjectId,
      shippedAt: shipment.shippedAt,
      expectedAt: shipment.expectedAt,
      deliveredAt: shipment.deliveredAt,
      createdById: shipment.createdById,
      viewerRole: role,
      canEdit: role !== 'buyer' && !['DELIVERED', 'RETURNED'].includes(shipment.status),
      timeline: shipment.stops.map((stop) => ({
        id: stop.id,
        type: stop.type,
        occurredAt: stop.occurredAt,
        description: stop.description,
        location: stop.location,
        enteredById: stop.enteredById,
      })),
      createdAt: shipment.createdAt,
      updatedAt: shipment.updatedAt,
    };
  }

  private async notifyParties(
    order: OrderRef,
    event: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const ids = new Set<string>([order.buyerId]);
    for (const account of order.supplier.accounts) ids.add(account.userId);
    for (const userId of ids) {
      await this.notifications.emit(event, userId, { orderId: order.id, ...data });
    }
  }

  private async notifySupplier(
    order: OrderRef,
    event: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    for (const account of order.supplier.accounts) {
      await this.notifications.emit(event, account.userId, { orderId: order.id, ...data });
    }
  }

  private emitRealtime(orderId: string, payload: Record<string, unknown>): void {
    void this.prisma.dealRoom
      .findUnique({ where: { orderId }, select: { id: true } })
      .then((room) => {
        if (!room) return;
        this.realtime.toDealRoom(room.id, 'shipment.status', { orderId, ...payload });
      })
      .catch(() => undefined);
  }

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }
}
