import { randomBytes } from 'node:crypto';

import {
  allowedResolutionsFor,
  CLAIM_OPEN_STATUSES,
  type ClaimActorRole,
  type ClaimResolutionKind,
  type ClaimStatusCode,
  transitionClaim,
} from '@cvc/shared';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { type ClaimStatus, Prisma } from '@prisma/client';

import type { AccessPayload } from '../common/decorators/current-user.decorator';
import { ConservationService } from '../common/ledger/conservation.service';
import { LedgerService } from '../common/ledger/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SystemSettingsService } from '../settings/system-settings.service';
import type {
  ChooseClaimResolutionInput,
  ClaimProposalInput,
  ConfirmRefundInput,
  ConfirmTopupInput,
  ExecuteRefundInput,
  IssueClaimInput,
  ListAdminClaimsInput,
  MoveTopupInput,
  ReceiveReturnInput,
  ResolveClaimInput,
  SendReturnInput,
  WithdrawClaimInput,
} from './claims.dto';

// P4.22 — buyer claims (missing quantity / quality). Evidence is mandatory,
// the claim amount is frozen when filed, and every refund is posted through
// the ledger exactly once. Money never moves outside `executeRefund`.
const CLAIM_NOT_FOUND = 'Khiếu nại không tồn tại.';
const ORDER_NOT_FOUND = 'Đơn hàng không tồn tại.';
const PAID_STATUSES = ['CONFIRMED', 'APPROVED', 'PARTIAL'] as const;
const REFUND_STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED'] as const;

const TOPUP_STAGE_LABELS = [
  'Đã lập lịch gửi bù',
  'Nhà cung cấp đã gửi hàng bù',
  'Hàng bù đang vận chuyển',
  'Hàng bù đã tới nơi',
] as const;

const ORDER_SELECT = {
  id: true,
  orderNo: true,
  buyerId: true,
  supplierId: true,
  status: true,
  currency: true,
  totalAmount: true,
  updatedAt: true,
  selectedQuote: { select: { unitPrice: true } },
  sourcingRequest: { select: { quantity: true, title: true } },
  shipments: {
    where: { status: 'DELIVERED' },
    select: { id: true, status: true, deliveredAt: true, updatedAt: true },
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
} as const;

const CLAIM_INCLUDE = Prisma.validator<Prisma.ClaimInclude>()({
  order: {
    select: {
      id: true,
      orderNo: true,
      buyerId: true,
      supplierId: true,
      status: true,
      currency: true,
      totalAmount: true,
    },
  },
  filedBy: { select: { id: true, email: true, profile: { select: { displayName: true } } } },
  proposals: {
    orderBy: { createdAt: 'asc' },
    include: {
      proposedBy: { select: { id: true, email: true, profile: { select: { displayName: true } } } },
    },
  },
  resolution: {
    include: {
      decidedBy: { select: { id: true, email: true, profile: { select: { displayName: true } } } },
    },
  },
  returns: { orderBy: { createdAt: 'desc' } },
  refunds: { orderBy: { createdAt: 'desc' } },
  evidences: { orderBy: { createdAt: 'asc' } },
});

type OrderRef = Prisma.OrderGetPayload<{ select: typeof ORDER_SELECT }>;
type ClaimWithRelations = Prisma.ClaimGetPayload<{ include: typeof CLAIM_INCLUDE }>;
type ViewerRole = 'buyer' | 'supplier' | 'staff';

@Injectable()
export class ClaimsService {
  private readonly logger = new Logger(ClaimsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SystemSettingsService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly ledger: LedgerService,
    private readonly conservation: ConservationService,
  ) {}

  // POST /orders/:id/claims
  async create(actor: AccessPayload, orderId: string, input: IssueClaimInput) {
    const order = await this.loadOrder(orderId);
    const role = await this.resolveRole(order, actor);
    if (!role || role !== 'buyer') {
      if (!role) throw new NotFoundException(ORDER_NOT_FOUND);
      throw new ForbiddenException('Chỉ khách hàng của đơn được mở khiếu nại.');
    }

    const deliveredAt = this.deliveredAt(order);
    if (!['SHIPPING', 'RECEIVED'].includes(order.status)) {
      throw this.conflict(
        'ORDER_NOT_DELIVERED',
        'Chỉ mở khiếu nại khi hàng đã tới nơi (vận chuyển/nhận hàng).',
      );
    }
    if (!deliveredAt) {
      throw this.conflict('DELIVERY_NOT_RECORDED', 'Chưa có mốc hàng tới nơi để tính thời hạn.');
    }
    const windowDays = await this.settings.get<number>('claims.windowDays');
    if (Date.now() - deliveredAt.getTime() > windowDays * 86_400_000) {
      throw this.conflict(
        'CLAIM_WINDOW_EXPIRED',
        `Đã quá thời hạn khiếu nại ${windowDays} ngày kể từ khi giao hàng.`,
      );
    }

    const open = await this.prisma.claim.count({
      where: { orderId: order.id, status: { in: [...CLAIM_OPEN_STATUSES] } },
    });
    if (open > 0) {
      throw this.conflict('CLAIM_ALREADY_OPEN', 'Đơn đã có khiếu nại đang xử lý.');
    }

    const quantity = order.sourcingRequest?.quantity ?? null;
    if (!quantity || quantity <= 0) {
      throw this.conflict('ORDER_QUANTITY_UNKNOWN', 'Đơn thiếu số lượng để tính khiếu nại.');
    }
    const unitPrice = this.unitPrice(order, quantity);
    const type = input.type ?? (input.kind === 'missing' ? 'MISSING' : 'QUALITY');
    const missing = type === 'MISSING' ? (input.missingQuantity as number | undefined) : undefined;
    if (type === 'MISSING') {
      if (!missing || missing <= 0) {
        throw this.conflict('CLAIM_MISSING_QUANTITY_REQUIRED', 'Nhập số lượng thiếu lớn hơn 0.');
      }
      if (missing > quantity) {
        throw this.conflict(
          'CLAIM_MISSING_EXCEEDS_ORDER',
          'Số lượng thiếu không được vượt số lượng hợp đồng.',
        );
      }
    }
    const actualQuantity = type === 'MISSING' ? quantity - (missing as number) : quantity;
    const billedQuantity = type === 'MISSING' ? (missing as number) : quantity;
    const amount = unitPrice.mul(billedQuantity).toDecimalPlaces(2);

    const files = await this.loadEvidenceFiles(actor, input.evidenceFileObjectIds);
    const claimNo = await this.uniqueClaimNo();

    const claim = await this.prisma.$transaction(async (tx) => {
      const created = await tx.claim.create({
        data: {
          claimNo,
          orderId: order.id,
          type,
          reason: input.notes,
          status: 'OPEN',
          filedById: actor.sub,
          orderedQuantity: quantity,
          missingQuantity: missing ?? null,
          actualQuantity,
          unitPrice,
          amount,
          currency: order.currency,
          evidences: {
            create: files.map((file) => ({ fileObjectId: file.id, kind: file.kind })),
          },
        },
        include: CLAIM_INCLUDE,
      });
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          type: 'claim.filed',
          actorId: actor.sub,
          message:
            type === 'MISSING'
              ? `Khách báo thiếu ${missing}/${quantity} sản phẩm (${amount} ${order.currency}).`
              : `Khách khiếu nại chất lượng toàn bộ ${quantity} sản phẩm (${amount} ${order.currency}).`,
          data: {
            claimId: created.id,
            claimNo: created.claimNo,
            type,
            missingQuantity: missing ?? null,
            amount: amount.toString(),
            evidenceCount: files.length,
          },
        },
      });
      return created;
    });

    this.logger.log({ orderId, claimId: claim.id, type, amount: amount.toString() }, 'claim filed');
    await this.notifyAdmins('claim.filed', {
      orderNo: order.orderNo,
      claimNo: claim.claimNo,
      type: claim.type,
      amount: amount.toString(),
      currency: claim.currency,
    });
    await this.notifyParties(order, 'claim.filed', {
      orderNo: order.orderNo,
      claimNo: claim.claimNo,
      type: claim.type,
      amount: amount.toString(),
      currency: claim.currency,
    });
    this.emitRealtime(order.id, { claimId: claim.id, status: claim.status });
    return this.view(claim, role, await this.extras(order.id));
  }

  // GET /orders/:id/claims
  async listForOrder(actor: AccessPayload, orderId: string) {
    const order = await this.loadOrder(orderId);
    const role = await this.resolveRole(order, actor);
    if (!role) throw new NotFoundException(ORDER_NOT_FOUND);
    const rows = await this.prisma.claim.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'desc' },
      include: CLAIM_INCLUDE,
    });
    const extras = await this.extras(order.id);
    return {
      orderId: order.id,
      items: rows.map((row) => this.view(row, role, extras)),
    };
  }

  // GET /claims/:id
  async detail(actor: AccessPayload, claimId: string) {
    const claim = await this.loadClaim(claimId);
    const role = await this.resolveRole(claim.order, actor);
    if (!role) throw new NotFoundException(CLAIM_NOT_FOUND);
    return this.view(claim, role, await this.extras(claim.orderId));
  }

  // POST /claims/:id/proposals — sales/supplier/CVC offers a resolution.
  async propose(actor: AccessPayload, claimId: string, input: ClaimProposalInput) {
    const claim = await this.loadClaim(claimId);
    const role = await this.resolveRole(claim.order, actor);
    const claimRole = this.claimRole(role, actor);
    if (!role || !claimRole || !['supplier', 'sales', 'admin'].includes(claimRole)) {
      if (!role) throw new NotFoundException(CLAIM_NOT_FOUND);
      throw new ForbiddenException('Chỉ CVC hoặc nhà cung cấp được đề xuất phương án.');
    }
    if (!['OPEN', 'PROPOSED'].includes(claim.status)) {
      throw this.conflict('INVALID_CLAIM_STATE', 'Khiếu nại không còn ở bước đề xuất.');
    }
    if (input.kind === 'PARTIAL_REFUND' && !input.amount) {
      throw this.conflict('PROPOSAL_AMOUNT_REQUIRED', 'Đề xuất hoàn một phần cần số tiền.');
    }

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.claimProposal.create({
        data: {
          claimId: claim.id,
          kind: input.kind,
          amount: input.amount ?? null,
          currency: claim.currency,
          note: input.note ?? null,
          proposedById: actor.sub,
        },
      });
      const changed = await tx.claim.updateMany({
        where: { id: claim.id, status: { in: ['OPEN', 'PROPOSED'] } },
        data: { status: 'PROPOSED', proposedAt: claim.proposedAt ?? now },
      });
      if (changed.count === 0) {
        throw this.conflict('INVALID_CLAIM_STATE', 'Khiếu nại vừa thay đổi trạng thái.');
      }
      await tx.orderEvent.create({
        data: {
          orderId: claim.orderId,
          type: 'claim.proposed',
          actorId: actor.sub,
          message: input.note ?? `Đề xuất phương án ${input.kind}.`,
          data: {
            claimId: claim.id,
            kind: input.kind,
            amount: input.amount ?? null,
          },
        },
      });
      return tx.claim.findUniqueOrThrow({ where: { id: claim.id }, include: CLAIM_INCLUDE });
    });

    await this.notifyBuyer(claim.order, 'claim.proposed', {
      orderNo: claim.order.orderNo,
      claimNo: claim.claimNo,
      kind: input.kind,
      amount: input.amount ?? null,
      currency: claim.currency,
    });
    this.emitRealtime(claim.orderId, { claimId: claim.id, status: updated.status });
    return this.view(updated, role, await this.extras(claim.orderId));
  }

  // POST /claims/:id/choose-resolution — buyer picks top-up or refund/return.
  async chooseResolution(actor: AccessPayload, claimId: string, input: ChooseClaimResolutionInput) {
    const claim = await this.loadClaim(claimId);
    const role = await this.resolveRole(claim.order, actor);
    if (!role) throw new NotFoundException(CLAIM_NOT_FOUND);
    if (role !== 'buyer') {
      throw new ForbiddenException('Chỉ khách hàng được chọn phương án xử lý.');
    }
    this.assertTransition(
      claim.status,
      input.choice === 'TOPUP' ? 'TOPUP_PENDING' : 'RESOLUTION_CHOSEN',
      'buyer',
    );
    if (claim.status !== 'PROPOSED') {
      throw this.conflict('INVALID_CLAIM_STATE', 'Chờ CVC đề xuất phương án trước khi chọn.');
    }
    const allowed = allowedResolutionsFor(claim.type);
    if (!allowed.includes(input.choice as ClaimResolutionKind)) {
      throw this.conflict(
        'RESOLUTION_NOT_ALLOWED',
        claim.type === 'MISSING'
          ? 'Khiếu nại thiếu hàng chỉ được chọn gửi bù hoặc hoàn tiền.'
          : 'Khiếu nại chất lượng chỉ được chọn hoàn hàng và hoàn tiền.',
      );
    }

    const to: ClaimStatusCode = input.choice === 'TOPUP' ? 'TOPUP_PENDING' : 'RESOLUTION_CHOSEN';
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.claim.updateMany({
        where: { id: claim.id, status: 'PROPOSED' },
        data: {
          status: to,
          resolutionKind: input.choice,
          chosenAt: now,
          topupStage: input.choice === 'TOPUP' ? 0 : claim.topupStage,
        },
      });
      if (changed.count === 0) {
        throw this.conflict('INVALID_CLAIM_STATE', 'Khiếu nại vừa được chọn bởi người khác.');
      }
      // Mark the matching proposal as accepted (best effort, no unique rules).
      const proposalKind =
        input.choice === 'TOPUP' ? 'REPLACE' : input.choice === 'REFUND' ? 'REFUND' : 'RETURN';
      await tx.claimProposal.updateMany({
        where: { claimId: claim.id, kind: proposalKind, status: 'PENDING' },
        data: { status: 'ACCEPTED' },
      });
      await tx.orderEvent.create({
        data: {
          orderId: claim.orderId,
          type: 'claim.resolution_chosen',
          actorId: actor.sub,
          message:
            input.choice === 'TOPUP'
              ? 'Khách chọn nhận hàng gửi bù.'
              : input.choice === 'REFUND'
                ? 'Khách chọn hoàn tiền phần thiếu.'
                : 'Khách chọn trả hàng và hoàn tiền.',
          data: {
            claimId: claim.id,
            choice: input.choice,
            amount: claim.amount?.toString() ?? null,
            note: input.note ?? null,
          },
        },
      });
      return tx.claim.findUniqueOrThrow({ where: { id: claim.id }, include: CLAIM_INCLUDE });
    });

    await this.notifyParties(claim.order, 'claim.resolution_chosen', {
      orderNo: claim.order.orderNo,
      claimNo: claim.claimNo,
      choice: input.choice,
    });
    this.emitRealtime(claim.orderId, { claimId: claim.id, status: updated.status });
    return this.view(updated, role, await this.extras(claim.orderId));
  }

  // POST /claims/:id/topup — supplier/admin advances the replacement shipment.
  async moveTopup(actor: AccessPayload, claimId: string, input: MoveTopupInput) {
    const claim = await this.loadClaim(claimId);
    const role = await this.resolveRole(claim.order, actor);
    const claimRole = this.claimRole(role, actor);
    if (!role) throw new NotFoundException(CLAIM_NOT_FOUND);
    if (!claimRole || !['supplier', 'admin'].includes(claimRole)) {
      throw new ForbiddenException('Chỉ nhà cung cấp hoặc CVC được cập nhật hàng gửi bù.');
    }
    if (claim.status !== 'TOPUP_PENDING' || claim.resolutionKind !== 'TOPUP') {
      throw this.conflict('INVALID_CLAIM_STATE', 'Khiếu nại không ở bước gửi bù.');
    }
    if (claim.topupStage >= 3) {
      throw this.conflict('TOPUP_ALREADY_DELIVERED', 'Hàng bù đã tới nơi; chờ khách xác nhận.');
    }

    const stage = Math.min(3, claim.topupStage + 1);
    const deliveredAt = stage === 3 ? new Date() : claim.topupDeliveredAt;
    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.claim.updateMany({
        where: { id: claim.id, status: 'TOPUP_PENDING', topupStage: claim.topupStage },
        data: { topupStage: stage, topupDeliveredAt: deliveredAt },
      });
      if (changed.count === 0) {
        throw this.conflict('INVALID_CLAIM_STATE', 'Khiếu nại vừa thay đổi trạng thái.');
      }
      await tx.orderEvent.create({
        data: {
          orderId: claim.orderId,
          type: 'claim.topup',
          actorId: actor.sub,
          message: TOPUP_STAGE_LABELS[stage],
          data: { claimId: claim.id, stage, note: input.note ?? null },
        },
      });
      return tx.claim.findUniqueOrThrow({ where: { id: claim.id }, include: CLAIM_INCLUDE });
    });

    if (stage === 3) {
      await this.notifyBuyer(claim.order, 'claim.topup_delivered', {
        orderNo: claim.order.orderNo,
        claimNo: claim.claimNo,
        missingQuantity: claim.missingQuantity,
      });
    }
    this.emitRealtime(claim.orderId, {
      claimId: claim.id,
      status: updated.status,
      topupStage: stage,
    });
    return this.view(updated, role, await this.extras(claim.orderId));
  }

  // POST /claims/:id/topup/confirm — buyer confirms the replacement arrived.
  async confirmTopup(actor: AccessPayload, claimId: string, input: ConfirmTopupInput) {
    const claim = await this.loadClaim(claimId);
    const role = await this.resolveRole(claim.order, actor);
    if (!role) throw new NotFoundException(CLAIM_NOT_FOUND);
    if (role !== 'buyer') {
      throw new ForbiddenException('Chỉ khách hàng được xác nhận nhận hàng gửi bù.');
    }
    if (claim.status !== 'TOPUP_PENDING') {
      throw this.conflict('INVALID_CLAIM_STATE', 'Khiếu nại không ở bước chờ nhận hàng bù.');
    }
    if (claim.topupStage < 3) {
      throw this.conflict('TOPUP_NOT_DELIVERED', 'Hàng bù chưa được báo tới nơi.');
    }
    this.assertTransition(claim.status, 'TOPUP_CONFIRMED', 'buyer');

    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.claim.updateMany({
        where: { id: claim.id, status: 'TOPUP_PENDING', topupStage: 3 },
        data: { status: 'TOPUP_CONFIRMED' },
      });
      if (changed.count === 0) {
        throw this.conflict('INVALID_CLAIM_STATE', 'Khiếu nại vừa được xác nhận.');
      }
      await tx.orderEvent.create({
        data: {
          orderId: claim.orderId,
          type: 'claim.topup_confirmed',
          actorId: actor.sub,
          message: `Khách xác nhận nhận đủ ${claim.missingQuantity ?? 0} sản phẩm gửi bù.`,
          data: { claimId: claim.id, note: input.note ?? null },
        },
      });
      return tx.claim.findUniqueOrThrow({ where: { id: claim.id }, include: CLAIM_INCLUDE });
    });

    await this.notifyParties(claim.order, 'claim.topup_confirmed', {
      orderNo: claim.order.orderNo,
      claimNo: claim.claimNo,
    });
    this.emitRealtime(claim.orderId, { claimId: claim.id, status: updated.status });
    return this.view(updated, role, await this.extras(claim.orderId));
  }

  // POST /claims/:id/return/ship — buyer returns the goods (quality claims).
  async sendReturn(actor: AccessPayload, claimId: string, input: SendReturnInput) {
    const claim = await this.loadClaim(claimId);
    const role = await this.resolveRole(claim.order, actor);
    if (!role) throw new NotFoundException(CLAIM_NOT_FOUND);
    if (role !== 'buyer') {
      throw new ForbiddenException('Chỉ khách hàng được gửi trả hàng.');
    }
    if (claim.status !== 'RESOLUTION_CHOSEN' || claim.resolutionKind !== 'RETURN_REFUND') {
      throw this.conflict('INVALID_CLAIM_STATE', 'Khiếu nại chưa chọn phương án trả hàng.');
    }
    this.assertTransition(claim.status, 'RETURN_SENT', 'buyer');

    let proofFileId: string | null = null;
    if (input.proofFileObjectId) {
      const file = await this.assertEvidenceFile(actor, input.proofFileObjectId);
      proofFileId = file.id;
    }
    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.returnShipment.create({
        data: {
          claimId: claim.id,
          direction: 'RETURN_TO_SUPPLIER',
          carrier: input.carrier,
          trackingNo: input.trackingNo,
          proofFileObjectId: proofFileId,
          status: 'IN_TRANSIT',
          shippedAt: now,
        },
      });
      const changed = await tx.claim.updateMany({
        where: { id: claim.id, status: 'RESOLUTION_CHOSEN' },
        data: { status: 'RETURN_SENT' },
      });
      if (changed.count === 0) {
        throw this.conflict('INVALID_CLAIM_STATE', 'Khiếu nại vừa thay đổi trạng thái.');
      }
      await tx.orderEvent.create({
        data: {
          orderId: claim.orderId,
          type: 'claim.return_sent',
          actorId: actor.sub,
          message: `Khách gửi trả hàng qua ${input.carrier} · ${input.trackingNo}.`,
          data: {
            claimId: claim.id,
            carrier: input.carrier,
            trackingNo: input.trackingNo,
            note: input.note ?? null,
          },
        },
      });
      return tx.claim.findUniqueOrThrow({ where: { id: claim.id }, include: CLAIM_INCLUDE });
    });

    await this.notifyParties(claim.order, 'claim.return_sent', {
      orderNo: claim.order.orderNo,
      claimNo: claim.claimNo,
      carrier: input.carrier,
      trackingNo: input.trackingNo,
    });
    this.emitRealtime(claim.orderId, { claimId: claim.id, status: updated.status });
    return this.view(updated, role, await this.extras(claim.orderId));
  }

  // POST /claims/:id/return/receive — CVC confirms the returned goods arrived.
  async receiveReturn(actor: AccessPayload, claimId: string, input: ReceiveReturnInput) {
    const claim = await this.loadClaim(claimId);
    const role = await this.resolveRole(claim.order, actor);
    if (!role) throw new NotFoundException(CLAIM_NOT_FOUND);
    if (role !== 'staff') {
      throw new ForbiddenException('Chỉ CVC được xác nhận nhận hàng trả về.');
    }
    if (claim.status !== 'RETURN_SENT') {
      throw this.conflict('INVALID_CLAIM_STATE', 'Hàng trả về chưa được gửi hoặc đã nhận.');
    }
    this.assertTransition(claim.status, 'RETURN_RECEIVED', 'admin');

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const shipment = await tx.returnShipment.findFirst({
        where: { claimId: claim.id },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (shipment) {
        await tx.returnShipment.update({
          where: { id: shipment.id },
          data: { status: 'DELIVERED', deliveredAt: now },
        });
      }
      const changed = await tx.claim.updateMany({
        where: { id: claim.id, status: 'RETURN_SENT' },
        data: { status: 'RETURN_RECEIVED' },
      });
      if (changed.count === 0) {
        throw this.conflict('INVALID_CLAIM_STATE', 'Khiếu nại vừa thay đổi trạng thái.');
      }
      await tx.orderEvent.create({
        data: {
          orderId: claim.orderId,
          type: 'claim.return_received',
          actorId: actor.sub,
          message: 'CVC đã nhận hàng trả về; chờ hoàn tiền.',
          data: { claimId: claim.id, note: input.note ?? null },
        },
      });
      return tx.claim.findUniqueOrThrow({ where: { id: claim.id }, include: CLAIM_INCLUDE });
    });

    await this.notifyBuyer(claim.order, 'claim.return_received', {
      orderNo: claim.order.orderNo,
      claimNo: claim.claimNo,
    });
    this.emitRealtime(claim.orderId, { claimId: claim.id, status: updated.status });
    return this.view(updated, role, await this.extras(claim.orderId));
  }

  // POST /admin/claims/:id/execute-refund — finance admin posts the ledger.
  async executeRefund(actor: AccessPayload, claimId: string, input: ExecuteRefundInput) {
    const claim = await this.loadClaim(claimId);
    const role = await this.resolveRole(claim.order, actor);
    if (!role) throw new NotFoundException(CLAIM_NOT_FOUND);
    if (role !== 'staff' || actor.role !== 'admin') {
      throw new ForbiddenException('Chỉ quản trị tài chính được thực hiện hoàn tiền.');
    }
    if (claim.resolutionKind === 'TOPUP') {
      throw this.conflict('NOT_A_REFUND_CLAIM', 'Khiếu nại này xử lý bằng hàng gửi bù.');
    }
    const expected =
      claim.resolutionKind === 'RETURN_REFUND' ? 'RETURN_RECEIVED' : 'RESOLUTION_CHOSEN';
    if (claim.status !== expected) {
      throw this.conflict(
        'INVALID_CLAIM_STATE',
        claim.resolutionKind === 'RETURN_REFUND'
          ? 'Cần nhận hàng trả về trước khi hoàn tiền.'
          : 'Cần khách chọn phương án hoàn tiền trước.',
      );
    }
    this.assertTransition(claim.status, 'REFUND_EXECUTED', 'admin');

    const existing = await this.prisma.refund.findFirst({
      where: { claimId: claim.id, status: { not: 'FAILED' } },
      select: { id: true },
    });
    if (existing) {
      throw this.conflict('REFUND_ALREADY_EXECUTED', 'Khiếu nại này đã được hoàn tiền.');
    }

    const claimCap = claim.amount ?? new Prisma.Decimal(0);
    const amount = new Prisma.Decimal(input.amount ?? claimCap);
    if (amount.lte(0)) {
      throw this.conflict('REFUND_AMOUNT_REQUIRED', 'Số tiền hoàn phải lớn hơn 0.');
    }
    if (amount.gt(claimCap)) {
      throw this.conflict(
        'REFUND_EXCEEDS_CLAIM',
        `Số tiền hoàn vượt giá trị khiếu nại (${claimCap} ${claim.currency}).`,
      );
    }
    const paid = await this.paidTotal(claim.orderId, claim.currency);
    const refunded = await this.refundedTotal(claim.orderId, claim.currency);
    const available = paid.minus(refunded);
    if (amount.gt(available)) {
      throw this.conflict(
        'REFUND_EXCEEDS_PAID',
        `Số tiền hoàn vượt số đã thu còn lại (${available} ${claim.currency}).`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const refund = await tx.refund.create({
        data: {
          orderId: claim.orderId,
          claimId: claim.id,
          amount,
          currency: claim.currency,
          method: input.method,
          status: 'COMPLETED',
          paymentRef: input.paymentRef ?? null,
          note: input.note ?? null,
          completedAt: new Date(),
        },
      });
      const ledger = await this.ledger.post(tx, {
        type: 'REFUND',
        refType: 'refund',
        refId: refund.id,
        currency: claim.currency,
        createdById: actor.sub,
        note: `Hoàn tiền khiếu nại ${claim.claimNo}`,
        lines: [
          {
            accountCode: `CUS-${claim.order.buyerId}`,
            accountName: `Khách hàng ${claim.order.buyerId}`,
            accountType: 'LIABILITY',
            side: 'DEBIT',
            amount,
          },
          {
            accountCode: 'CVC-BANK',
            accountName: 'Tiền gửi ngân hàng CVC',
            accountType: 'ASSET',
            side: 'CREDIT',
            amount,
          },
        ],
      });
      if (ledger.alreadyPosted) {
        throw this.conflict('REFUND_ALREADY_POSTED', 'Khoản hoàn này đã được ghi sổ cái.');
      }
      const changed = await tx.claim.updateMany({
        where: { id: claim.id, status: expected },
        data: { status: 'REFUND_EXECUTED' },
      });
      if (changed.count === 0) {
        throw this.conflict('INVALID_CLAIM_STATE', 'Khiếu nại vừa thay đổi trạng thái.');
      }
      await tx.orderEvent.create({
        data: {
          orderId: claim.orderId,
          type: 'claim.refund_executed',
          actorId: actor.sub,
          message: `Đã hoàn ${amount} ${claim.currency} cho khách (${claim.claimNo}).`,
          data: {
            claimId: claim.id,
            refundId: refund.id,
            amount: amount.toString(),
            ledgerTransactionId: ledger.transactionId,
          },
        },
      });
      return {
        refund,
        ledger,
        claim: await tx.claim.findUniqueOrThrow({
          where: { id: claim.id },
          include: CLAIM_INCLUDE,
        }),
      };
    });

    this.logger.log(
      { claimId, refundId: result.refund.id, amount: amount.toString() },
      'claim refund executed',
    );
    await this.notifyBuyer(claim.order, 'claim.refund_executed', {
      orderNo: claim.order.orderNo,
      claimNo: claim.claimNo,
      amount: amount.toString(),
      currency: claim.currency,
    });
    this.emitRealtime(claim.orderId, { claimId: claim.id, status: result.claim.status });
    // P4.25: verify money conservation after the refund commits.
    await this.conservation.runAfter('claim.refund');
    return {
      claim: this.view(result.claim, role, await this.extras(claim.orderId)),
      refund: this.refundView(result.refund),
      ledgerTransactionId: result.ledger.transactionId,
    };
  }

  // POST /claims/:id/confirm-refund — buyer confirms the refund arrived.
  async confirmRefund(actor: AccessPayload, claimId: string, input: ConfirmRefundInput) {
    const claim = await this.loadClaim(claimId);
    const role = await this.resolveRole(claim.order, actor);
    if (!role) throw new NotFoundException(CLAIM_NOT_FOUND);
    if (role !== 'buyer') {
      throw new ForbiddenException('Chỉ khách hàng được xác nhận nhận tiền hoàn.');
    }
    if (claim.status !== 'REFUND_EXECUTED') {
      throw this.conflict(
        'INVALID_CLAIM_STATE',
        'Khoản hoàn chưa được thực hiện hoặc đã xác nhận.',
      );
    }
    this.assertTransition(claim.status, 'REFUND_CONFIRMED', 'buyer');

    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.claim.updateMany({
        where: { id: claim.id, status: 'REFUND_EXECUTED' },
        data: { status: 'REFUND_CONFIRMED' },
      });
      if (changed.count === 0) {
        throw this.conflict('INVALID_CLAIM_STATE', 'Khiếu nại vừa được xác nhận.');
      }
      await tx.orderEvent.create({
        data: {
          orderId: claim.orderId,
          type: 'claim.refund_confirmed',
          actorId: actor.sub,
          message: input.match
            ? 'Khách xác nhận đã nhận tiền hoàn và số hàng còn lại đạt yêu cầu.'
            : 'Khách xác nhận đã nhận tiền hoàn.',
          data: { claimId: claim.id, match: input.match ?? null, note: input.note ?? null },
        },
      });
      return tx.claim.findUniqueOrThrow({ where: { id: claim.id }, include: CLAIM_INCLUDE });
    });

    await this.notifyParties(claim.order, 'claim.refund_confirmed', {
      orderNo: claim.order.orderNo,
      claimNo: claim.claimNo,
    });
    this.emitRealtime(claim.orderId, { claimId: claim.id, status: updated.status });
    return this.view(updated, role, await this.extras(claim.orderId));
  }

  // POST /admin/claims/:id/resolve — close after the buyer confirmed, or reject.
  async resolve(actor: AccessPayload, claimId: string, input: ResolveClaimInput) {
    const claim = await this.loadClaim(claimId);
    const role = await this.resolveRole(claim.order, actor);
    if (!role) throw new NotFoundException(CLAIM_NOT_FOUND);
    if (role !== 'staff') {
      throw new ForbiddenException('Chỉ CVC được kết luận khiếu nại.');
    }

    if (input.decision === 'REJECT') {
      const rejectable = [
        'OPEN',
        'PROPOSED',
        'RESOLUTION_CHOSEN',
        'TOPUP_PENDING',
        'RETURN_SENT',
        'RETURN_RECEIVED',
      ];
      if (!rejectable.includes(claim.status)) {
        throw this.conflict('INVALID_CLAIM_STATE', 'Không thể từ chối ở trạng thái hiện tại.');
      }
      this.assertTransition(claim.status, 'REJECTED', 'admin');
      const updated = await this.prisma.$transaction(async (tx) => {
        await tx.claimResolution.upsert({
          where: { claimId: claim.id },
          create: {
            claimId: claim.id,
            decision: 'REJECT',
            note: input.note ?? null,
            decidedById: actor.sub,
          },
          update: {
            decision: 'REJECT',
            note: input.note ?? null,
            decidedById: actor.sub,
            decidedAt: new Date(),
          },
        });
        const changed = await tx.claim.updateMany({
          where: { id: claim.id, status: claim.status },
          data: { status: 'REJECTED', closedAt: new Date() },
        });
        if (changed.count === 0) {
          throw this.conflict('INVALID_CLAIM_STATE', 'Khiếu nại vừa thay đổi trạng thái.');
        }
        await tx.orderEvent.create({
          data: {
            orderId: claim.orderId,
            type: 'claim.rejected',
            actorId: actor.sub,
            message: input.note ?? 'CVC từ chối khiếu nại.',
            data: { claimId: claim.id, decision: 'REJECT' },
          },
        });
        return tx.claim.findUniqueOrThrow({ where: { id: claim.id }, include: CLAIM_INCLUDE });
      });
      await this.notifyBuyer(claim.order, 'claim.rejected', {
        orderNo: claim.order.orderNo,
        claimNo: claim.claimNo,
        reason: input.note ?? null,
      });
      this.emitRealtime(claim.orderId, { claimId: claim.id, status: updated.status });
      return this.view(updated, role, await this.extras(claim.orderId));
    }

    if (!['TOPUP_CONFIRMED', 'REFUND_CONFIRMED'].includes(claim.status)) {
      throw this.conflict(
        'CLAIM_NOT_CONFIRMED',
        'Cần khách xác nhận đã nhận hàng bù hoặc tiền hoàn trước khi kết luận.',
      );
    }
    this.assertTransition(claim.status, 'CLOSED', 'admin');
    const decision = claim.resolutionKind === 'TOPUP' ? 'REPLACE' : 'REFUND';

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.claimResolution.upsert({
        where: { claimId: claim.id },
        create: {
          claimId: claim.id,
          decision,
          note: input.note ?? null,
          decidedById: actor.sub,
        },
        update: {
          decision,
          note: input.note ?? null,
          decidedById: actor.sub,
          decidedAt: new Date(),
        },
      });
      const changed = await tx.claim.updateMany({
        where: { id: claim.id, status: claim.status },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
      if (changed.count === 0) {
        throw this.conflict('INVALID_CLAIM_STATE', 'Khiếu nại vừa thay đổi trạng thái.');
      }
      await tx.orderEvent.create({
        data: {
          orderId: claim.orderId,
          type: 'claim.closed',
          actorId: actor.sub,
          message: input.note ?? 'CVC kết luận và đóng khiếu nại.',
          data: { claimId: claim.id, decision },
        },
      });
      return tx.claim.findUniqueOrThrow({ where: { id: claim.id }, include: CLAIM_INCLUDE });
    });

    await this.notifyParties(claim.order, 'claim.closed', {
      orderNo: claim.order.orderNo,
      claimNo: claim.claimNo,
      decision,
    });
    this.emitRealtime(claim.orderId, { claimId: claim.id, status: updated.status });
    return this.view(updated, role, await this.extras(claim.orderId));
  }

  // POST /claims/:id/withdraw
  async withdraw(actor: AccessPayload, claimId: string, input: WithdrawClaimInput) {
    const claim = await this.loadClaim(claimId);
    const role = await this.resolveRole(claim.order, actor);
    if (!role) throw new NotFoundException(CLAIM_NOT_FOUND);
    if (role !== 'buyer') {
      throw new ForbiddenException('Chỉ khách hàng được rút khiếu nại.');
    }
    this.assertTransition(claim.status, 'WITHDRAWN', 'buyer');

    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.claim.updateMany({
        where: { id: claim.id, status: claim.status },
        data: { status: 'WITHDRAWN', closedAt: new Date() },
      });
      if (changed.count === 0) {
        throw this.conflict('INVALID_CLAIM_STATE', 'Khiếu nại vừa thay đổi trạng thái.');
      }
      await tx.orderEvent.create({
        data: {
          orderId: claim.orderId,
          type: 'claim.withdrawn',
          actorId: actor.sub,
          message: `Khách rút khiếu nại: ${input.reason}`,
          data: { claimId: claim.id, reason: input.reason },
        },
      });
      return tx.claim.findUniqueOrThrow({ where: { id: claim.id }, include: CLAIM_INCLUDE });
    });

    await this.notifyParties(claim.order, 'claim.withdrawn', {
      orderNo: claim.order.orderNo,
      claimNo: claim.claimNo,
    });
    this.emitRealtime(claim.orderId, { claimId: claim.id, status: updated.status });
    return this.view(updated, role, await this.extras(claim.orderId));
  }

  // GET /admin/claims
  async listForAdmin(query: ListAdminClaimsInput) {
    const where: Prisma.ClaimWhereInput = {};
    if (query.status) where.status = query.status as ClaimStatus;
    if (query.orderId) where.orderId = query.orderId;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.claim.count({ where }),
      this.prisma.claim.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: CLAIM_INCLUDE,
      }),
    ]);
    return {
      items: rows.map((row) => this.adminView(row)),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  // ---------------------------------------------------------------- helpers

  private async loadOrder(orderId: string): Promise<OrderRef> {
    const order = orderId
      ? await this.prisma.order.findUnique({ where: { id: orderId }, select: ORDER_SELECT })
      : null;
    if (!order) throw new NotFoundException(ORDER_NOT_FOUND);
    return order;
  }

  private async loadClaim(claimId: string): Promise<ClaimWithRelations> {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      include: CLAIM_INCLUDE,
    });
    if (!claim) throw new NotFoundException(CLAIM_NOT_FOUND);
    return claim;
  }

  private async resolveRole(
    order: { buyerId: string; supplierId: string },
    actor: AccessPayload,
  ): Promise<ViewerRole | null> {
    if (order.buyerId === actor.sub) return 'buyer';
    const supplierId = await this.supplierIdFor(actor.sub);
    if (supplierId && supplierId === order.supplierId) return 'supplier';
    if (['admin', 'sales', 'inspector'].includes(actor.role)) return 'staff';
    return null;
  }

  private claimRole(role: ViewerRole | null, actor: AccessPayload): ClaimActorRole | null {
    if (role === 'buyer') return 'buyer';
    if (role === 'supplier') return 'supplier';
    if (role === 'staff') {
      if (actor.role === 'sales') return 'sales';
      if (actor.role === 'inspector') return 'inspector';
      return 'admin';
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

  private assertTransition(status: string, to: ClaimStatusCode, actor: ClaimActorRole): void {
    const result = transitionClaim(status as ClaimStatusCode, to, { role: actor });
    if (result.ok) return;
    const body = { code: result.code, message: result.message };
    if (result.code === 'FORBIDDEN') throw new ForbiddenException(body);
    throw new ConflictException(body);
  }

  private deliveredAt(order: OrderRef): Date | null {
    const shipment = order.shipments[0];
    if (shipment) return shipment.deliveredAt ?? shipment.updatedAt;
    // Legacy rows confirmed receipt without a shipment row: fall back to the
    // order's last update so the window still has a start point.
    if (order.status === 'RECEIVED') return order.updatedAt;
    return null;
  }

  private unitPrice(order: OrderRef, quantity: number): Prisma.Decimal {
    if (order.selectedQuote?.unitPrice) {
      return new Prisma.Decimal(order.selectedQuote.unitPrice).toDecimalPlaces(2);
    }
    return new Prisma.Decimal(order.totalAmount).div(quantity).toDecimalPlaces(2);
  }

  private async loadEvidenceFiles(
    actor: AccessPayload,
    ids: string[],
  ): Promise<Array<{ id: string; kind: 'PHOTO' | 'VIDEO' }>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) {
      throw this.conflict('CLAIM_EVIDENCE_REQUIRED', 'Cần ít nhất một ảnh/video làm chứng cứ.');
    }
    const files = await this.prisma.fileObject.findMany({
      where: { id: { in: unique } },
      select: { id: true, ownerId: true, status: true, scanStatus: true, detectedMime: true },
    });
    if (files.length !== unique.length) {
      throw new NotFoundException('Tệp chứng cứ không tồn tại.');
    }
    return files.map((file) => {
      if (file.ownerId !== actor.sub) {
        throw new ForbiddenException('Bạn chỉ được dùng tệp do mình tải lên.');
      }
      if (file.status !== 'READY' || file.scanStatus === 'INFECTED') {
        throw this.conflict('FILE_NOT_READY', 'Tệp chứng cứ chưa sẵn sàng hoặc không an toàn.');
      }
      return {
        id: file.id,
        kind: file.detectedMime?.startsWith('video/') ? ('VIDEO' as const) : ('PHOTO' as const),
      };
    });
  }

  private async assertEvidenceFile(
    actor: AccessPayload,
    fileObjectId: string,
  ): Promise<{ id: string }> {
    const file = await this.prisma.fileObject.findUnique({
      where: { id: fileObjectId },
      select: { id: true, ownerId: true, status: true, scanStatus: true },
    });
    if (!file) throw new NotFoundException('Tệp chứng cứ không tồn tại.');
    if (file.ownerId !== actor.sub) {
      throw new ForbiddenException('Bạn chỉ được dùng tệp do mình tải lên.');
    }
    if (file.status !== 'READY' || file.scanStatus === 'INFECTED') {
      throw this.conflict('FILE_NOT_READY', 'Tệp chứng cứ chưa sẵn sàng hoặc không an toàn.');
    }
    return { id: file.id };
  }

  private async paidTotal(orderId: string, currency: string): Promise<Prisma.Decimal> {
    const result = await this.prisma.payment.aggregate({
      where: {
        purposeType: 'order',
        purposeId: orderId,
        status: { in: [...PAID_STATUSES] },
        currency,
      },
      _sum: { amount: true },
    });
    return result._sum.amount ?? new Prisma.Decimal(0);
  }

  private async refundedTotal(orderId: string, currency: string): Promise<Prisma.Decimal> {
    const result = await this.prisma.refund.aggregate({
      where: { orderId, currency, status: { in: [...REFUND_STATUSES] } },
      _sum: { amount: true },
    });
    return result._sum.amount ?? new Prisma.Decimal(0);
  }

  private async uniqueClaimNo(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = `CVC-CLM-${hex(6)}`;
      const exists = await this.prisma.claim.findUnique({
        where: { claimNo: code },
        select: { id: true },
      });
      if (!exists) return code;
    }
    throw this.conflict('REFERENCE_GENERATION_FAILED', 'Không tạo được mã khiếu nại, thử lại.');
  }

  private async extras(orderId: string) {
    const [lockedTerms, contract] = await Promise.all([
      this.prisma.lockedTerms.findUnique({
        where: { orderId },
        select: { id: true, terms: true, currency: true, version: true, lockedAt: true },
      }),
      this.prisma.contract.findFirst({
        where: { ownerType: 'sourcing_order', ownerId: orderId, status: 'SIGNED' },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          signedFileObjectId: true,
          fileHash: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);
    return { lockedTerms, contract };
  }

  private view(
    claim: ClaimWithRelations,
    role: ViewerRole,
    extras: { lockedTerms: unknown; contract: unknown },
  ) {
    const status = claim.status as ClaimStatusCode;
    return {
      ...this.adminView(claim),
      viewerRole: role,
      lockedTerms: extras.lockedTerms,
      contract: extras.contract,
      canPropose:
        (role === 'supplier' || role === 'staff') && ['OPEN', 'PROPOSED'].includes(status),
      canChooseResolution: role === 'buyer' && status === 'PROPOSED',
      canAdvanceTopup:
        (role === 'supplier' || role === 'staff') &&
        status === 'TOPUP_PENDING' &&
        claim.topupStage < 3,
      canConfirmTopup: role === 'buyer' && status === 'TOPUP_PENDING' && claim.topupStage >= 3,
      canSendReturn: role === 'buyer' && status === 'RESOLUTION_CHOSEN',
      canReceiveReturn: role === 'staff' && status === 'RETURN_SENT',
      canExecuteRefund:
        role === 'staff' && ['RESOLUTION_CHOSEN', 'RETURN_RECEIVED'].includes(status),
      canConfirmRefund: role === 'buyer' && status === 'REFUND_EXECUTED',
      canResolve: role === 'staff' && ['TOPUP_CONFIRMED', 'REFUND_CONFIRMED'].includes(status),
      canReject:
        role === 'staff' &&
        [
          'OPEN',
          'PROPOSED',
          'RESOLUTION_CHOSEN',
          'TOPUP_PENDING',
          'RETURN_SENT',
          'RETURN_RECEIVED',
        ].includes(status),
      canWithdraw: role === 'buyer' && ['OPEN', 'PROPOSED', 'RESOLUTION_CHOSEN'].includes(status),
    };
  }

  private adminView(claim: ClaimWithRelations) {
    return {
      id: claim.id,
      claimNo: claim.claimNo,
      type: claim.type,
      status: claim.status,
      reason: claim.reason,
      order: claim.order,
      filedBy: claim.filedBy,
      orderedQuantity: claim.orderedQuantity,
      missingQuantity: claim.missingQuantity,
      actualQuantity: claim.actualQuantity,
      unitPrice: claim.unitPrice,
      amount: claim.amount,
      currency: claim.currency,
      resolutionKind: claim.resolutionKind,
      topupStage: claim.topupStage,
      topupDeliveredAt: claim.topupDeliveredAt,
      proposedAt: claim.proposedAt,
      chosenAt: claim.chosenAt,
      closedAt: claim.closedAt,
      createdAt: claim.createdAt,
      updatedAt: claim.updatedAt,
      evidences: claim.evidences.map((row) => ({
        id: row.id,
        fileObjectId: row.fileObjectId,
        kind: row.kind,
        createdAt: row.createdAt,
      })),
      proposals: claim.proposals.map((row) => ({
        id: row.id,
        kind: row.kind,
        amount: row.amount,
        currency: row.currency,
        note: row.note,
        status: row.status,
        proposedBy: row.proposedBy,
        createdAt: row.createdAt,
      })),
      resolution: claim.resolution
        ? {
            id: claim.resolution.id,
            decision: claim.resolution.decision,
            note: claim.resolution.note,
            decidedBy: claim.resolution.decidedBy,
            decidedAt: claim.resolution.decidedAt,
          }
        : null,
      returns: claim.returns.map((row) => ({
        id: row.id,
        direction: row.direction,
        carrier: row.carrier,
        trackingNo: row.trackingNo,
        status: row.status,
        proofFileObjectId: row.proofFileObjectId,
        shippedAt: row.shippedAt,
        deliveredAt: row.deliveredAt,
        createdAt: row.createdAt,
      })),
      refunds: claim.refunds.map((row) => this.refundView(row)),
    };
  }

  private refundView(refund: {
    id: string;
    amount: Prisma.Decimal;
    currency: string;
    method: string;
    status: string;
    paymentRef: string | null;
    note: string | null;
    completedAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: refund.id,
      amount: refund.amount,
      currency: refund.currency,
      method: refund.method,
      status: refund.status,
      paymentRef: refund.paymentRef,
      note: refund.note,
      completedAt: refund.completedAt,
      createdAt: refund.createdAt,
    };
  }

  private async notifyBuyer(
    order: { id: string; orderNo: string; buyerId: string },
    event: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.notifications.emit(event, order.buyerId, data);
  }

  private async notifyParties(
    order: { id: string; orderNo: string; buyerId: string; supplierId: string },
    event: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const ids = new Set<string>([order.buyerId]);
    const supplier = await this.prisma.supplierAccount.findFirst({
      where: { supplierId: order.supplierId },
      select: { userId: true },
    });
    if (supplier) ids.add(supplier.userId);
    for (const userId of ids) await this.notifications.emit(event, userId, data);
  }

  private async notifyAdmins(event: string, data: Record<string, unknown>): Promise<void> {
    let rows = await this.prisma.userRole.findMany({
      where: { role: { in: ['admin_ops', 'admin_finance', 'admin_super'] } },
      select: { userId: true },
    });
    if (rows.length === 0) {
      rows = await this.prisma.userRole.findMany({
        where: { role: 'admin' },
        select: { userId: true },
      });
    }
    const ids = new Set(rows.map((row) => row.userId));
    for (const userId of ids) await this.notifications.emit(event, userId, data);
  }

  private emitRealtime(orderId: string, payload: Record<string, unknown>): void {
    void this.prisma.dealRoom
      .findUnique({ where: { orderId }, select: { id: true } })
      .then((room) => {
        if (!room) return;
        this.realtime.toDealRoom(room.id, 'claim.status', { orderId, ...payload });
      })
      .catch(() => undefined);
  }

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }
}

function hex(bytes: number): string {
  return randomBytes(bytes).toString('hex').toUpperCase();
}
