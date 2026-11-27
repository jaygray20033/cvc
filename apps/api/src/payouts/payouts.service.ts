import { randomBytes } from 'node:crypto';

import { CLAIM_OPEN_STATUSES, Role } from '@cvc/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { type PayoutStatus, Prisma } from '@prisma/client';

import type { AccessPayload } from '../common/decorators/current-user.decorator';
import { ConservationService } from '../common/ledger/conservation.service';
import { LedgerService } from '../common/ledger/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SystemSettingsService } from '../settings/system-settings.service';
import type {
  ApprovePayoutInput,
  ConfirmPayoutReceivedInput,
  CreateSupplierPayoutInput,
  MarkPayoutPaidInput,
  RejectPayoutInput,
} from './payouts.dto';

// P4.20 — manual supplier payouts (D1: CVC holds the money and posts the
// ledger). Flow: PENDING → (first approval, second approval when the amount
// reaches the configured threshold) → APPROVED → mark-paid (proof of transfer
// + ledger posted once) → COMPLETED → supplier confirms receipt (or the cron
// auto-confirms after N days).
const PAYOUT_NOT_FOUND = 'Lệnh chi không tồn tại.';
const ORDER_NOT_FOUND = 'Đơn hàng không tồn tại.';

// Statuses that already reserve money of the order: a new payout may not push
// the total past the order value (anti-duplicate disbursement).
const COMMITTED_STATUSES: PayoutStatus[] = ['PENDING', 'APPROVED', 'PROCESSING', 'COMPLETED'];

const PAYOUT_INCLUDE = Prisma.validator<Prisma.PayoutInclude>()({
  bankAccount: {
    select: { bankName: true, holderName: true, accountNoLast4: true },
  },
  proofs: { orderBy: { createdAt: 'desc' } },
});

type PayoutWithRelations = Prisma.PayoutGetPayload<{ include: typeof PAYOUT_INCLUDE }>;
type OrderRef = {
  id: string;
  orderNo: string;
  buyerId: string;
  supplierId: string;
  status: string;
  totalAmount: Prisma.Decimal;
  currency: string;
};
type SupplierRef = { id: string; name: string; contactName: string | null; userIds: string[] };

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SystemSettingsService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly ledger: LedgerService,
    private readonly conservation: ConservationService,
  ) {}

  // POST /admin/orders/:id/supplier-payouts
  async createForOrder(actor: AccessPayload, orderId: string, input: CreateSupplierPayoutInput) {
    const order = await this.loadOrder(orderId);
    if (order.status === 'CANCELLED') {
      throw this.conflict('ORDER_CANCELLED', 'Đơn đã huỷ, không tạo được lệnh chi.');
    }
    // P4.22 — a supplier is not paid while a claim is still being handled
    // (mirrors the demo rule: received quantity/payout wait for the claim).
    const openClaims = await this.prisma.claim.count({
      where: { orderId: order.id, status: { in: [...CLAIM_OPEN_STATUSES] } },
    });
    if (openClaims > 0) {
      throw this.conflict('OPEN_CLAIMS', 'Đơn còn khiếu nại đang xử lý; chưa thể chi cho NCC.');
    }
    const supplier = await this.loadSupplier(order.supplierId);
    if (!supplier) throw new NotFoundException(ORDER_NOT_FOUND);

    if (!input.bankAccountId) {
      throw this.conflict(
        'PAYOUT_BANK_ACCOUNT_REQUIRED',
        'Cần chọn tài khoản nhận tiền đã xác minh của nhà cung cấp.',
      );
    }
    const bankAccount = await this.validateBankAccount(input.bankAccountId, supplier);

    const amount = new Prisma.Decimal(input.amount);
    const committed = await this.prisma.payout.aggregate({
      where: {
        purposeType: 'order',
        purposeId: order.id,
        status: { in: COMMITTED_STATUSES },
      },
      _sum: { amount: true },
    });
    const already = committed._sum.amount ?? new Prisma.Decimal(0);
    if (already.plus(amount).gt(order.totalAmount)) {
      throw this.conflict(
        'PAYOUT_EXCEEDS_ORDER',
        `Tổng chi cho đơn vượt giá trị đơn (đã lên lệnh ${already} ${order.currency}).`,
      );
    }

    const payoutNo = await this.uniqueValue('payoutNo', () => `CVC-PO-${hex(6)}`);
    const referenceCode = await this.uniqueReference();

    const payout = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payout.create({
        data: {
          payoutNo,
          payeeType: 'supplier',
          payeeId: supplier.id,
          bankAccountId: bankAccount.id,
          amount,
          currency: order.currency,
          status: 'PENDING',
          purposeType: 'order',
          purposeId: order.id,
          referenceCode,
          note: input.note ?? input.reason,
        },
        include: PAYOUT_INCLUDE,
      });
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          type: 'payout.requested',
          actorId: actor.sub,
          message: `Tạo lệnh chi NCC ${amount} ${order.currency} · ${referenceCode}.`,
          data: {
            payoutId: created.id,
            payoutNo,
            referenceCode,
            amount: amount.toString(),
            reason: input.reason,
          },
        },
      });
      return created;
    });

    await this.notifyAdmins('payout.requested', {
      payoutNo,
      orderNo: order.orderNo,
      amount: amount.toString(),
      currency: order.currency,
    });
    this.logger.log(
      { payoutId: payout.id, orderId, amount: amount.toString() },
      'payout requested',
    );
    return this.view(payout, { order, supplierName: supplier.name });
  }

  // POST /admin/payouts/:id/approve — one or two layers depending on amount.
  async approve(actor: AccessPayload, payoutId: string, input: ApprovePayoutInput) {
    const payout = await this.loadPayout(payoutId);
    if (payout.status !== 'PENDING') {
      throw this.conflict('INVALID_PAYOUT_STATE', 'Lệnh chi không còn ở trạng thái chờ duyệt.');
    }

    const threshold = await this.settings.get<number>('payouts.dualApprovalThreshold');
    const needsDual = payout.requiresSecondApproval || payout.amount.gte(threshold);
    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      if (payout.approvalCount === 0) {
        const second = needsDual;
        const changed = await tx.payout.updateMany({
          where: { id: payout.id, status: 'PENDING', approvalCount: 0 },
          data: {
            approvalCount: 1,
            requiresSecondApproval: second,
            firstApprovedById: actor.sub,
            ...(second ? {} : { status: 'APPROVED', approvedById: actor.sub, approvedAt: now }),
            note: input.note ?? payout.note,
          },
        });
        if (changed.count === 0) {
          throw this.conflict('INVALID_PAYOUT_STATE', 'Lệnh chi vừa được xử lý bởi người khác.');
        }
        await this.addOrderEvent(tx, payout, second ? 'payout.approved_first' : 'payout.approved', {
          actorId: actor.sub,
          message: second
            ? 'Duyệt lớp 1; chờ admin tài chính thứ hai duyệt.'
            : `Đã duyệt chi ${payout.amount} ${payout.currency}.`,
          data: { payoutNo: payout.payoutNo, approvalCount: 1 },
        });
      } else if (payout.requiresSecondApproval && payout.approvalCount === 1) {
        if (payout.firstApprovedById === actor.sub) {
          throw this.conflict(
            'PAYOUT_SECOND_APPROVER_REQUIRED',
            'Người duyệt lớp 2 phải khác người duyệt lớp 1.',
          );
        }
        const changed = await tx.payout.updateMany({
          where: {
            id: payout.id,
            status: 'PENDING',
            approvalCount: 1,
            requiresSecondApproval: true,
          },
          data: {
            approvalCount: 2,
            secondApprovedById: actor.sub,
            secondApprovedAt: now,
            status: 'APPROVED',
            approvedById: actor.sub,
            approvedAt: now,
            note: input.note ?? payout.note,
          },
        });
        if (changed.count === 0) {
          throw this.conflict('INVALID_PAYOUT_STATE', 'Lệnh chi vừa được xử lý bởi người khác.');
        }
        await this.addOrderEvent(tx, payout, 'payout.approved', {
          actorId: actor.sub,
          message: `Duyệt lớp 2, lệnh chi ${payout.amount} ${payout.currency} đã được duyệt.`,
          data: { payoutNo: payout.payoutNo, approvalCount: 2 },
        });
      } else {
        throw this.conflict('INVALID_PAYOUT_STATE', 'Lệnh chi đã được duyệt đủ lớp.');
      }
      return tx.payout.findUniqueOrThrow({ where: { id: payout.id }, include: PAYOUT_INCLUDE });
    });

    await this.notifySupplier(updated.payeeId, 'payout.approved', {
      payoutNo: updated.payoutNo,
      amount: updated.amount.toString(),
      currency: updated.currency,
      awaitingSecondApproval: updated.status === 'PENDING',
    });
    this.emitRealtime(updated, 'payout.approved');
    this.logger.log(
      { payoutId, status: updated.status, approvals: updated.approvalCount },
      'payout approved',
    );
    return this.view(updated, await this.contextFor(updated));
  }

  // POST /admin/payouts/:id/reject — allowed while not paid yet.
  async reject(actor: AccessPayload, payoutId: string, input: RejectPayoutInput) {
    const payout = await this.loadPayout(payoutId);
    if (!['PENDING', 'APPROVED'].includes(payout.status)) {
      throw this.conflict('INVALID_PAYOUT_STATE', 'Lệnh chi này không thể từ chối.');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.payout.updateMany({
        where: { id: payout.id, status: payout.status },
        data: {
          status: 'REJECTED',
          approvedById: actor.sub,
          approvedAt: new Date(),
          note: input.reason,
        },
      });
      if (changed.count === 0) {
        throw this.conflict('INVALID_PAYOUT_STATE', 'Lệnh chi vừa được xử lý bởi người khác.');
      }
      await this.addOrderEvent(tx, payout, 'payout.rejected', {
        actorId: actor.sub,
        message: `Từ chối lệnh chi: ${input.reason}`,
        data: { payoutNo: payout.payoutNo, reason: input.reason },
      });
      return tx.payout.findUniqueOrThrow({ where: { id: payout.id }, include: PAYOUT_INCLUDE });
    });

    await this.notifySupplier(updated.payeeId, 'payout.rejected', {
      payoutNo: updated.payoutNo,
      amount: updated.amount.toString(),
      currency: updated.currency,
      reason: input.reason,
    });
    this.emitRealtime(updated, 'payout.rejected');
    return this.view(updated, await this.contextFor(updated));
  }

  // POST /admin/payouts/:id/mark-paid — admin transferred outside the system.
  // The proof is written once and the ledger is posted exactly once.
  async markPaid(actor: AccessPayload, payoutId: string, input: MarkPayoutPaidInput) {
    const payout = await this.loadPayout(payoutId);
    if (payout.status !== 'APPROVED') {
      throw this.conflict('INVALID_PAYOUT_STATE', 'Chỉ đánh dấu đã chuyển cho lệnh đã duyệt.');
    }

    const file = await this.prisma.fileObject.findUnique({
      where: { id: input.fileObjectId },
      select: { id: true, ownerId: true, status: true, scanStatus: true, sha256: true },
    });
    if (!file) throw new NotFoundException('Tệp minh chứng chi không tồn tại.');
    if (file.ownerId !== actor.sub) {
      throw new ForbiddenException('Bạn chỉ được dùng tệp do mình tải lên.');
    }
    if (file.status !== 'READY' || file.scanStatus === 'INFECTED') {
      throw this.conflict('FILE_NOT_READY', 'Tệp minh chứng chưa sẵn sàng hoặc không an toàn.');
    }
    if (!file.sha256) {
      throw this.conflict('PROOF_FILE_UNHASHED', 'Tệp minh chứng thiếu mã băm để chống trùng.');
    }

    const [usedImage, usedProofRef, usedPayoutRef] = await Promise.all([
      this.prisma.payoutProof.findFirst({ where: { sha256: file.sha256 }, select: { id: true } }),
      this.prisma.payoutProof.findFirst({
        where: { transactionRef: input.transactionRef },
        select: { id: true },
      }),
      this.prisma.payout.findFirst({
        where: { transactionRef: input.transactionRef },
        select: { id: true },
      }),
    ]);
    if (usedImage) {
      throw this.conflict(
        'DUPLICATE_PROOF_IMAGE',
        'Ảnh minh chứng chi này đã được dùng cho giao dịch khác.',
      );
    }
    if (usedProofRef || usedPayoutRef) {
      throw this.conflict(
        'DUPLICATE_TRANSACTION_REF',
        'Mã giao dịch đã được dùng cho lệnh chi khác.',
      );
    }

    const paidAt = input.paidAt ?? new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.payout.updateMany({
        where: { id: payout.id, status: 'APPROVED' },
        data: {
          status: 'COMPLETED',
          paidById: actor.sub,
          paidAt,
          transactionRef: input.transactionRef,
          confirmedById: null,
          confirmedAt: null,
          note: input.note ?? payout.note,
        },
      });
      if (changed.count === 0) {
        throw this.conflict('INVALID_PAYOUT_STATE', 'Lệnh chi vừa được xử lý bởi người khác.');
      }
      await tx.payoutProof.create({
        data: {
          payoutId: payout.id,
          fileObjectId: file.id,
          sha256: file.sha256 as string,
          transactionRef: input.transactionRef,
          uploadedById: actor.sub,
          note: input.note ?? null,
        },
      });

      const ledger = await this.ledger.post(tx, {
        type: 'PAYOUT',
        refType: 'payout',
        refId: payout.id,
        currency: payout.currency,
        createdById: actor.sub,
        note: `Chi nhà cung cấp ${payout.payoutNo}`,
        lines: [
          {
            accountCode: `SUP-${payout.payeeId}`,
            accountName: `Phải trả nhà cung cấp ${payout.payeeId}`,
            accountType: 'LIABILITY',
            side: 'DEBIT',
            amount: payout.amount,
          },
          {
            accountCode: 'CVC-BANK',
            accountName: 'Tiền gửi ngân hàng CVC',
            accountType: 'ASSET',
            side: 'CREDIT',
            amount: payout.amount,
          },
        ],
      });
      if (ledger.alreadyPosted) {
        throw this.conflict('PAYOUT_ALREADY_POSTED', 'Lệnh chi này đã được ghi sổ cái.');
      }

      await this.addOrderEvent(tx, payout, 'payout.paid', {
        actorId: actor.sub,
        message: `Đã chuyển ${payout.amount} ${payout.currency} cho NCC.`,
        data: {
          payoutNo: payout.payoutNo,
          transactionRef: input.transactionRef,
          ledgerTransactionId: ledger.transactionId,
        },
      });
      return { ledgerTransactionId: ledger.transactionId };
    });

    // P4.25: verify money conservation after the payout commits.
    await this.conservation.runAfter('payout.mark-paid');

    const updated = await this.loadPayout(payout.id);
    await this.notifySupplier(updated.payeeId, 'payout.paid', {
      payoutNo: updated.payoutNo,
      amount: updated.amount.toString(),
      currency: updated.currency,
      transactionRef: input.transactionRef,
    });
    this.emitRealtime(updated, 'payout.paid');
    this.logger.log(
      { payoutId, transactionRef: input.transactionRef, ledger: result.ledgerTransactionId },
      'payout marked paid',
    );
    return {
      ...this.view(updated, await this.contextFor(updated)),
      ledgerTransactionId: result.ledgerTransactionId,
    };
  }

  // POST /payouts/:id/confirm-received — supplier accepts the money.
  async confirmReceived(actor: AccessPayload, payoutId: string, input: ConfirmPayoutReceivedInput) {
    const payout = await this.loadPayout(payoutId);
    if (payout.payeeType !== 'supplier') {
      throw new ForbiddenException('Chỉ nhà cung cấp nhận tiền được xác nhận.');
    }
    const account = await this.prisma.supplierAccount.findUnique({
      where: { userId: actor.sub },
      select: { supplierId: true },
    });
    if (!account || account.supplierId !== payout.payeeId) {
      throw new NotFoundException(PAYOUT_NOT_FOUND);
    }
    if (payout.status !== 'COMPLETED') {
      throw this.conflict('PAYOUT_NOT_PAID', 'Lệnh chi chưa được chuyển tiền.');
    }
    if (payout.confirmedAt) {
      return {
        ...this.view(payout, await this.contextFor(payout)),
        alreadyConfirmed: true,
      };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.payout.updateMany({
        where: { id: payout.id, confirmedAt: null },
        data: {
          confirmedById: actor.sub,
          confirmedAt: new Date(),
          ...(input.note ? { note: input.note } : {}),
        },
      });
      if (changed.count === 0) {
        return tx.payout.findUniqueOrThrow({ where: { id: payout.id }, include: PAYOUT_INCLUDE });
      }
      await this.addOrderEvent(tx, payout, 'payout.confirmed', {
        actorId: actor.sub,
        message: 'Nhà cung cấp xác nhận đã nhận tiền.',
        data: { payoutNo: payout.payoutNo, transactionRef: payout.transactionRef },
      });
      return tx.payout.findUniqueOrThrow({ where: { id: payout.id }, include: PAYOUT_INCLUDE });
    });

    await this.notifyAdmins('payout.confirmed', {
      payoutNo: updated.payoutNo,
      amount: updated.amount.toString(),
      currency: updated.currency,
    });
    this.emitRealtime(updated, 'payout.confirmed');
    return { ...this.view(updated, await this.contextFor(updated)), alreadyConfirmed: false };
  }

  // GET /admin/payouts — finance queue.
  async listForAdmin(query: { status?: string; orderId?: string; page: number; limit: number }) {
    const where: Prisma.PayoutWhereInput = {};
    if (query.status) where.status = query.status as PayoutStatus;
    if (query.orderId) {
      where.purposeType = 'order';
      where.purposeId = query.orderId;
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.payout.count({ where }),
      this.prisma.payout.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: PAYOUT_INCLUDE,
      }),
    ]);
    const orderIds = [...new Set(rows.map((row) => row.purposeId).filter(Boolean))] as string[];
    const supplierIds = [
      ...new Set(rows.filter((row) => row.payeeType === 'supplier').map((row) => row.payeeId)),
    ];
    const [orders, suppliers] = await Promise.all([
      this.prisma.order.findMany({
        where: { id: { in: orderIds } },
        select: { id: true, orderNo: true, buyerId: true, supplierId: true, status: true },
      }),
      this.prisma.supplier.findMany({
        where: { id: { in: supplierIds } },
        select: { id: true, name: true },
      }),
    ]);
    const orderById = new Map(orders.map((order) => [order.id, order]));
    const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
    return {
      items: rows.map((row) =>
        this.view(row, {
          order: row.purposeId ? (orderById.get(row.purposeId) ?? null) : null,
          supplierName: supplierById.get(row.payeeId)?.name ?? null,
        }),
      ),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  // GET /payouts/:id — supplier account or CVC staff.
  async detail(actor: AccessPayload, payoutId: string) {
    const payout = await this.loadPayout(payoutId);
    const staff =
      actor.role === Role.Admin || actor.role === Role.Sales || actor.role === Role.Inspector;
    if (!staff) {
      const account = await this.prisma.supplierAccount.findUnique({
        where: { userId: actor.sub },
        select: { supplierId: true },
      });
      if (!account || payout.payeeType !== 'supplier' || account.supplierId !== payout.payeeId) {
        throw new NotFoundException(PAYOUT_NOT_FOUND);
      }
    }
    return this.view(payout, await this.contextFor(payout));
  }

  // --------------------------------------------------------- auto-confirm

  // Cron sweep: transfers older than N days without supplier confirmation.
  async autoConfirm(now = new Date()): Promise<{ confirmed: number }> {
    const days = await this.settings.get<number>('payouts.autoConfirmDays');
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    const rows = await this.prisma.payout.findMany({
      where: {
        status: 'COMPLETED',
        confirmedAt: null,
        paidAt: { lt: cutoff },
      },
      select: { id: true, payoutNo: true, purposeType: true, purposeId: true },
      take: 100,
    });

    let confirmed = 0;
    for (const row of rows) {
      const done = await this.prisma.$transaction(async (tx) => {
        const changed = await tx.payout.updateMany({
          where: { id: row.id, confirmedAt: null },
          data: { confirmedById: 'SYSTEM', confirmedAt: now },
        });
        if (changed.count === 0) return false;
        if (row.purposeType === 'order' && row.purposeId) {
          await tx.orderEvent.create({
            data: {
              orderId: row.purposeId,
              type: 'payout.auto_confirmed',
              actorId: null,
              message: `Tự xác nhận lệnh chi ${row.payoutNo} sau ${days} ngày.`,
              data: { payoutId: row.id, autoConfirmed: true },
            },
          });
        }
        return true;
      });
      if (done) confirmed += 1;
    }
    return { confirmed };
  }

  // ---------------------------------------------------------------- helpers

  private async loadPayout(payoutId: string): Promise<PayoutWithRelations> {
    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
      include: PAYOUT_INCLUDE,
    });
    if (!payout) throw new NotFoundException(PAYOUT_NOT_FOUND);
    return payout;
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
        totalAmount: true,
        currency: true,
      },
    });
    if (!order) throw new NotFoundException(ORDER_NOT_FOUND);
    return order;
  }

  private async loadSupplier(supplierId: string): Promise<SupplierRef | null> {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: {
        id: true,
        name: true,
        contactName: true,
        accounts: { select: { userId: true } },
      },
    });
    if (!supplier) return null;
    return {
      id: supplier.id,
      name: supplier.name,
      contactName: supplier.contactName,
      userIds: supplier.accounts.map((account) => account.userId),
    };
  }

  // The receiving account must belong to a supplier user and the holder name
  // must match the verified supplier profile (P4.20 rule).
  private async validateBankAccount(bankAccountId: string, supplier: SupplierRef) {
    const account = await this.prisma.bankAccount.findUnique({
      where: { id: bankAccountId },
      select: {
        id: true,
        userId: true,
        bankName: true,
        holderName: true,
        accountNoLast4: true,
      },
    });
    if (!account) throw new NotFoundException('Tài khoản nhận tiền không tồn tại.');
    if (!account.userId || !supplier.userIds.includes(account.userId)) {
      throw this.badRequest(
        'PAYOUT_BANK_ACCOUNT_NOT_VERIFIED',
        'Tài khoản nhận tiền không thuộc người dùng đã xác minh của nhà cung cấp.',
      );
    }
    const holder = normalizeName(account.holderName);
    const allowed = [supplier.name, supplier.contactName]
      .filter((value): value is string => Boolean(value))
      .map((value) => normalizeName(value));
    if (!allowed.includes(holder)) {
      throw this.badRequest(
        'PAYOUT_HOLDER_MISMATCH',
        'Tên chủ tài khoản không khớp hồ sơ nhà cung cấp đã xác minh.',
      );
    }
    return account;
  }

  private async contextFor(payout: PayoutWithRelations) {
    const [order, supplier] = await Promise.all([
      payout.purposeType === 'order' && payout.purposeId
        ? this.prisma.order.findUnique({
            where: { id: payout.purposeId },
            select: { id: true, orderNo: true, buyerId: true, supplierId: true, status: true },
          })
        : Promise.resolve(null),
      payout.payeeType === 'supplier' ? this.loadSupplier(payout.payeeId) : Promise.resolve(null),
    ]);
    return { order, supplierName: supplier?.name ?? null };
  }

  private async addOrderEvent(
    tx: Prisma.TransactionClient,
    payout: PayoutWithRelations,
    type: string,
    payload: { actorId: string | null; message: string; data: Record<string, unknown> },
  ): Promise<void> {
    if (payout.purposeType !== 'order' || !payout.purposeId) return;
    await tx.orderEvent.create({
      data: {
        orderId: payout.purposeId,
        type,
        actorId: payload.actorId,
        message: payload.message,
        data: { payoutId: payout.id, ...payload.data },
      },
    });
  }

  private view(
    payout: PayoutWithRelations,
    extras: {
      order?: { id: string; orderNo: string; status?: string } | null;
      supplierName?: string | null;
    },
  ) {
    return {
      id: payout.id,
      payoutNo: payout.payoutNo,
      status: payout.status,
      payeeType: payout.payeeType,
      payeeId: payout.payeeId,
      supplierName: extras.supplierName ?? null,
      order: extras.order
        ? { id: extras.order.id, orderNo: extras.order.orderNo, status: extras.order.status }
        : null,
      amount: payout.amount,
      currency: payout.currency,
      referenceCode: payout.referenceCode,
      requiresSecondApproval: payout.requiresSecondApproval,
      approvalCount: payout.approvalCount,
      firstApprovedById: payout.firstApprovedById,
      secondApprovedById: payout.secondApprovedById,
      approvedById: payout.approvedById,
      approvedAt: payout.approvedAt,
      paidById: payout.paidById,
      paidAt: payout.paidAt,
      transactionRef: payout.transactionRef,
      confirmedById: payout.confirmedById,
      confirmedAt: payout.confirmedAt,
      note: payout.note,
      bankAccount: payout.bankAccount
        ? {
            bankName: payout.bankAccount.bankName,
            holderName: payout.bankAccount.holderName,
            accountNoMasked: `****${payout.bankAccount.accountNoLast4}`,
          }
        : null,
      proofs: payout.proofs.map((proof) => ({
        id: proof.id,
        fileObjectId: proof.fileObjectId,
        transactionRef: proof.transactionRef,
        note: proof.note,
        uploadedById: proof.uploadedById,
        createdAt: proof.createdAt,
      })),
      createdAt: payout.createdAt,
      updatedAt: payout.updatedAt,
    };
  }

  private async uniqueReference(tx?: Prisma.TransactionClient): Promise<string> {
    const client = tx ?? this.prisma;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = `PO${hex(6)}`;
      const exists = await client.payout.findUnique({
        where: { referenceCode: code },
        select: { id: true },
      });
      if (!exists) return code;
    }
    throw this.conflict('REFERENCE_GENERATION_FAILED', 'Không tạo được mã tham chiếu, thử lại.');
  }

  private async uniqueValue(field: 'payoutNo', make: () => string): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const value = make();
      const exists = await this.prisma.payout.findUnique({
        where: { [field]: value } as Prisma.PayoutWhereUniqueInput,
        select: { id: true },
      });
      if (!exists) return value;
    }
    throw this.conflict('REFERENCE_GENERATION_FAILED', 'Không tạo được mã lệnh chi, thử lại.');
  }

  private async notifySupplier(
    supplierId: string,
    event: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const supplier = await this.loadSupplier(supplierId);
    if (!supplier) return;
    for (const userId of supplier.userIds) {
      await this.notifications.emit(event, userId, data);
    }
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

  private emitRealtime(payout: PayoutWithRelations, event: string): void {
    if (payout.purposeType !== 'order' || !payout.purposeId) return;
    void this.prisma.dealRoom
      .findUnique({ where: { orderId: payout.purposeId }, select: { id: true } })
      .then((room) => {
        if (!room) return;
        this.realtime.toDealRoom(room.id, event, {
          orderId: payout.purposeId,
          payoutId: payout.id,
          status: payout.status,
        });
      })
      .catch(() => undefined);
  }

  private badRequest(code: string, message: string): BadRequestException {
    return new BadRequestException({ code, message });
  }

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }
}

// Bank holder names are compared case- and whitespace-insensitively; only the
// display name is stored on the bank account.
function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function hex(bytes: number): string {
  return randomBytes(bytes).toString('hex').toUpperCase();
}
