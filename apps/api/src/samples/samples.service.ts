import { randomBytes } from 'node:crypto';

import {
  SAMPLE_TRANSITION_ACTORS,
  SAMPLE_TRANSITIONS,
  type SampleActorRole,
  type SampleStatusCode,
  sampleTransition,
} from '@cvc/shared';
import { Role } from '@cvc/shared';
import {
  BadRequestException,
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
import { SystemSettingsService } from '../settings/system-settings.service';
import type {
  AddSampleStopInput,
  ApproveSampleInput,
  CreateSampleInput,
  ReceiveSampleInput,
  ReviseSampleInput,
  ShipSampleInput,
  UploadSampleInput,
} from './samples.dto';

// P4.17 — production samples: requested → uploaded → sent → in_transit →
// delivered → revision_requested (loop) | approved. Supplier accounts upload
// and ship; sales may append manual milestones; the buyer receives, revises
// or approves. Approved samples are terminal (DoD).
const SAMPLE_NOT_FOUND = 'Mẫu thử không tồn tại.';
const SAMPLE_INCLUDE = Prisma.validator<Prisma.SampleInclude>()({
  stops: { orderBy: { occurredAt: 'asc' } },
  order: {
    select: {
      id: true,
      orderNo: true,
      buyerId: true,
      supplierId: true,
      status: true,
      stageIndex: true,
      currency: true,
      dealRoom: { select: { id: true } },
      supplier: { select: { accounts: { select: { userId: true } } } },
    },
  },
});

type SampleWithRelations = Prisma.SampleGetPayload<{ include: typeof SAMPLE_INCLUDE }>;

@Injectable()
export class SamplesService {
  private readonly logger = new Logger(SamplesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SystemSettingsService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  // POST /orders/:id/samples — buyer asks the supplier to make a sample.
  async request(actor: AccessPayload, orderId: string, input: CreateSampleInput) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNo: true,
        buyerId: true,
        supplierId: true,
        status: true,
        currency: true,
      },
    });
    if (!order) throw new NotFoundException('Đơn hàng không tồn tại.');
    // Outsiders must not learn the order exists (404); the supplier and staff
    // can see it but may not request samples on the buyer's behalf (403).
    const role = await this.readRole(order, actor);
    if (!role) throw new NotFoundException('Đơn hàng không tồn tại.');
    if (role !== 'buyer') {
      throw new ForbiddenException('Chỉ khách hàng của đơn được yêu cầu mẫu.');
    }
    if (order.status !== 'SAMPLING') {
      throw this.conflict('ORDER_NOT_SAMPLING', 'Đơn chưa ở bước lấy mẫu.');
    }
    if (input.feeCurrency && input.feeCurrency !== order.currency) {
      throw new BadRequestException('Loại tiền phí mẫu phải khớp với đơn hàng.');
    }
    const active = await this.prisma.sample.count({
      where: { orderId, status: { notIn: ['APPROVED', 'REJECTED', 'STOPPED'] } },
    });
    if (active > 0) {
      throw this.conflict('SAMPLE_ALREADY_ACTIVE', 'Đang có một mẫu chưa kết thúc cho đơn này.');
    }

    const sample = await this.prisma.$transaction(async (tx) => {
      const created = await tx.sample.create({
        data: {
          sampleNo: `CVC-SMP-${randomBytes(5).toString('hex').toUpperCase()}`,
          orderId,
          status: 'REQUESTED',
          note: input.note ?? null,
          feeAmount: input.feeAmount ?? null,
          feeCurrency: input.feeAmount ? (input.feeCurrency ?? order.currency) : null,
        },
        select: { id: true, sampleNo: true },
      });
      await tx.orderEvent.create({
        data: {
          orderId,
          type: 'sample.requested',
          actorId: actor.sub,
          message: `Yêu cầu mẫu ${created.sampleNo}.`,
          data: {
            sampleId: created.id,
            sampleNo: created.sampleNo,
            feeAmount: input.feeAmount ?? null,
            feeCurrency: input.feeAmount ? (input.feeCurrency ?? order.currency) : null,
          },
        },
      });
      if (input.feeAmount) {
        // P4.19 creates the actual Payment from this order event + fee fields.
        await tx.orderEvent.create({
          data: {
            orderId,
            type: 'sample.fee_due',
            actorId: actor.sub,
            message: `Phí mẫu ${input.feeAmount} ${input.feeCurrency ?? order.currency}.`,
            data: {
              sampleId: created.id,
              feeAmount: input.feeAmount,
              feeCurrency: input.feeCurrency ?? order.currency,
            },
          },
        });
      }
      return created;
    });

    await this.notifyOrder(
      orderId,
      'sample.requested',
      {
        orderNo: order.orderNo,
        sampleNo: sample.sampleNo,
      },
      actor.sub,
    );
    await this.emitRealtime(sample.id, 'sample.requested');
    this.logger.log({ orderId, sampleId: sample.id, actor: actor.sub }, 'sample requested');
    return this.view(await this.loadSample(sample.id), 'buyer');
  }

  // GET /orders/:id/samples
  async list(actor: AccessPayload, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, buyerId: true, supplierId: true },
    });
    if (!order) throw new NotFoundException('Đơn hàng không tồn tại.');
    const role = await this.readRole(order, actor);
    if (!role) throw new NotFoundException('Đơn hàng không tồn tại.');
    const samples = await this.prisma.sample.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
      include: SAMPLE_INCLUDE,
    });
    return { orderId, items: samples.map((sample) => this.view(sample, role)) };
  }

  // GET /samples/:id
  async detail(actor: AccessPayload, sampleId: string) {
    const sample = await this.loadSample(sampleId);
    const role = await this.readRole(sample.order, actor);
    if (!role) throw new NotFoundException(SAMPLE_NOT_FOUND);
    return this.view(sample, role);
  }

  // POST /samples/:id/upload — supplier uploads the actual sample photo.
  async upload(actor: AccessPayload, sampleId: string, input: UploadSampleInput) {
    const sample = await this.loadSample(sampleId);
    const role = await this.requireRole(sample, actor);
    this.assertEdge(sample, 'UPLOADED', role);
    if (input.fileObjectId) await this.assertFileReady(input.fileObjectId);

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.sample.updateMany({
        where: { id: sample.id, status: sample.status },
        data: {
          status: 'UPLOADED',
          uploadedAt: now,
          ...(input.note ? { note: input.note } : {}),
          ...(input.fileObjectId ? { photoFileObjectId: input.fileObjectId } : {}),
        },
      });
      if (changed.count === 0) {
        throw this.conflict('INVALID_TRANSITION', 'Mẫu vừa thay đổi trạng thái.');
      }
      await tx.orderEvent.create({
        data: {
          orderId: sample.orderId,
          type: 'sample.uploaded',
          actorId: actor.sub,
          message: `Nhà cung cấp cập nhật mẫu${input.note ? `: ${input.note}` : '.'}`,
          data: {
            sampleId: sample.id,
            round: sample.revisionCount + 1,
            fileObjectId: input.fileObjectId ?? null,
          },
        },
      });
      return tx.sample.findUniqueOrThrow({ where: { id: sample.id }, include: SAMPLE_INCLUDE });
    });

    await this.notifyOrder(
      sample.orderId,
      'sample.uploaded',
      {
        sampleNo: sample.sampleNo,
        orderNo: sample.order.orderNo,
        round: sample.revisionCount + 1,
      },
      actor.sub,
    );
    await this.emitRealtime(sample.id, 'sample.uploaded');
    return this.view(updated, role);
  }

  // POST /samples/:id/ship — supplier ships the sample with a hand-entered
  // carrier/tracking number (D13: no carrier API).
  async ship(actor: AccessPayload, sampleId: string, input: ShipSampleInput) {
    const sample = await this.loadSample(sampleId);
    const role = await this.requireRole(sample, actor);
    this.assertEdge(sample, 'SENT', role);
    const shippedAt = input.shippedAt ?? new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.sample.updateMany({
        where: { id: sample.id, status: sample.status },
        data: {
          status: 'SENT',
          carrier: input.carrier,
          trackingNo: input.trackingNo,
          trackingUrl: input.trackingUrl ?? null,
          shippedAt,
        },
      });
      if (changed.count === 0) {
        throw this.conflict('INVALID_TRANSITION', 'Mẫu vừa thay đổi trạng thái.');
      }
      await tx.sampleStop.create({
        data: {
          sampleId: sample.id,
          type: 'PICKED_UP',
          reason: `Giao cho ${input.carrier} · ${input.trackingNo}`,
          occurredAt: shippedAt,
          enteredById: actor.sub,
        },
      });
      await tx.orderEvent.create({
        data: {
          orderId: sample.orderId,
          type: 'sample.sent',
          actorId: actor.sub,
          message: `Đã gửi mẫu qua ${input.carrier} · ${input.trackingNo}.`,
          data: {
            sampleId: sample.id,
            carrier: input.carrier,
            trackingNo: input.trackingNo,
            trackingUrl: input.trackingUrl ?? null,
          },
        },
      });
      return tx.sample.findUniqueOrThrow({ where: { id: sample.id }, include: SAMPLE_INCLUDE });
    });

    await this.notifyOrder(
      sample.orderId,
      'sample.sent',
      {
        sampleNo: sample.sampleNo,
        orderNo: sample.order.orderNo,
        carrier: input.carrier,
        trackingNo: input.trackingNo,
      },
      actor.sub,
    );
    await this.emitRealtime(sample.id, 'sample.sent');
    return this.view(updated, role);
  }

  // POST /samples/:id/stops — supplier/sales append a manual milestone.
  async addStop(actor: AccessPayload, sampleId: string, input: AddSampleStopInput) {
    const sample = await this.loadSample(sampleId);
    const role = await this.requireRole(sample, actor);
    if (role !== 'supplier' && role !== 'sales') {
      throw new ForbiddenException('Chỉ nhà cung cấp hoặc sales được nhập mốc vận chuyển mẫu.');
    }
    if (!['SENT', 'SHIPPED', 'IN_TRANSIT'].includes(sample.status)) {
      throw this.conflict('INVALID_TRANSITION', 'Mẫu chưa được gửi hoặc đã kết thúc.');
    }
    const target: SampleStatusCode = input.type === 'DELIVERED' ? 'DELIVERED' : 'IN_TRANSIT';
    const changesStatus = sample.status !== 'IN_TRANSIT' || target === 'DELIVERED';
    if (changesStatus) this.assertEdge(sample, target, role);

    const occurredAt = input.occurredAt ?? new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      if (changesStatus) {
        const changed = await tx.sample.updateMany({
          where: { id: sample.id, status: sample.status },
          data: {
            status: target,
            ...(target === 'DELIVERED' ? { deliveredAt: occurredAt } : {}),
          },
        });
        if (changed.count === 0) {
          throw this.conflict('INVALID_TRANSITION', 'Mẫu vừa thay đổi trạng thái.');
        }
      }
      await tx.sampleStop.create({
        data: {
          sampleId: sample.id,
          type: input.type,
          reason: input.description,
          location: input.location ?? null,
          occurredAt,
          enteredById: actor.sub,
        },
      });
      await tx.orderEvent.create({
        data: {
          orderId: sample.orderId,
          type: 'sample.stop',
          actorId: actor.sub,
          message: `${input.type}: ${input.description}${input.location ? ` (${input.location})` : ''}.`,
          data: {
            sampleId: sample.id,
            type: input.type,
            location: input.location ?? null,
            occurredAt: occurredAt.toISOString(),
          },
        },
      });
      return tx.sample.findUniqueOrThrow({ where: { id: sample.id }, include: SAMPLE_INCLUDE });
    });

    if (target === 'DELIVERED') {
      await this.notifyOrder(
        sample.orderId,
        'sample.delivered',
        {
          sampleNo: sample.sampleNo,
          orderNo: sample.order.orderNo,
        },
        actor.sub,
      );
    }
    await this.emitRealtime(sample.id, target === 'DELIVERED' ? 'sample.delivered' : 'sample.stop');
    return this.view(updated, role);
  }

  // POST /samples/:id/receive — buyer confirms the sample arrived.
  async receive(actor: AccessPayload, sampleId: string, input: ReceiveSampleInput) {
    const sample = await this.loadSample(sampleId);
    const role = await this.requireRole(sample, actor);
    this.assertEdge(sample, 'DELIVERED', role);
    const receivedAt = input.receivedAt ?? new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.sample.updateMany({
        where: { id: sample.id, status: sample.status },
        data: { status: 'DELIVERED', deliveredAt: receivedAt },
      });
      if (changed.count === 0) {
        throw this.conflict('INVALID_TRANSITION', 'Mẫu vừa thay đổi trạng thái.');
      }
      await tx.orderEvent.create({
        data: {
          orderId: sample.orderId,
          type: 'sample.received',
          actorId: actor.sub,
          message: input.note ?? 'Khách đã nhận mẫu.',
          data: { sampleId: sample.id, receivedAt: receivedAt.toISOString() },
        },
      });
      return tx.sample.findUniqueOrThrow({ where: { id: sample.id }, include: SAMPLE_INCLUDE });
    });

    await this.notifyOrder(
      sample.orderId,
      'sample.received',
      {
        sampleNo: sample.sampleNo,
        orderNo: sample.order.orderNo,
      },
      actor.sub,
    );
    await this.emitRealtime(sample.id, 'sample.received');
    return this.view(updated, role);
  }

  // POST /samples/:id/revise — buyer asks for changes (capped by setting).
  async revise(actor: AccessPayload, sampleId: string, input: ReviseSampleInput) {
    const sample = await this.loadSample(sampleId);
    const role = await this.requireRole(sample, actor);
    if (sample.status === 'APPROVED') {
      throw this.conflict('SAMPLE_APPROVED', 'Mẫu đã được duyệt, không thể yêu cầu sửa lại.');
    }
    this.assertEdge(sample, 'REVISION_REQUESTED', role);

    const limit = await this.settings.get<number>('samples.maxRevisionRounds');
    if (sample.revisionCount >= limit) {
      throw this.conflict('SAMPLE_REVISION_LIMIT', `Đã đạt giới hạn ${limit} vòng sửa mẫu.`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.sample.updateMany({
        where: { id: sample.id, status: sample.status },
        data: {
          status: 'REVISION_REQUESTED',
          revisionCount: { increment: 1 },
          revisionNote: input.note,
        },
      });
      if (changed.count === 0) {
        throw this.conflict('INVALID_TRANSITION', 'Mẫu vừa thay đổi trạng thái.');
      }
      await tx.orderEvent.create({
        data: {
          orderId: sample.orderId,
          type: 'sample.revision_requested',
          actorId: actor.sub,
          message: `Yêu cầu sửa mẫu (vòng ${sample.revisionCount + 1}): ${input.note}`,
          data: {
            sampleId: sample.id,
            round: sample.revisionCount + 1,
            note: input.note,
            evidenceFileObjectId: input.evidenceFileObjectId ?? null,
          },
        },
      });
      return tx.sample.findUniqueOrThrow({ where: { id: sample.id }, include: SAMPLE_INCLUDE });
    });

    await this.notifyOrder(
      sample.orderId,
      'sample.revision_requested',
      {
        sampleNo: sample.sampleNo,
        orderNo: sample.order.orderNo,
        round: sample.revisionCount + 1,
        note: input.note,
      },
      actor.sub,
    );
    await this.emitRealtime(sample.id, 'sample.revision_requested');
    return this.view(updated, role);
  }

  // POST /samples/:id/approve — buyer approves; sampling → contract (D7).
  async approve(actor: AccessPayload, sampleId: string, input: ApproveSampleInput) {
    const sample = await this.loadSample(sampleId);
    const role = await this.requireRole(sample, actor);
    this.assertEdge(sample, 'APPROVED', role);
    const now = new Date();
    const moveOrder = sample.order.status === 'SAMPLING';

    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.sample.updateMany({
        where: { id: sample.id, status: sample.status },
        data: {
          status: 'APPROVED',
          decidedAt: now,
          ...(input.note ? { revisionNote: input.note } : {}),
        },
      });
      if (changed.count === 0) {
        throw this.conflict('INVALID_TRANSITION', 'Mẫu vừa thay đổi trạng thái.');
      }
      await tx.orderEvent.create({
        data: {
          orderId: sample.orderId,
          type: 'sample.approved',
          actorId: actor.sub,
          message: input.note ?? `Khách đã duyệt mẫu ${sample.sampleNo}.`,
          data: { sampleId: sample.id, round: sample.revisionCount + 1 },
        },
      });
      if (moveOrder) {
        // P5.4 will create the Contract document from the approved sample.
        await tx.order.update({
          where: { id: sample.orderId },
          data: { status: 'CONTRACT', stageIndex: 2 },
        });
        await tx.orderStageLog.create({
          data: {
            orderId: sample.orderId,
            stageIndex: 2,
            status: 'CONTRACT',
            actorId: actor.sub,
            note: `Mẫu ${sample.sampleNo} được duyệt.`,
          },
        });
        await tx.orderEvent.create({
          data: {
            orderId: sample.orderId,
            type: 'order.transition',
            actorId: actor.sub,
            message: 'Duyệt mẫu: đơn chuyển sang bước hợp đồng.',
            data: { from: 'SAMPLING', to: 'CONTRACT', sampleId: sample.id, stageIndex: 2 },
          },
        });
      }
      return tx.sample.findUniqueOrThrow({ where: { id: sample.id }, include: SAMPLE_INCLUDE });
    });

    await this.notifyOrder(
      sample.orderId,
      'sample.approved',
      {
        sampleNo: sample.sampleNo,
        orderNo: sample.order.orderNo,
      },
      actor.sub,
    );
    await this.emitRealtime(sample.id, 'sample.approved');
    if (moveOrder) {
      await this.notifyOrder(
        sample.orderId,
        'order.status_changed',
        {
          orderNo: sample.order.orderNo,
          from: 'SAMPLING',
          to: 'CONTRACT',
          reason: 'Mẫu đã được duyệt.',
        },
        actor.sub,
      );
      if (sample.order.dealRoom?.id) {
        this.realtime.toDealRoom(sample.order.dealRoom.id, 'order.status', {
          orderId: sample.orderId,
          status: 'CONTRACT',
          stageIndex: 2,
        });
      }
    }
    this.logger.log({ sampleId: sample.id, orderId: sample.orderId, moveOrder }, 'sample approved');
    return {
      ...this.view(updated, role),
      orderMovedTo: moveOrder ? 'CONTRACT' : sample.order.status,
    };
  }

  // ---------------------------------------------------------------- helpers

  private async loadSample(sampleId: string): Promise<SampleWithRelations> {
    const sample = await this.prisma.sample.findUnique({
      where: { id: sampleId },
      include: SAMPLE_INCLUDE,
    });
    if (!sample) throw new NotFoundException(SAMPLE_NOT_FOUND);
    return sample;
  }

  private async readRole(
    order: { buyerId: string; supplierId: string },
    actor: AccessPayload,
  ): Promise<SampleActorRole | null> {
    if (order.buyerId === actor.sub) return 'buyer';
    const supplierId = await this.supplierIdFor(actor.sub);
    if (supplierId && supplierId === order.supplierId) return 'supplier';
    if (actor.role === Role.Admin) return 'admin';
    if (actor.role === Role.Sales) return 'sales';
    return null;
  }

  private async requireRole(
    sample: SampleWithRelations,
    actor: AccessPayload,
  ): Promise<SampleActorRole> {
    const role = await this.readRole(sample.order, actor);
    if (!role) throw new NotFoundException(SAMPLE_NOT_FOUND);
    return role;
  }

  private async supplierIdFor(userId: string): Promise<string | null> {
    const account = await this.prisma.supplierAccount.findUnique({
      where: { userId },
      select: { supplierId: true },
    });
    return account?.supplierId ?? null;
  }

  private assertEdge(
    sample: { status: string },
    to: SampleStatusCode,
    role: SampleActorRole,
  ): void {
    const outcome = sampleTransition({ status: sample.status as SampleStatusCode }, to, { role });
    if (!outcome.ok) {
      const body = { code: outcome.code, message: outcome.message };
      if (outcome.code === 'FORBIDDEN') throw new ForbiddenException(body);
      throw new ConflictException(body);
    }
  }

  private async assertFileReady(fileObjectId: string): Promise<void> {
    const file = await this.prisma.fileObject.findUnique({
      where: { id: fileObjectId },
      select: { id: true, status: true },
    });
    if (!file) throw new NotFoundException('Tệp không tồn tại.');
    if (file.status !== 'READY') {
      throw this.conflict('FILE_NOT_READY', 'Tệp chưa tải xong.');
    }
  }

  private view(sample: SampleWithRelations, role: SampleActorRole) {
    const status = sample.status as SampleStatusCode;
    const allowed = (SAMPLE_TRANSITIONS[status] ?? []).filter((to) =>
      (SAMPLE_TRANSITION_ACTORS[status]?.[to] ?? []).includes(role),
    );
    return {
      id: sample.id,
      sampleNo: sample.sampleNo,
      orderId: sample.orderId,
      status,
      note: sample.note,
      requestedAt: sample.requestedAt,
      uploadedAt: sample.uploadedAt,
      shippedAt: sample.shippedAt,
      deliveredAt: sample.deliveredAt,
      decidedAt: sample.decidedAt,
      carrier: sample.carrier,
      trackingNo: sample.trackingNo,
      trackingUrl: sample.trackingUrl,
      photoFileObjectId: sample.photoFileObjectId,
      revisionCount: sample.revisionCount,
      round: sample.revisionCount + 1,
      revisionNote: sample.revisionNote,
      feeAmount: sample.feeAmount,
      feeCurrency: sample.feeCurrency,
      viewerRole: role,
      allowedTransitions: allowed,
      order: {
        id: sample.order.id,
        orderNo: sample.order.orderNo,
        status: sample.order.status,
        stageIndex: sample.order.stageIndex,
        currency: sample.order.currency,
        dealRoomId: sample.order.dealRoom?.id ?? null,
      },
      stops: sample.stops,
      createdAt: sample.createdAt,
      updatedAt: sample.updatedAt,
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

  private async emitRealtime(sampleId: string, event: string): Promise<void> {
    const sample = await this.prisma.sample.findUnique({
      where: { id: sampleId },
      select: {
        id: true,
        orderId: true,
        status: true,
        order: { select: { dealRoom: { select: { id: true } }, status: true, stageIndex: true } },
      },
    });
    const roomId = sample?.order.dealRoom?.id;
    if (!roomId || !sample) return;
    this.realtime.toDealRoom(roomId, 'sample.status', {
      sampleId: sample.id,
      orderId: sample.orderId,
      status: sample.status,
      orderStatus: sample.order.status,
      stageIndex: sample.order.stageIndex,
      event,
    });
  }

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }
}
