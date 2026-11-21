import {
  displayStageFor,
  ORDER_FLOW,
  ORDER_TRANSITION_ACTORS,
  ORDER_TRANSITIONS,
  type OrderActorRole,
  orderStageIndex,
  type OrderStatusCode,
  orderStepper,
  transition as transitionOrderState,
} from '@cvc/shared';
import { Role } from '@cvc/shared';
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
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { ListOrdersQueryInput, TransitionOrderInput } from './orders.dto';

// P4.16 — buyer-facing order reads and the single transition entry point.
// D7 keeps 10 internal statuses; the response exposes the 8-stage stepper.
// Access follows the deal room model: only the buyer, the supplier's accounts
// and CVC staff may see an order; outsiders get 404.
const ORDER_NOT_FOUND = 'Đơn hàng không tồn tại.';

const ORDER_INCLUDE = Prisma.validator<Prisma.OrderInclude>()({
  buyer: { select: { id: true, profile: { select: { displayName: true } } } },
  supplier: { select: { id: true, name: true } },
  dealRoom: { select: { id: true } },
  LockedTerms: { select: { id: true, version: true, lockedAt: true } },
  stageLogs: { orderBy: { occurredAt: 'asc' } },
  events: { orderBy: { createdAt: 'desc' }, take: 100 },
  samples: {
    orderBy: { createdAt: 'desc' },
    include: { stops: { orderBy: { occurredAt: 'asc' } } },
  },
  shipments: { orderBy: { createdAt: 'desc' } },
  claims: { select: { id: true, claimNo: true, type: true, status: true, createdAt: true } },
});

type OrderWithRelations = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  // GET /orders — each role sees its own slice; staff see everything.
  async list(actor: AccessPayload, query: ListOrdersQueryInput) {
    const where: Prisma.OrderWhereInput = {};
    if (query.status) where.status = query.status;
    if (actor.role === Role.Buyer) {
      where.buyerId = actor.sub;
    } else if (actor.role === Role.Supplier) {
      const supplierId = await this.supplierIdFor(actor.sub);
      if (!supplierId) return { items: [], page: query.page, limit: query.limit, total: 0 };
      where.supplierId = supplierId;
    } else if (
      actor.role !== Role.Sales &&
      actor.role !== Role.Inspector &&
      actor.role !== Role.Admin
    ) {
      return { items: [], page: query.page, limit: query.limit, total: 0 };
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: {
          buyer: { select: { profile: { select: { displayName: true } } } },
          supplier: { select: { name: true } },
          _count: { select: { samples: true } },
        },
      }),
    ]);

    return {
      items: rows.map((order) => {
        const status = order.status as OrderStatusCode;
        return {
          id: order.id,
          orderNo: order.orderNo,
          status,
          stageIndex: order.stageIndex,
          displayStage: displayStageFor(status),
          stepper: orderStepper(status),
          totalAmount: order.totalAmount,
          depositAmount: order.depositAmount,
          currency: order.currency,
          buyerName: order.buyer.profile?.displayName ?? null,
          supplierName: order.supplier.name,
          sampleCount: order._count.samples,
          createdAt: order.createdAt,
          updatedAt: order.updatedAt,
        };
      }),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  // GET /orders/:id — full timeline for the parties and staff.
  async detail(actor: AccessPayload, orderId: string) {
    const order = await this.loadOrder(orderId);
    const actorRole = await this.resolveActorRole(order, actor);
    if (!actorRole) {
      this.logger.warn({ orderId, actor: actor.sub }, 'order access denied');
      throw new NotFoundException(ORDER_NOT_FOUND);
    }
    return this.buildView(order, actorRole);
  }

  // POST /orders/:id/transition — one edge per call, guards then audit rows.
  async transition(actor: AccessPayload, orderId: string, input: TransitionOrderInput) {
    const order = await this.loadOrder(orderId);
    const actorRole = await this.resolveActorRole(order, actor);
    if (!actorRole) {
      this.logger.warn({ orderId, actor: actor.sub }, 'order transition denied');
      throw new NotFoundException(ORDER_NOT_FOUND);
    }

    const outcome = transitionOrderState(
      { status: order.status as OrderStatusCode, stageIndex: order.stageIndex },
      input.to,
      { role: actorRole },
    );
    if (!outcome.ok) {
      const body = { code: outcome.code, message: outcome.message };
      if (outcome.code === 'FORBIDDEN') throw new ForbiddenException(body);
      throw new ConflictException(body);
    }

    await this.assertGuards(order, input.to);

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // Status is part of the WHERE: two racing transitions cannot both win.
      const updated = await tx.order.updateMany({
        where: { id: order.id, status: order.status },
        data: {
          status: input.to,
          ...(input.to === 'CANCELLED' ? {} : { stageIndex: outcome.stageIndex }),
        },
      });
      if (updated.count === 0) {
        throw this.conflict('INVALID_TRANSITION', 'Đơn hàng vừa thay đổi trạng thái.');
      }
      await tx.orderStageLog.create({
        data: {
          orderId: order.id,
          stageIndex: input.to === 'CANCELLED' ? order.stageIndex : outcome.stageIndex,
          status: input.to,
          actorId: actor.sub,
          note: input.reason ?? `Chuyển trạng thái ${order.status} → ${input.to}.`,
        },
      });
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          type: 'order.transition',
          actorId: actor.sub,
          message: input.reason ?? `Chuyển trạng thái ${order.status} → ${input.to}.`,
          data: {
            from: order.status,
            to: input.to,
            actorRole,
            reason: input.reason ?? null,
            stageIndex: outcome.stageIndex,
            displayStage: outcome.displayStage,
          },
        },
      });
    });

    await this.notifyOrder(
      order.id,
      'order.status_changed',
      {
        orderNo: order.orderNo,
        from: order.status,
        to: input.to,
        reason: input.reason ?? null,
      },
      actor.sub,
    );
    if (order.dealRoom) {
      this.realtime.toDealRoom(order.dealRoom.id, 'order.status', {
        orderId: order.id,
        status: input.to,
        stageIndex: outcome.stageIndex,
        displayStageIndex: outcome.displayStageIndex,
        displayStage: outcome.displayStage,
        at: now.toISOString(),
      });
    }

    this.logger.log(
      { orderId: order.id, from: order.status, to: input.to, actor: actor.sub, actorRole },
      'order transitioned',
    );
    const fresh = await this.loadOrder(order.id);
    return this.buildView(fresh, actorRole);
  }

  // ---------------------------------------------------------------- guards

  // Guards mirror the D7 table. Data owned by later phases (payments, QC,
  // shipments, claims) is read directly from the existing tables.
  private async assertGuards(order: OrderWithRelations, to: OrderStatusCode): Promise<void> {
    switch (to) {
      case 'SAMPLING': {
        if (order.LockedTerms) return;
        const locked = await this.prisma.lockedTerms.findUnique({
          where: { orderId: order.id },
          select: { id: true },
        });
        if (!locked) {
          throw this.conflict('LOCKED_TERMS_REQUIRED', 'Cần khóa điều khoản trước khi lấy mẫu.');
        }
        return;
      }
      case 'CONTRACT': {
        const approved = await this.prisma.sample.count({
          where: { orderId: order.id, status: 'APPROVED' },
        });
        if (approved === 0) {
          throw this.conflict('SAMPLE_NOT_APPROVED', 'Cần có mẫu được khách duyệt.');
        }
        return;
      }
      case 'DEPOSIT': {
        const signed = await this.prisma.contract.count({
          where: { ownerType: 'sourcing_order', ownerId: order.id, status: 'SIGNED' },
        });
        if (signed === 0) {
          throw this.conflict('CONTRACT_NOT_SIGNED', 'Hợp đồng chưa được ký đủ các bên.');
        }
        return;
      }
      case 'PRODUCTION': {
        // QC failure sends the order back to production without a new deposit.
        if (order.status === 'QC') return;
        const target = order.depositAmount ?? order.totalAmount;
        const paid = await this.paidTotal(order.id, order.currency);
        if (paid.lt(target)) {
          throw this.conflict('DEPOSIT_NOT_PAID', 'Khoản đặt cọc chưa được thanh toán đủ.');
        }
        return;
      }
      case 'QC': {
        const reported = await this.prisma.orderEvent.count({
          where: {
            orderId: order.id,
            type: { in: ['production.reported', 'production.ready'] },
          },
        });
        if (reported === 0) {
          throw this.conflict(
            'PRODUCTION_REPORT_REQUIRED',
            'Nhà cung cấp chưa báo hoàn tất sản xuất.',
          );
        }
        return;
      }
      case 'FINAL_PAYMENT': {
        const report = await this.prisma.qcReport.findFirst({
          where: { orderId: order.id },
          orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
          select: { passed: true },
        });
        if (!report?.passed) {
          throw this.conflict('QC_NOT_PASSED', 'QC chưa đạt; đơn chưa thể chuyển thanh toán.');
        }
        return;
      }
      case 'SHIPPING': {
        const paid = await this.paidTotal(order.id, order.currency);
        if (paid.lt(order.totalAmount)) {
          throw this.conflict('PAYMENT_NOT_COMPLETE', 'Chưa thanh toán đủ giá trị đơn hàng.');
        }
        return;
      }
      case 'RECEIVED': {
        const delivered = await this.prisma.shipment.count({
          where: { orderId: order.id, status: 'DELIVERED' },
        });
        if (delivered === 0) {
          throw this.conflict('SHIPMENT_NOT_DELIVERED', 'Chưa có vận đơn được đánh dấu đã giao.');
        }
        return;
      }
      case 'COMPLETED': {
        const open = await this.prisma.claim.count({
          where: { orderId: order.id, status: { in: ['OPEN', 'PROPOSED'] } },
        });
        if (open > 0) {
          throw this.conflict('OPEN_CLAIMS', 'Còn khiếu nại đang mở; chưa thể hoàn tất đơn.');
        }
        return;
      }
      case 'CANCELLED': {
        // Before the deposit either party may cancel; afterwards only admin
        // (the role matrix enforces that) and the locked terms must exist.
        if (orderStageIndex(order.status as OrderStatusCode) >= orderStageIndex('DEPOSIT')) {
          const locked = await this.prisma.lockedTerms.findUnique({
            where: { orderId: order.id },
            select: { id: true },
          });
          if (!locked) {
            throw this.conflict(
              'TERMS_REQUIRED_FOR_CANCELLATION',
              'Sau đặt cọc cần điều khoản đã khóa để xử lý hủy/hoàn cọc.',
            );
          }
        }
        return;
      }
      default:
        return;
    }
  }

  private async paidTotal(orderId: string, currency: string): Promise<Prisma.Decimal> {
    const result = await this.prisma.payment.aggregate({
      where: {
        purposeType: 'order',
        purposeId: orderId,
        status: 'CONFIRMED',
        currency,
      },
      _sum: { amount: true },
    });
    return result._sum.amount ?? new Prisma.Decimal(0);
  }

  // --------------------------------------------------------------- helpers

  private async loadOrder(orderId: string): Promise<OrderWithRelations> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: ORDER_INCLUDE,
    });
    if (!order) throw new NotFoundException(ORDER_NOT_FOUND);
    return order;
  }

  private async resolveActorRole(
    order: { buyerId: string; supplierId: string },
    actor: AccessPayload,
  ): Promise<OrderActorRole | null> {
    if (order.buyerId === actor.sub) return 'buyer';
    const supplierId = await this.supplierIdFor(actor.sub);
    if (supplierId && supplierId === order.supplierId) return 'supplier';
    if (actor.role === Role.Admin) return 'admin';
    if (actor.role === Role.Sales) return 'sales';
    if (actor.role === Role.Inspector) return 'inspector';
    return null;
  }

  private async supplierIdFor(userId: string): Promise<string | null> {
    const account = await this.prisma.supplierAccount.findUnique({
      where: { userId },
      select: { supplierId: true },
    });
    return account?.supplierId ?? null;
  }

  private allowedTransitions(status: OrderStatusCode, role: OrderActorRole): OrderStatusCode[] {
    const edges = ORDER_TRANSITIONS[status] ?? [];
    return edges.filter((to) => (ORDER_TRANSITION_ACTORS[status]?.[to] ?? []).includes(role));
  }

  private buildView(order: OrderWithRelations, actorRole: OrderActorRole) {
    const status = order.status as OrderStatusCode;
    return {
      id: order.id,
      orderNo: order.orderNo,
      status,
      stageIndex: order.stageIndex,
      displayStage: displayStageFor(status),
      stepper: orderStepper(status),
      allowedTransitions: this.allowedTransitions(status, actorRole),
      viewerRole: actorRole,
      totalAmount: order.totalAmount,
      depositAmount: order.depositAmount,
      currency: order.currency,
      note: order.note,
      buyer: {
        id: order.buyer.id,
        name: order.buyer.profile?.displayName ?? null,
      },
      supplier: order.supplier,
      dealRoomId: order.dealRoom?.id ?? null,
      lockedTerms: order.LockedTerms,
      flow: ORDER_FLOW,
      stageLogs: order.stageLogs,
      events: order.events,
      samples: order.samples,
      shipments: order.shipments,
      claims: order.claims,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  private async notifyOrder(
    orderId: string,
    event: string,
    data: Record<string, unknown>,
    excludeUserId?: string,
  ): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        buyerId: true,
        supplier: { select: { accounts: { select: { userId: true } } } },
      },
    });
    if (!order) return;
    const ids = new Set<string>([order.buyerId]);
    for (const account of order.supplier.accounts) ids.add(account.userId);
    if (excludeUserId) ids.delete(excludeUserId);
    for (const userId of ids) {
      await this.notifications.emit(event, userId, { orderId, ...data });
    }
  }

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }
}
