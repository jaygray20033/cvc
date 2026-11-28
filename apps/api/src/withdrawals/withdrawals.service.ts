import { randomBytes } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type WithdrawalStatus } from '@prisma/client';

import type { AccessPayload } from '../common/decorators/current-user.decorator';
import { ConservationService } from '../common/ledger/conservation.service';
import { S3Service } from '../common/storage/s3.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { SystemSettingsService } from '../settings/system-settings.service';
import { WalletService } from '../wallet/wallet.service';
import type {
  ApproveWithdrawalInput,
  CancelWithdrawalInput,
  CreateWithdrawalInput,
  ListWithdrawalsInput,
  MarkWithdrawalPaidInput,
  RejectWithdrawalInput,
} from './withdrawals.dto';

// P4.26 — user withdrawals.
//
// requested (PENDING) → approved (APPROVED) → paid (COMPLETED)
//                      ↘ rejected (REJECTED) / cancelled (CANCELLED)
//
// Money is reserved in wallet.heldBalance on request. Reject/cancel release
// the reservation (the request never touched the ledger, so there is nothing
// to reverse there); mark-paid captures the held amount and posts exactly one
// Dr wallet liability / Cr CVC bank entry. The actual bank transfer happens
// manually outside the platform, so COMPLETED always carries proof + a unique
// transaction reference (also enforced by a DB CHECK).
const COMMITTED_STATUSES: WithdrawalStatus[] = ['PENDING', 'APPROVED', 'PROCESSING', 'COMPLETED'];

const WITHDRAWAL_INCLUDE = {
  wallet: { select: { userId: true, currency: true } },
  bankAccount: { select: { bankName: true, holderName: true, accountNoLast4: true } },
  proofFileObject: {
    select: { id: true, bucket: true, s3Key: true, status: true, scanStatus: true },
  },
} satisfies Prisma.WithdrawalInclude;

type WithdrawalRow = Prisma.WithdrawalGetPayload<{ include: typeof WITHDRAWAL_INCLUDE }>;

@Injectable()
export class WithdrawalsService {
  private readonly logger = new Logger(WithdrawalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SystemSettingsService,
    private readonly notifications: NotificationsService,
    private readonly wallet: WalletService,
    private readonly conservation: ConservationService,
    private readonly s3: S3Service,
  ) {}

  // POST /me/withdrawals — KYC FULL + own verified bank account, then hold.
  async request(actor: AccessPayload, input: CreateWithdrawalInput) {
    await this.conservation.assertWithdrawalsAllowed();
    const bankAccount = await this.bankAccountFor(actor.sub, input.bankAccountId);
    const amount = this.money(input.amount);

    const minAmount = await this.settingNumber('withdrawals.minAmount');
    if (amount.lt(minAmount)) {
      throw this.conflict(
        'WITHDRAWAL_BELOW_MINIMUM',
        `Số tiền rút tối thiểu là ${minAmount} ${bankAccount.currency}.`,
      );
    }
    const dailyLimit = await this.settingNumber('withdrawals.dailyLimit');

    const withdrawalNo = await this.uniqueValue('withdrawalNo', () => `CVC-WD-${hex(6)}`);
    const referenceCode = await this.uniqueValue('referenceCode', () => `WD${hex(6)}`);

    const created = await this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.upsert({
        where: { userId: actor.sub },
        create: { userId: actor.sub },
        update: {},
        select: { id: true, currency: true },
      });
      if (wallet.currency !== bankAccount.currency) {
        throw this.conflict(
          'WALLET_CURRENCY_MISMATCH',
          `Ví dùng ${wallet.currency}, không khớp ${bankAccount.currency}.`,
        );
      }

      const committed = await tx.withdrawal.aggregate({
        where: {
          walletId: wallet.id,
          status: { in: COMMITTED_STATUSES },
          createdAt: { gte: this.startOfDayUtc() },
        },
        _sum: { amount: true },
      });
      const used = committed._sum.amount ?? new Prisma.Decimal(0);
      if (used.plus(amount).gt(dailyLimit)) {
        throw this.conflict(
          'WITHDRAWAL_DAILY_LIMIT',
          `Hạn mức rút trong ngày là ${dailyLimit} ${wallet.currency} (đã dùng ${used}).`,
        );
      }

      // Reserve available funds; throws INSUFFICIENT_FUNDS when the wallet
      // cannot cover the request.
      await this.wallet.hold(tx, {
        userId: actor.sub,
        amount,
        currency: wallet.currency,
        createdById: actor.sub,
        refType: 'withdrawal',
        refId: withdrawalNo,
      });

      return tx.withdrawal.create({
        data: {
          withdrawalNo,
          referenceCode,
          walletId: wallet.id,
          amount,
          currency: wallet.currency,
          bankAccountId: bankAccount.id,
          status: 'PENDING',
          note: input.note ?? null,
        },
        include: WITHDRAWAL_INCLUDE,
      });
    });

    await this.notifyAdmins('withdrawal.requested', {
      withdrawalNo,
      referenceCode,
      amount: amount.toString(),
      currency: created.currency,
      userId: actor.sub,
    });
    this.logger.log(
      { withdrawalId: created.id, amount: amount.toString() },
      'withdrawal requested',
    );
    return this.view(created);
  }

  async listForUser(userId: string, query: ListWithdrawalsInput) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!wallet) return { items: [], total: 0, page: query.page, limit: query.limit };

    const where: Prisma.WithdrawalWhereInput = {
      walletId: wallet.id,
      ...(query.status ? { status: query.status as WithdrawalStatus } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.withdrawal.count({ where }),
      this.prisma.withdrawal.findMany({
        where,
        include: WITHDRAWAL_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    return {
      items: rows.map((row) => this.view(row)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async detailForUser(userId: string, withdrawalId: string) {
    const withdrawal = await this.load(withdrawalId);
    if (withdrawal.wallet.userId !== userId) throw this.notFound();
    return this.view(withdrawal);
  }

  // GET /me/withdrawals/:id/proof — the payer is an admin, so the normal
  // owner-only /files download route cannot serve the user. Presign here after
  // checking the withdrawal belongs to the caller and is fully paid.
  async proofUrl(userId: string, withdrawalId: string) {
    const withdrawal = await this.load(withdrawalId);
    if (withdrawal.wallet.userId !== userId) throw this.notFound();
    const file = withdrawal.proofFileObject;
    if (withdrawal.status !== 'COMPLETED' || !file) {
      throw this.conflict(
        'WITHDRAWAL_PROOF_NOT_AVAILABLE',
        'Chưa có ảnh minh chứng chi cho yêu cầu này.',
      );
    }
    if (
      file.status !== 'READY' ||
      file.scanStatus === 'PENDING' ||
      file.scanStatus === 'NOT_SCANNED' ||
      file.scanStatus === 'INFECTED'
    ) {
      throw this.conflict(
        'WITHDRAWAL_PROOF_NOT_AVAILABLE',
        'Ảnh minh chứng chưa sẵn sàng hoặc không an toàn.',
      );
    }
    const url = await this.s3.presignGet(file.bucket, file.s3Key);
    return { url, expiresIn: 300 };
  }

  // POST /me/withdrawals/:id/cancel — the user may cancel before the transfer.
  async cancel(actor: AccessPayload, withdrawalId: string, input: CancelWithdrawalInput) {
    const withdrawal = await this.load(withdrawalId);
    if (withdrawal.wallet.userId !== actor.sub) throw this.notFound();
    if (!['PENDING', 'APPROVED'].includes(withdrawal.status)) {
      throw this.invalidState('Yêu cầu này không thể hủy ở trạng thái hiện tại.');
    }
    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.withdrawal.updateMany({
        where: { id: withdrawal.id, status: { in: ['PENDING', 'APPROVED'] } },
        data: {
          status: 'CANCELLED',
          cancelledById: actor.sub,
          cancelledAt: now,
          cancelReason: input.reason ?? null,
          processedAt: now,
        },
      });
      if (changed.count === 0) {
        throw this.invalidState('Yêu cầu vừa được xử lý bởi người khác.');
      }
      await this.wallet.release(tx, {
        userId: withdrawal.wallet.userId,
        amount: withdrawal.amount,
        currency: withdrawal.currency,
        createdById: actor.sub,
        refType: 'withdrawal',
        refId: withdrawal.id,
      });
      return tx.withdrawal.findUniqueOrThrow({
        where: { id: withdrawal.id },
        include: WITHDRAWAL_INCLUDE,
      });
    });

    await this.notifyAdmins('withdrawal.cancelled', {
      withdrawalNo: updated.withdrawalNo,
      amount: updated.amount.toString(),
      currency: updated.currency,
      reason: input.reason ?? null,
    });
    this.logger.log({ withdrawalId, status: updated.status }, 'withdrawal cancelled');
    return this.view(updated);
  }

  async listForAdmin(query: ListWithdrawalsInput) {
    const where: Prisma.WithdrawalWhereInput = query.status
      ? { status: query.status as WithdrawalStatus }
      : {};
    const [total, rows] = await Promise.all([
      this.prisma.withdrawal.count({ where }),
      this.prisma.withdrawal.findMany({
        where,
        include: WITHDRAWAL_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    return {
      items: rows.map((row) => this.view(row)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async detailForAdmin(withdrawalId: string) {
    return this.view(await this.load(withdrawalId));
  }

  // POST /admin/withdrawals/:id/approve — one or two layers by amount.
  async approve(actor: AccessPayload, withdrawalId: string, input: ApproveWithdrawalInput) {
    const withdrawal = await this.load(withdrawalId);
    if (withdrawal.status !== 'PENDING') {
      throw this.invalidState('Yêu cầu rút tiền không còn ở trạng thái chờ duyệt.');
    }

    const threshold = await this.settingNumber('withdrawals.dualApprovalThreshold');
    const needsDual = withdrawal.requiresSecondApproval || withdrawal.amount.gte(threshold);
    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      if (withdrawal.approvalCount === 0) {
        const changed = await tx.withdrawal.updateMany({
          where: { id: withdrawal.id, status: 'PENDING', approvalCount: 0 },
          data: {
            approvalCount: 1,
            requiresSecondApproval: needsDual,
            firstApprovedById: actor.sub,
            firstApprovedAt: now,
            ...(needsDual ? {} : { status: 'APPROVED', approvedById: actor.sub, approvedAt: now }),
            note: input.note ?? withdrawal.note,
          },
        });
        if (changed.count === 0) {
          throw this.invalidState('Yêu cầu vừa được xử lý bởi người khác.');
        }
      } else if (withdrawal.requiresSecondApproval && withdrawal.approvalCount === 1) {
        if (withdrawal.firstApprovedById === actor.sub) {
          throw this.conflict(
            'WITHDRAWAL_SECOND_APPROVER_REQUIRED',
            'Người duyệt lớp 2 phải khác người duyệt lớp 1.',
          );
        }
        const changed = await tx.withdrawal.updateMany({
          where: {
            id: withdrawal.id,
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
            note: input.note ?? withdrawal.note,
          },
        });
        if (changed.count === 0) {
          throw this.invalidState('Yêu cầu vừa được xử lý bởi người khác.');
        }
      } else {
        throw this.invalidState('Yêu cầu đã được duyệt đủ lớp.');
      }
      return tx.withdrawal.findUniqueOrThrow({
        where: { id: withdrawal.id },
        include: WITHDRAWAL_INCLUDE,
      });
    });

    if (updated.status === 'APPROVED') {
      await this.notifyUser(updated.wallet.userId, 'withdrawal.approved', {
        withdrawalNo: updated.withdrawalNo,
        amount: updated.amount.toString(),
        currency: updated.currency,
      });
    } else {
      await this.notifyAdmins(
        'withdrawal.approval_pending',
        {
          withdrawalNo: updated.withdrawalNo,
          amount: updated.amount.toString(),
          currency: updated.currency,
          approvalCount: updated.approvalCount,
        },
        actor.sub,
      );
    }
    this.logger.log(
      { withdrawalId, status: updated.status, approvals: updated.approvalCount },
      'withdrawal approved',
    );
    return this.view(updated);
  }

  // POST /admin/withdrawals/:id/reject — releases the hold.
  async reject(actor: AccessPayload, withdrawalId: string, input: RejectWithdrawalInput) {
    const withdrawal = await this.load(withdrawalId);
    if (!['PENDING', 'APPROVED'].includes(withdrawal.status)) {
      throw this.invalidState('Yêu cầu này không thể từ chối.');
    }
    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.withdrawal.updateMany({
        where: { id: withdrawal.id, status: { in: ['PENDING', 'APPROVED'] } },
        data: {
          status: 'REJECTED',
          rejectedById: actor.sub,
          rejectedAt: now,
          rejectionReason: input.reason,
          processedAt: now,
        },
      });
      if (changed.count === 0) {
        throw this.invalidState('Yêu cầu vừa được xử lý bởi người khác.');
      }
      await this.wallet.release(tx, {
        userId: withdrawal.wallet.userId,
        amount: withdrawal.amount,
        currency: withdrawal.currency,
        createdById: actor.sub,
        refType: 'withdrawal',
        refId: withdrawal.id,
      });
      return tx.withdrawal.findUniqueOrThrow({
        where: { id: withdrawal.id },
        include: WITHDRAWAL_INCLUDE,
      });
    });

    await this.notifyUser(updated.wallet.userId, 'withdrawal.rejected', {
      withdrawalNo: updated.withdrawalNo,
      amount: updated.amount.toString(),
      currency: updated.currency,
      reason: input.reason,
    });
    this.logger.log({ withdrawalId, status: updated.status }, 'withdrawal rejected');
    return this.view(updated);
  }

  // POST /admin/withdrawals/:id/mark-paid — the bank transfer happened outside
  // the system. Proof + reference are written once and the ledger posts once.
  async markPaid(actor: AccessPayload, withdrawalId: string, input: MarkWithdrawalPaidInput) {
    const withdrawal = await this.load(withdrawalId);

    // Idempotent replay: same reference returns the stored result, a different
    // reference is a conflict (the withdrawal is already paid).
    if (withdrawal.status === 'COMPLETED') {
      if (withdrawal.transactionRef !== input.transactionRef) {
        throw this.conflict(
          'WITHDRAWAL_ALREADY_PAID',
          'Yêu cầu này đã được chi với mã giao dịch khác.',
        );
      }
      const ledger = await this.prisma.ledgerTransaction.findFirst({
        where: { refType: 'withdrawal', refId: withdrawal.id },
        select: { id: true },
      });
      return {
        ...this.view(withdrawal),
        ledgerTransactionId: ledger?.id ?? null,
        alreadyPaid: true,
      };
    }
    if (withdrawal.status !== 'APPROVED') {
      throw this.invalidState('Chỉ đánh dấu đã chuyển cho yêu cầu đã duyệt.');
    }

    await this.conservation.assertWithdrawalsAllowed();
    const file = await this.validateProofFile(actor, input.fileObjectId);
    await this.assertProofUnused(withdrawal.id, input.transactionRef, file.sha256 as string);

    const paidAt = input.paidAt ?? new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.withdrawal.updateMany({
        where: { id: withdrawal.id, status: 'APPROVED' },
        data: {
          status: 'COMPLETED',
          paidById: actor.sub,
          paidAt,
          transactionRef: input.transactionRef,
          proofFileObjectId: file.id,
          proofSha256: file.sha256 as string,
          processedAt: paidAt,
          note: input.note ?? withdrawal.note,
        },
      });
      if (changed.count === 0) {
        throw this.invalidState('Yêu cầu vừa được xử lý bởi người khác.');
      }

      // Exactly one Dr wallet liability / Cr CVC bank entry; the hold is
      // consumed so both balance and heldBalance drop by the amount.
      const posted = await this.wallet.captureHeld(tx, {
        userId: withdrawal.wallet.userId,
        amount: withdrawal.amount,
        currency: withdrawal.currency,
        createdById: actor.sub,
        refType: 'withdrawal',
        refId: withdrawal.id,
        idempotencyKey: `withdrawal-paid:${withdrawal.id}`,
        note: `Rút tiền ${withdrawal.withdrawalNo}`,
      });
      if (posted.alreadyPosted) {
        throw this.conflict('WITHDRAWAL_ALREADY_POSTED', 'Yêu cầu này đã được ghi sổ cái.');
      }
      return { ledgerTransactionId: posted.transactionId };
    });

    // P4.25: verify money conservation after the transfer commits.
    await this.conservation.runAfter('withdrawal.mark-paid');

    const updated = await this.load(withdrawal.id);
    await this.notifyUser(updated.wallet.userId, 'withdrawal.paid', {
      withdrawalNo: updated.withdrawalNo,
      amount: updated.amount.toString(),
      currency: updated.currency,
      transactionRef: input.transactionRef,
    });
    this.logger.log(
      { withdrawalId, transactionRef: input.transactionRef, ledger: result.ledgerTransactionId },
      'withdrawal marked paid',
    );
    return {
      ...this.view(updated),
      ledgerTransactionId: result.ledgerTransactionId,
      alreadyPaid: false,
    };
  }

  private async load(withdrawalId: string): Promise<WithdrawalRow> {
    const withdrawal = await this.prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
      include: WITHDRAWAL_INCLUDE,
    });
    if (!withdrawal) throw this.notFound();
    return withdrawal;
  }

  private async bankAccountFor(userId: string, bankAccountId: string) {
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
    if (!account) {
      throw this.conflict(
        'WITHDRAWAL_BANK_ACCOUNT_REQUIRED',
        'Cần chọn tài khoản ngân hàng đã xác minh để nhận tiền.',
      );
    }
    if (account.userId !== userId) {
      throw new ForbiddenException({
        code: 'WITHDRAWAL_BANK_ACCOUNT_NOT_OWNED',
        message: 'Tài khoản nhận tiền không thuộc hồ sơ của bạn.',
      });
    }
    return { ...account, currency: 'VND' };
  }

  private async validateProofFile(actor: AccessPayload, fileObjectId: string) {
    const file = await this.prisma.fileObject.findUnique({
      where: { id: fileObjectId },
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
    return file;
  }

  private async assertProofUnused(
    withdrawalId: string,
    transactionRef: string,
    sha256: string,
  ): Promise<void> {
    const [usedImage, usedRef, payoutRef, payoutProofRef, payoutImage] = await Promise.all([
      this.prisma.withdrawal.findFirst({
        where: { proofSha256: sha256, id: { not: withdrawalId } },
        select: { id: true },
      }),
      this.prisma.withdrawal.findFirst({
        where: { transactionRef, id: { not: withdrawalId } },
        select: { id: true },
      }),
      this.prisma.payout.findFirst({ where: { transactionRef }, select: { id: true } }),
      this.prisma.payoutProof.findFirst({ where: { transactionRef }, select: { id: true } }),
      this.prisma.payoutProof.findFirst({ where: { sha256 }, select: { id: true } }),
    ]);
    if (usedImage || payoutImage) {
      throw this.conflict(
        'DUPLICATE_PROOF_IMAGE',
        'Ảnh minh chứng chi này đã được dùng cho giao dịch khác.',
      );
    }
    if (usedRef || payoutRef || payoutProofRef) {
      throw this.conflict(
        'DUPLICATE_TRANSACTION_REF',
        'Mã giao dịch đã được dùng cho giao dịch khác.',
      );
    }
  }

  private view(withdrawal: WithdrawalRow) {
    return {
      id: withdrawal.id,
      withdrawalNo: withdrawal.withdrawalNo,
      userId: withdrawal.wallet.userId,
      status: withdrawal.status,
      amount: withdrawal.amount,
      currency: withdrawal.currency,
      referenceCode: withdrawal.referenceCode,
      bankAccount: withdrawal.bankAccount
        ? {
            bankName: withdrawal.bankAccount.bankName,
            holderName: withdrawal.bankAccount.holderName,
            accountNoMasked: `****${withdrawal.bankAccount.accountNoLast4}`,
          }
        : null,
      requiresSecondApproval: withdrawal.requiresSecondApproval,
      approvalCount: withdrawal.approvalCount,
      firstApprovedById: withdrawal.firstApprovedById,
      firstApprovedAt: withdrawal.firstApprovedAt,
      secondApprovedById: withdrawal.secondApprovedById,
      secondApprovedAt: withdrawal.secondApprovedAt,
      approvedById: withdrawal.approvedById,
      approvedAt: withdrawal.approvedAt,
      rejectedById: withdrawal.rejectedById,
      rejectedAt: withdrawal.rejectedAt,
      rejectionReason: withdrawal.rejectionReason,
      cancelledById: withdrawal.cancelledById,
      cancelledAt: withdrawal.cancelledAt,
      cancelReason: withdrawal.cancelReason,
      paidById: withdrawal.paidById,
      paidAt: withdrawal.paidAt,
      transactionRef: withdrawal.transactionRef,
      proof: withdrawal.proofFileObjectId
        ? {
            fileObjectId: withdrawal.proofFileObjectId,
            available: withdrawal.status === 'COMPLETED',
          }
        : null,
      note: withdrawal.note,
      createdAt: withdrawal.createdAt,
      updatedAt: withdrawal.updatedAt,
    };
  }

  private async uniqueValue(
    field: 'withdrawalNo' | 'referenceCode',
    make: () => string,
  ): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const value = make();
      const exists = await this.prisma.withdrawal.findUnique({
        where: field === 'withdrawalNo' ? { withdrawalNo: value } : { referenceCode: value },
        select: { id: true },
      });
      if (!exists) return value;
    }
    throw this.conflict('REFERENCE_GENERATION_FAILED', 'Không tạo được mã yêu cầu, thử lại.');
  }

  private async notifyUser(
    userId: string,
    event: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.notifications.emit(event, userId, data);
  }

  private async notifyAdmins(
    event: string,
    data: Record<string, unknown>,
    excludeUserId?: string,
  ): Promise<void> {
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
    if (excludeUserId) ids.delete(excludeUserId);
    for (const userId of ids) await this.notifications.emit(event, userId, data);
  }

  private async settingNumber(key: string): Promise<number> {
    const value = await this.settings.get<number>(key);
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  private startOfDayUtc(): Date {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    return start;
  }

  private money(value: number): Prisma.Decimal {
    let amount: Prisma.Decimal;
    try {
      amount = new Prisma.Decimal(value);
    } catch {
      throw this.badRequest('WITHDRAWAL_INVALID_AMOUNT', 'Số tiền rút không hợp lệ.');
    }
    if (!amount.isFinite() || amount.lte(0)) {
      throw this.badRequest('WITHDRAWAL_INVALID_AMOUNT', 'Số tiền rút phải lớn hơn 0.');
    }
    return amount;
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'WITHDRAWAL_NOT_FOUND',
      message: 'Không tìm thấy yêu cầu rút tiền.',
    });
  }

  private invalidState(message: string): ConflictException {
    return this.conflict('WITHDRAWAL_INVALID_STATE', message);
  }

  private badRequest(code: string, message: string): BadRequestException {
    return new BadRequestException({ code, message });
  }

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }
}

function hex(bytes: number): string {
  return randomBytes(bytes).toString('hex').toUpperCase();
}
