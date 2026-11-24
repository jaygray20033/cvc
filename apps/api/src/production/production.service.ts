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
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { ProductionReadyInput, ProductionReportInput } from './production.dto';

// P4.19 B — production updates come from the supplier. `ready` writes the
// production.ready event P4.16's QC guard looks for and moves the order to QC.
const ORDER_NOT_FOUND = 'Đơn hàng không tồn tại.';

const REPORT_INCLUDE = Prisma.validator<Prisma.ProductionReportInclude>()({
  media: { select: { id: true, fileObjectId: true, kind: true } },
});

type ReportWithMedia = Prisma.ProductionReportGetPayload<{ include: typeof REPORT_INCLUDE }>;
type OrderRef = {
  id: string;
  orderNo: string;
  buyerId: string;
  supplierId: string;
  status: string;
};
type ViewerRole = 'buyer' | 'supplier' | 'staff';

@Injectable()
export class ProductionService {
  private readonly logger = new Logger(ProductionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly orders: OrdersService,
  ) {}

  // POST /orders/:id/production-reports
  async report(actor: AccessPayload, orderId: string, input: ProductionReportInput) {
    const order = await this.loadOrder(orderId);
    const role = await this.resolveRole(order, actor);
    if (!role) throw new NotFoundException(ORDER_NOT_FOUND);
    if (role !== 'supplier') {
      throw new ForbiddenException('Chỉ nhà cung cấp của đơn được báo tiến độ sản xuất.');
    }
    this.assertInProduction(order);

    await this.assertFiles(actor, input.fileObjectIds);
    const report = await this.prisma.$transaction(async (tx) => {
      const created = await tx.productionReport.create({
        data: {
          orderId,
          reportedById: actor.sub,
          note: input.note ?? null,
          media: {
            create: input.fileObjectIds.map((fileObjectId) => ({
              fileObjectId,
              kind: 'PHOTO',
            })),
          },
        },
        include: REPORT_INCLUDE,
      });
      await tx.orderEvent.create({
        data: {
          orderId,
          type: 'production.reported',
          actorId: actor.sub,
          message: input.note ?? 'Nhà cung cấp báo tiến độ sản xuất.',
          data: {
            reportId: created.id,
            fileObjectIds: input.fileObjectIds,
          },
        },
      });
      return created;
    });

    await this.notifyBuyer(order, 'production.reported', {
      orderNo: order.orderNo,
      fileCount: input.fileObjectIds.length,
    });
    this.emitRealtime(order.id, { reportId: report.id, ready: false });
    this.logger.log({ orderId, reportId: report.id, actor: actor.sub }, 'production reported');
    return this.view(report, role, order);
  }

  // POST /orders/:id/ready — supplier declares production complete; P4.16
  // then allows PRODUCTION → QC (role matrix: supplier).
  async ready(actor: AccessPayload, orderId: string, input: ProductionReadyInput) {
    const order = await this.loadOrder(orderId);
    const role = await this.resolveRole(order, actor);
    if (!role) throw new NotFoundException(ORDER_NOT_FOUND);
    if (role !== 'supplier') {
      throw new ForbiddenException('Chỉ nhà cung cấp của đơn được báo hoàn tất sản xuất.');
    }
    this.assertInProduction(order);
    await this.assertFiles(actor, input.fileObjectIds);

    const report = await this.prisma.$transaction(async (tx) => {
      const created = await tx.productionReport.create({
        data: {
          orderId,
          reportedById: actor.sub,
          note: input.note ?? null,
          ready: true,
          ...(input.fileObjectIds.length > 0
            ? {
                media: {
                  create: input.fileObjectIds.map((fileObjectId) => ({
                    fileObjectId,
                    kind: 'PHOTO',
                  })),
                },
              }
            : {}),
        },
        include: REPORT_INCLUDE,
      });
      await tx.orderEvent.create({
        data: {
          orderId,
          type: 'production.ready',
          actorId: actor.sub,
          message: input.note ?? 'Nhà cung cấp báo đã hoàn tất sản xuất.',
          data: { reportId: created.id, fileObjectIds: input.fileObjectIds },
        },
      });
      return created;
    });

    let moved = false;
    if (order.status === 'PRODUCTION') {
      await this.orders.transition(actor, orderId, {
        to: 'QC',
        reason: 'Nhà cung cấp báo hoàn tất sản xuất.',
      });
      moved = true;
    }

    await this.notifyBuyer(order, 'production.ready', {
      orderNo: order.orderNo,
      movedToQc: moved,
    });
    this.emitRealtime(order.id, { reportId: report.id, ready: true, movedToQc: moved });
    this.logger.log({ orderId, reportId: report.id, moved }, 'production ready');
    return {
      report: this.view(report, role, order),
      orderMovedTo: moved ? 'QC' : order.status,
    };
  }

  // GET /orders/:id/production-reports
  async list(actor: AccessPayload, orderId: string) {
    const order = await this.loadOrder(orderId);
    const role = await this.resolveRole(order, actor);
    if (!role) throw new NotFoundException(ORDER_NOT_FOUND);
    const reports = await this.prisma.productionReport.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
      include: REPORT_INCLUDE,
    });
    return { orderId, items: reports.map((report) => this.view(report, role, order)) };
  }

  // ---------------------------------------------------------------- helpers

  private async loadOrder(orderId: string): Promise<OrderRef> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNo: true,
        buyerId: true,
        supplierId: true,
        status: true,
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

  private async supplierIdFor(userId: string): Promise<string | null> {
    const account = await this.prisma.supplierAccount.findUnique({
      where: { userId },
      select: { supplierId: true },
    });
    return account?.supplierId ?? null;
  }

  private assertInProduction(order: OrderRef): void {
    if (!['PRODUCTION', 'QC'].includes(order.status)) {
      throw new ConflictException({
        code: 'ORDER_NOT_IN_PRODUCTION',
        message: 'Đơn chưa ở bước sản xuất.',
      });
    }
  }

  private async assertFiles(actor: AccessPayload, fileObjectIds: string[]): Promise<void> {
    for (const fileObjectId of fileObjectIds) {
      const file = await this.prisma.fileObject.findUnique({
        where: { id: fileObjectId },
        select: { ownerId: true, status: true, scanStatus: true },
      });
      if (!file) throw new NotFoundException('Tệp báo cáo không tồn tại.');
      if (file.ownerId !== actor.sub) {
        throw new ForbiddenException('Bạn chỉ được dùng tệp do mình tải lên.');
      }
      if (file.status !== 'READY' || file.scanStatus === 'INFECTED') {
        throw new ConflictException({
          code: 'FILE_NOT_READY',
          message: 'Tệp báo cáo chưa sẵn sàng hoặc không an toàn.',
        });
      }
    }
  }

  private view(report: ReportWithMedia, role: ViewerRole, order: OrderRef) {
    return {
      id: report.id,
      orderId: report.orderId,
      orderNo: order.orderNo,
      ready: report.ready,
      note: report.note,
      reportedById: report.reportedById,
      viewerRole: role,
      media: report.media,
      createdAt: report.createdAt,
    };
  }

  private async notifyBuyer(
    order: OrderRef,
    event: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.notifications.emit(event, order.buyerId, { orderId: order.id, ...data });
  }

  private emitRealtime(orderId: string, payload: Record<string, unknown>): void {
    void this.prisma.dealRoom
      .findUnique({ where: { orderId }, select: { id: true } })
      .then((room) => {
        if (!room) return;
        this.realtime.toDealRoom(room.id, 'order.production', { orderId, ...payload });
      })
      .catch(() => undefined);
  }
}
