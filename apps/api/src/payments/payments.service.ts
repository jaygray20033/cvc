import { randomBytes } from 'node:crypto';

import { Role } from '@cvc/shared';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { type PaymentStatus, Prisma } from '@prisma/client';

import type { AccessPayload } from '../common/decorators/current-user.decorator';
import { ConservationService } from '../common/ledger/conservation.service';
import { LedgerService } from '../common/ledger/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SystemSettingsService } from '../settings/system-settings.service';
import type {
  ApprovePaymentInput,
  CreateOrderPaymentInput,
  RejectPaymentInput,
  RequestMorePaymentInput,
  SubmitPaymentProofInput,
} from './payments.dto';

// P4.19 A — manual P2P payments (D3/D13). The buyer creates a request with a
// unique transfer reference, uploads a bank-transfer proof, and an admin
// finance user approves the amount actually received. The ledger is written
// only on approval; a short transfer becomes PARTIAL plus a follow-up request.
const PAYMENT_NOT_FOUND = 'Yêu cầu thanh toán không tồn tại.';
const ORDER_NOT_FOUND = 'Đơn hàng không tồn tại.';
const ACTIVE_STATUSES: PaymentStatus[] = ['AWAITING_PROOF', 'PROOF_SUBMITTED'];
const PAID_STATUSES: PaymentStatus[] = ['CONFIRMED', 'APPROVED', 'PARTIAL'];

const PAYMENT_INCLUDE = Prisma.validator<Prisma.PaymentInclude>()({
  receivingAccount: {
    select: { bankName: true, holderName: true, accountNoLast4: true, bankCode: true },
  },
  proofs: { orderBy: { createdAt: 'desc' } },
  user: { select: { id: true, email: true } },
});

const ORDER_SELECT = {
  id: true,
  orderNo: true,
  buyerId: true,
  supplierId: true,
  status: true,
  currency: true,
  totalAmount: true,
  depositAmount: true,
} as const;

type OrderRef = Prisma.OrderGetPayload<{ select: typeof ORDER_SELECT }>;
type PaymentWithRelations = Prisma.PaymentGetPayload<{ include: typeof PAYMENT_INCLUDE }>;
type ViewerRole = 'buyer' | 'supplier' | 'staff';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SystemSettingsService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly ledger: LedgerService,
    private readonly conservation: ConservationService,
  ) {}

  // POST /orders/:id/payments
  async create(actor: AccessPayload, orderId: string, input: CreateOrderPaymentInput) {
    const order = await this.loadOrder(orderId);
    const role = await this.resolveRole(order, actor);
    if (!role) throw new NotFoundException(ORDER_NOT_FOUND);
    if (role !== 'buyer') {
      throw new ForbiddenException('Chỉ khách hàng của đơn được tạo yêu cầu thanh toán.');
    }

    // Deposit requests start once the contract exists, final payment after QC.
    const allowed = input.kind === 'DEPOSIT' ? ['CONTRACT', 'DEPOSIT'] : ['FINAL_PAYMENT'];
    if (!allowed.includes(order.status)) {
      throw this.conflict(
        'ORDER_NOT_READY_FOR_PAYMENT',
        input.kind === 'DEPOSIT'
          ? 'Đơn chưa ở bước hợp đồng/đặt cọc.'
          : 'Đơn chưa ở bước thanh toán còn lại.',
      );
    }

    const existing = await this.prisma.payment.findFirst({
      where: {
        purposeType: 'order',
        purposeId: order.id,
        kind: input.kind,
        status: { in: ACTIVE_STATUSES },
      },
      include: PAYMENT_INCLUDE,
    });
    if (existing) return { ...this.view(existing, order, role), reused: true };

    const paid = await this.paidTotal(order.id, order.currency);
    const target =
      input.kind === 'DEPOSIT'
        ? new Prisma.Decimal(order.depositAmount ?? order.totalAmount)
        : new Prisma.Decimal(order.totalAmount);
    const remaining = target.minus(paid);
    if (remaining.lte(0)) {
      throw this.conflict(
        'PAYMENT_ALREADY_COVERED',
        input.kind === 'DEPOSIT' ? 'Khoản đặt cọc đã được thanh toán đủ.' : 'Đơn đã thanh toán đủ.',
      );
    }

    const receivingAccount = await this.prisma.receivingAccount.findFirst({
      where: { isActive: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: { id: true },
    });
    if (!receivingAccount) {
      throw this.conflict(
        'NO_RECEIVING_ACCOUNT',
        'Chưa có tài khoản nhận tiền đang hoạt động; liên hệ admin.',
      );
    }

    const dueDays = await this.settings.get<number>('payments.proofDueDays');
    const dueAt = new Date(Date.now() + dueDays * 86_400_000);
    const paymentNo = await this.uniqueValue('paymentNo', () => `CVC-PAY-${hex(6)}`);
    const referenceCode = await this.uniqueReference();

    const payment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          paymentNo,
          userId: actor.sub,
          purposeType: 'order',
          purposeId: order.id,
          kind: input.kind,
          amount: remaining,
          requestedAmount: remaining,
          referenceCode,
          receivingAccountId: receivingAccount.id,
          currency: order.currency,
          status: 'AWAITING_PROOF',
          dueAt,
          note: input.note ?? null,
        },
        include: PAYMENT_INCLUDE,
      });
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          type: 'payment.requested',
          actorId: actor.sub,
          message: `Yêu cầu thanh toán ${input.kind.toLowerCase()} ${remaining} ${order.currency}.`,
          data: {
            paymentId: created.id,
            paymentNo: created.paymentNo,
            kind: input.kind,
            amount: remaining.toString(),
            referenceCode,
            dueAt: dueAt.toISOString(),
          },
        },
      });
      return created;
    });

    this.logger.log(
      { orderId, paymentId: payment.id, kind: input.kind, amount: remaining.toString() },
      'payment requested',
    );
    return { ...this.view(payment, order, role), reused: false };
  }

  // GET /orders/:id/payments
  async listForOrder(actor: AccessPayload, orderId: string) {
    const order = await this.loadOrder(orderId);
    const role = await this.resolveRole(order, actor);
    if (!role) throw new NotFoundException(ORDER_NOT_FOUND);
    if (role === 'supplier') {
      throw new ForbiddenException('Nhà cung cấp không được xem thông tin thanh toán của khách.');
    }
    await this.expireDue();

    const rows = await this.prisma.payment.findMany({
      where: { purposeType: 'order', purposeId: order.id },
      orderBy: { createdAt: 'desc' },
      include: PAYMENT_INCLUDE,
    });
    return { orderId, items: rows.map((row) => this.view(row, order, role)) };
  }

  // GET /payments/:id
  async detail(actor: AccessPayload, paymentId: string) {
    const payment = await this.loadPayment(paymentId);
    const order = await this.loadOrder(payment.purposeId ?? '');
    const role = await this.resolveRole(order, actor);
    if (!role) throw new NotFoundException(PAYMENT_NOT_FOUND);
    if (role === 'supplier') {
      throw new ForbiddenException('Nhà cung cấp không được xem thông tin thanh toán của khách.');
    }
    const fresh = await this.expireOne(payment);
    return this.view(fresh, order, role);
  }

  // POST /payments/:id/proofs
  async submitProof(actor: AccessPayload, paymentId: string, input: SubmitPaymentProofInput) {
    const payment = await this.loadPayment(paymentId);
    const order = await this.loadOrder(payment.purposeId ?? '');
    const role = await this.resolveRole(order, actor);
    if (!role) throw new NotFoundException(PAYMENT_NOT_FOUND);
    if (role !== 'buyer') {
      throw new ForbiddenException('Chỉ khách hàng của đơn được nộp minh chứng thanh toán.');
    }
    if (payment.status === 'EXPIRED' || (payment.dueAt && payment.dueAt < new Date())) {
      await this.expireOne(payment);
      throw this.conflict('PAYMENT_EXPIRED', 'Yêu cầu thanh toán đã quá hạn nộp minh chứng.');
    }
    if (payment.status !== 'AWAITING_PROOF' && payment.status !== 'REJECTED') {
      throw this.conflict(
        'INVALID_PAYMENT_STATE',
        'Yêu cầu này không còn nhận minh chứng thanh toán.',
      );
    }

    const file = await this.prisma.fileObject.findUnique({
      where: { id: input.fileObjectId },
      select: {
        id: true,
        ownerId: true,
        status: true,
        scanStatus: true,
        sha256: true,
      },
    });
    if (!file) throw new NotFoundException('Tệp minh chứng không tồn tại.');
    if (file.ownerId !== actor.sub) {
      throw new ForbiddenException('Bạn chỉ được dùng tệp do mình tải lên.');
    }
    if (file.status !== 'READY' || file.scanStatus === 'INFECTED') {
      throw this.conflict('FILE_NOT_READY', 'Tệp minh chứng chưa sẵn sàng hoặc không an toàn.');
    }
    if (!file.sha256) {
      throw this.conflict('PROOF_FILE_UNHASHED', 'Tệp minh chứng thiếu mã băm để chống trùng.');
    }

    const usedImage = await this.prisma.paymentProof.findFirst({
      where: { sha256: file.sha256 },
      select: { id: true, paymentId: true },
    });
    if (usedImage) {
      throw this.conflict(
        'DUPLICATE_PROOF_IMAGE',
        'Ảnh minh chứng này đã được dùng cho một giao dịch khác.',
      );
    }
    const usedRef = await this.prisma.paymentProof.findFirst({
      where: { transactionRef: input.transactionRef },
      select: { id: true },
    });
    if (usedRef) {
      throw this.conflict(
        'DUPLICATE_TRANSACTION_REF',
        'Mã giao dịch đã được dùng cho giao dịch khác.',
      );
    }

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.payment.updateMany({
        where: { id: payment.id, status: payment.status },
        data: { status: 'PROOF_SUBMITTED', proofSubmittedAt: now },
      });
      if (changed.count === 0) {
        throw this.conflict('INVALID_PAYMENT_STATE', 'Yêu cầu vừa thay đổi trạng thái.');
      }
      await tx.paymentProof.create({
        data: {
          paymentId: payment.id,
          fileObjectId: file.id,
          sha256: file.sha256 as string,
          amount: input.amount,
          transferredAt: input.transferredAt,
          senderBank: input.senderBank,
          transactionRef: input.transactionRef,
          note: input.note ?? null,
          uploadedById: actor.sub,
        },
      });
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          type: 'payment.proof_submitted',
          actorId: actor.sub,
          message: `Khách đã nộp minh chứng ${input.amount} ${payment.currency}.`,
          data: {
            paymentId: payment.id,
            paymentNo: payment.paymentNo,
            amount: input.amount,
            transactionRef: input.transactionRef,
            senderBank: input.senderBank,
            transferredAt: input.transferredAt.toISOString(),
          },
        },
      });
      return tx.payment.findUniqueOrThrow({ where: { id: payment.id }, include: PAYMENT_INCLUDE });
    });

    await this.notifyAdmins('payment.proof_submitted', {
      paymentNo: payment.paymentNo,
      orderNo: order.orderNo,
      amount: input.amount,
      currency: payment.currency,
    });
    this.logger.log({ paymentId, actor: actor.sub }, 'payment proof submitted');
    return this.view(updated, order, role);
  }

  // POST /admin/payments/:id/approve — records the amount seen in the bank.
  async approve(actor: AccessPayload, paymentId: string, input: ApprovePaymentInput) {
    const payment = await this.loadPayment(paymentId);
    const order = await this.loadOrder(payment.purposeId ?? '');
    await this.expireOne(payment);
    const fresh = await this.loadPayment(paymentId);
    if (fresh.status !== 'PROOF_SUBMITTED') {
      throw this.conflict(
        'INVALID_PAYMENT_STATE',
        'Yêu cầu chưa có minh chứng hoặc đã được xử lý.',
      );
    }
    const proofs = fresh.proofs;
    if (proofs.length === 0) {
      throw this.conflict('PROOF_REQUIRED', 'Chưa có ảnh minh chứng để duyệt.');
    }

    const received = new Prisma.Decimal(input.receivedAmount);
    const requested = new Prisma.Decimal(fresh.requestedAmount ?? fresh.amount);
    const partial = received.lt(requested);
    const missing = requested.minus(received);
    const latestProof = proofs[0];
    const receivedAt = latestProof.transferredAt ?? new Date();
    const dueDays = await this.settings.get<number>('payments.proofDueDays');

    const result = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.payment.updateMany({
        where: { id: fresh.id, status: 'PROOF_SUBMITTED' },
        data: {
          status: partial ? 'PARTIAL' : 'APPROVED',
          amount: received,
          approvedAmount: received,
          confirmedById: actor.sub,
          confirmedAt: new Date(),
          receivedAt,
          note: input.note ?? fresh.note,
        },
      });
      if (changed.count === 0) {
        throw this.conflict('INVALID_PAYMENT_STATE', 'Yêu cầu vừa được xử lý bởi người khác.');
      }

      const ledger = await this.ledger.post(tx, {
        type: 'PAYMENT',
        refType: 'payment',
        refId: fresh.id,
        currency: fresh.currency,
        createdById: actor.sub,
        note: `Duyệt thanh toán ${fresh.paymentNo}`,
        lines: [
          {
            accountCode: 'CVC-BANK',
            accountName: 'Tiền gửi ngân hàng CVC',
            accountType: 'ASSET',
            side: 'DEBIT',
            amount: received,
          },
          {
            accountCode: `CUS-${order.buyerId}`,
            accountName: `Khách hàng ${order.buyerId}`,
            accountType: 'LIABILITY',
            side: 'CREDIT',
            amount: received,
          },
        ],
      });
      if (ledger.alreadyPosted) {
        throw this.conflict('PAYMENT_ALREADY_POSTED', 'Thanh toán này đã được ghi sổ cái.');
      }

      let followUpId: string | null = null;
      if (partial) {
        const receivable = await tx.receivingAccount.findFirst({
          where: { isActive: true },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
          select: { id: true },
        });
        if (!receivable) {
          throw this.conflict(
            'NO_RECEIVING_ACCOUNT',
            'Chưa có tài khoản nhận tiền đang hoạt động.',
          );
        }
        const paymentNo = await this.uniqueValue('paymentNo', () => `CVC-PAY-${hex(6)}`, tx);
        const referenceCode = await this.uniqueReference(tx);
        const followUp = await tx.payment.create({
          data: {
            paymentNo,
            userId: order.buyerId,
            purposeType: 'order',
            purposeId: order.id,
            kind: fresh.kind,
            amount: missing,
            requestedAmount: missing,
            referenceCode,
            receivingAccountId: receivable.id,
            currency: fresh.currency,
            status: 'AWAITING_PROOF',
            dueAt: new Date(Date.now() + dueDays * 86_400_000),
            note: `Phần còn thiếu của ${fresh.paymentNo}`,
          },
          select: { id: true },
        });
        followUpId = followUp.id;
      }

      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          type: partial ? 'payment.partial' : 'payment.approved',
          actorId: actor.sub,
          message: partial
            ? `Duyệt một phần ${received} ${fresh.currency}; còn thiếu ${missing}.`
            : `Đã duyệt thanh toán ${received} ${fresh.currency}.`,
          data: {
            paymentId: fresh.id,
            paymentNo: fresh.paymentNo,
            receivedAmount: received.toString(),
            requestedAmount: requested.toString(),
            missingAmount: missing.toString(),
            followUpId,
            ledgerTransactionId: ledger.transactionId,
          },
        },
      });
      return { ledgerTransactionId: ledger.transactionId, followUpId };
    });

    // P4.25: verify money conservation after the approval commits.
    await this.conservation.runAfter('payment.approve');

    await this.notifications.emit(partial ? 'payment.partial' : 'payment.approved', order.buyerId, {
      orderNo: order.orderNo,
      paymentNo: fresh.paymentNo,
      amount: received.toString(),
      missingAmount: missing.toString(),
      currency: fresh.currency,
    });
    if (result.followUpId) {
      await this.notifications.emit('payment.follow_up_created', order.buyerId, {
        orderNo: order.orderNo,
        amount: missing.toString(),
        currency: fresh.currency,
      });
    }
    this.emitRealtime(order.id, {
      paymentId: fresh.id,
      status: partial ? 'PARTIAL' : 'APPROVED',
      amount: received.toString(),
    });

    const saved = await this.loadPayment(fresh.id);
    const followUp = result.followUpId
      ? await this.prisma.payment.findUniqueOrThrow({
          where: { id: result.followUpId },
          include: PAYMENT_INCLUDE,
        })
      : null;
    this.logger.log(
      { paymentId, received: received.toString(), partial, ledger: result.ledgerTransactionId },
      'payment approved',
    );
    return {
      payment: this.view(saved, order, 'staff'),
      followUp: followUp ? this.view(followUp, order, 'staff') : null,
      ledgerTransactionId: result.ledgerTransactionId,
    };
  }

  // POST /admin/payments/:id/reject
  async reject(actor: AccessPayload, paymentId: string, input: RejectPaymentInput) {
    const payment = await this.loadPayment(paymentId);
    const order = await this.loadOrder(payment.purposeId ?? '');
    if (payment.status !== 'PROOF_SUBMITTED') {
      throw this.conflict('INVALID_PAYMENT_STATE', 'Chỉ từ chối được yêu cầu đã có minh chứng.');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.payment.updateMany({
        where: { id: payment.id, status: 'PROOF_SUBMITTED' },
        data: { status: 'REJECTED', confirmedById: actor.sub, note: input.reason },
      });
      if (changed.count === 0) {
        throw this.conflict('INVALID_PAYMENT_STATE', 'Yêu cầu vừa được xử lý bởi người khác.');
      }
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          type: 'payment.rejected',
          actorId: actor.sub,
          message: `Từ chối minh chứng thanh toán: ${input.reason}`,
          data: { paymentId: payment.id, paymentNo: payment.paymentNo, reason: input.reason },
        },
      });
      return tx.payment.findUniqueOrThrow({ where: { id: payment.id }, include: PAYMENT_INCLUDE });
    });
    await this.notifications.emit('payment.rejected', order.buyerId, {
      orderNo: order.orderNo,
      paymentNo: payment.paymentNo,
      reason: input.reason,
    });
    this.emitRealtime(order.id, { paymentId: payment.id, status: 'REJECTED' });
    return this.view(updated, order, 'staff');
  }

  // POST /admin/payments/:id/request-more
  async requestMore(actor: AccessPayload, paymentId: string, input: RequestMorePaymentInput) {
    const payment = await this.loadPayment(paymentId);
    const order = await this.loadOrder(payment.purposeId ?? '');
    if (!['PROOF_SUBMITTED', 'AWAITING_PROOF'].includes(payment.status)) {
      throw this.conflict('INVALID_PAYMENT_STATE', 'Yêu cầu này không thể yêu cầu bổ sung.');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.payment.updateMany({
        where: { id: payment.id, status: payment.status },
        data: { status: 'AWAITING_PROOF', proofSubmittedAt: null, note: input.reason },
      });
      if (changed.count === 0) {
        throw this.conflict('INVALID_PAYMENT_STATE', 'Yêu cầu vừa thay đổi trạng thái.');
      }
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          type: 'payment.more_requested',
          actorId: actor.sub,
          message: `Yêu cầu bổ sung minh chứng: ${input.reason}`,
          data: { paymentId: payment.id, paymentNo: payment.paymentNo, reason: input.reason },
        },
      });
      return tx.payment.findUniqueOrThrow({ where: { id: payment.id }, include: PAYMENT_INCLUDE });
    });
    await this.notifications.emit('payment.more_requested', order.buyerId, {
      orderNo: order.orderNo,
      paymentNo: payment.paymentNo,
      reason: input.reason,
    });
    return this.view(updated, order, 'staff');
  }

  // GET /admin/payments — finance queue, newest proofs first.
  async listForAdmin(query: { status?: string; orderId?: string; page: number; limit: number }) {
    await this.expireDue();
    const where: Prisma.PaymentWhereInput = {};
    if (query.status) where.status = query.status as PaymentStatus;
    if (query.orderId) {
      where.purposeType = 'order';
      where.purposeId = query.orderId;
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where,
        orderBy: [{ proofSubmittedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: PAYMENT_INCLUDE,
      }),
    ]);
    const orderIds = [...new Set(rows.map((row) => row.purposeId).filter(Boolean))] as string[];
    const orders = await this.prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, orderNo: true, status: true },
    });
    const byId = new Map(orders.map((order) => [order.id, order]));
    return {
      items: rows.map((row) => {
        const order = byId.get(row.purposeId ?? '') ?? null;
        return {
          ...this.baseView(row),
          order: order ? { id: order.id, orderNo: order.orderNo, status: order.status } : null,
          payer: row.user,
          proofs: this.proofViews(row),
        };
      }),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  // ------------------------------------------------------------- expiration

  // Lazy + cron sweep: unpaid requests past dueAt become EXPIRED.
  async expireDue(now = new Date()): Promise<number> {
    const result = await this.prisma.payment.updateMany({
      where: { status: 'AWAITING_PROOF', dueAt: { lt: now } },
      data: { status: 'EXPIRED', expiredAt: now },
    });
    return result.count;
  }

  private async expireOne(payment: PaymentWithRelations): Promise<PaymentWithRelations> {
    if (payment.status !== 'AWAITING_PROOF' || !payment.dueAt || payment.dueAt >= new Date()) {
      return payment;
    }
    await this.prisma.payment.updateMany({
      where: { id: payment.id, status: 'AWAITING_PROOF' },
      data: { status: 'EXPIRED', expiredAt: new Date() },
    });
    return this.loadPayment(payment.id);
  }

  // ---------------------------------------------------------------- helpers

  private async loadPayment(paymentId: string): Promise<PaymentWithRelations> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: PAYMENT_INCLUDE,
    });
    if (!payment || payment.purposeType !== 'order') {
      throw new NotFoundException(PAYMENT_NOT_FOUND);
    }
    return payment;
  }

  private async loadOrder(orderId: string): Promise<OrderRef> {
    const order = orderId
      ? await this.prisma.order.findUnique({ where: { id: orderId }, select: ORDER_SELECT })
      : null;
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

  private async paidTotal(orderId: string, currency: string): Promise<Prisma.Decimal> {
    const result = await this.prisma.payment.aggregate({
      where: {
        purposeType: 'order',
        purposeId: orderId,
        status: { in: PAID_STATUSES },
        currency,
      },
      _sum: { amount: true },
    });
    return result._sum.amount ?? new Prisma.Decimal(0);
  }

  private async uniqueReference(tx?: Prisma.TransactionClient): Promise<string> {
    const client = tx ?? this.prisma;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = `PAY${hex(6)}`;
      const exists = await client.payment.findUnique({
        where: { referenceCode: code },
        select: { id: true },
      });
      if (!exists) return code;
    }
    throw this.conflict('REFERENCE_GENERATION_FAILED', 'Không tạo được mã tham chiếu, thử lại.');
  }

  private async uniqueValue(
    field: 'paymentNo',
    make: () => string,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const client = tx ?? this.prisma;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const value = make();
      const exists = await client.payment.findUnique({
        where: { [field]: value } as Prisma.PaymentWhereUniqueInput,
        select: { id: true },
      });
      if (!exists) return value;
    }
    throw this.conflict('REFERENCE_GENERATION_FAILED', 'Không tạo được mã thanh toán, thử lại.');
  }

  private view(payment: PaymentWithRelations, order: OrderRef, role: ViewerRole) {
    return {
      ...this.baseView(payment),
      order: { id: order.id, orderNo: order.orderNo, status: order.status },
      viewerRole: role,
      canSubmitProof:
        role === 'buyer' && (payment.status === 'AWAITING_PROOF' || payment.status === 'REJECTED'),
      proofs: this.proofViews(payment),
    };
  }

  private baseView(payment: PaymentWithRelations) {
    return {
      id: payment.id,
      paymentNo: payment.paymentNo,
      kind: payment.kind,
      status: payment.status,
      currency: payment.currency,
      amount: payment.amount,
      requestedAmount: payment.requestedAmount,
      approvedAmount: payment.approvedAmount,
      referenceCode: payment.referenceCode,
      transferContent: payment.referenceCode,
      dueAt: payment.dueAt,
      proofSubmittedAt: payment.proofSubmittedAt,
      expiredAt: payment.expiredAt,
      receivedAt: payment.receivedAt,
      confirmedAt: payment.confirmedAt,
      note: payment.note,
      receivingAccount: {
        bankName: payment.receivingAccount.bankName,
        holderName: payment.receivingAccount.holderName,
        accountNoMasked: `****${payment.receivingAccount.accountNoLast4}`,
        bankCode: payment.receivingAccount.bankCode,
      },
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
    };
  }

  private proofViews(payment: PaymentWithRelations) {
    return payment.proofs.map((proof) => ({
      id: proof.id,
      fileObjectId: proof.fileObjectId,
      amount: proof.amount,
      transferredAt: proof.transferredAt,
      senderBank: proof.senderBank,
      transactionRef: proof.transactionRef,
      note: proof.note,
      uploadedById: proof.uploadedById,
      createdAt: proof.createdAt,
    }));
  }

  private async notifyAdmins(event: string, data: Record<string, unknown>): Promise<void> {
    let rows = await this.prisma.userRole.findMany({
      where: { role: { in: ['admin_finance', 'admin_super'] } },
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
        this.realtime.toDealRoom(room.id, 'payment.status', { orderId, ...payload });
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
