import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { LedgerAccountType, LedgerSide, LedgerTransactionType } from '@prisma/client';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

// P4.23 — double-entry ledger writer and finance read model.
//
// Entries are immutable at the DB level (triggers block UPDATE/DELETE) and
// `ledger_entries_balanced` verifies debit == credit once expectedEntries rows
// exist. The service validates the same invariants before writing so callers
// get a stable error code instead of a raw SQL signal.
export interface LedgerLine {
  accountCode: string;
  accountName: string;
  accountType: LedgerAccountType;
  side: LedgerSide;
  amount: Prisma.Decimal | string | number;
  note?: string;
}

export interface PostLedgerInput {
  type: LedgerTransactionType;
  refType: string;
  refId: string;
  currency: string;
  createdById: string;
  note?: string;
  // Caller-supplied key; unique when present. Required for retryable money
  // flows (P4.23 DoD: concurrent posts with the same key post once).
  idempotencyKey?: string;
  lines: LedgerLine[];
}

export interface PostLedgerResult {
  transactionId: string;
  alreadyPosted: boolean;
}

export interface LedgerAccountBalance {
  id: string;
  code: string;
  name: string;
  type: LedgerAccountType;
  currency: string;
  isActive: boolean;
  walletId: string | null;
  debitTotal: string;
  creditTotal: string;
  // Signed by the account's normal balance (debit-positive assets/expenses,
  // credit-positive liabilities/equity/revenue).
  balance: string;
}

export interface ListLedgerTransactionsQuery {
  page: number;
  limit: number;
  type?: LedgerTransactionType;
  refType?: string;
  refId?: string;
  from?: Date;
  to?: Date;
}

const CURRENCY_RE = /^[A-Z]{3}$/;

function invalidLines(message: string): never {
  throw new BadRequestException({ code: 'LEDGER_INVALID_LINES', message });
}

@Injectable()
export class LedgerService {
  constructor(private readonly prismaClient: PrismaService) {}

  // Post once per (refType, refId) or per idempotencyKey: a retry returns the
  // existing transaction instead of writing a second set of entries.
  async post(tx: Prisma.TransactionClient, input: PostLedgerInput): Promise<PostLedgerResult> {
    const currency = input.currency?.trim().toUpperCase() ?? '';
    if (!CURRENCY_RE.test(currency)) {
      throw new BadRequestException({
        code: 'LEDGER_INVALID_CURRENCY',
        message: 'Loại tiền sổ cái không hợp lệ.',
      });
    }
    if (!input.refType?.trim() || !input.refId?.trim()) {
      invalidLines('Bút toán phải có tham chiếu nghiệp vụ (refType/refId).');
    }

    const lines = this.normalizeLines(input.lines);
    this.assertBalanced(lines);
    const idempotencyKey = input.idempotencyKey?.trim() || undefined;

    if (idempotencyKey) {
      const existing = await tx.ledgerTransaction.findUnique({
        where: { idempotencyKey },
        select: { id: true },
      });
      if (existing) return { transactionId: existing.id, alreadyPosted: true };
    }

    const existingRef = await tx.ledgerTransaction.findFirst({
      where: { refType: input.refType, refId: input.refId },
      select: { id: true },
    });
    if (existingRef) return { transactionId: existingRef.id, alreadyPosted: true };

    let transaction: { id: string };
    try {
      transaction = await tx.ledgerTransaction.create({
        data: {
          expectedEntries: lines.length,
          type: input.type,
          status: 'POSTED',
          currency,
          postedAt: new Date(),
          refType: input.refType,
          refId: input.refId,
          idempotencyKey: idempotencyKey ?? null,
          note: input.note ?? null,
          createdById: input.createdById,
        },
        select: { id: true },
      });
    } catch (error) {
      // A concurrent retry with the same key may have won the unique index.
      // FOR UPDATE is a locking (current) read, so it sees the committed row
      // even inside this transaction's REPEATABLE READ snapshot.
      if (
        idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM ledger_transactions WHERE idempotencyKey = ${idempotencyKey} FOR UPDATE
        `;
        if (rows[0]) return { transactionId: rows[0].id, alreadyPosted: true };
      }
      throw error;
    }

    for (const line of lines) {
      const account = await tx.ledgerAccount.upsert({
        where: { code: line.accountCode },
        create: {
          code: line.accountCode,
          name: line.accountName,
          type: line.accountType,
          currency,
        },
        update: {},
        select: { id: true, type: true, currency: true, isActive: true },
      });
      if (account.currency !== currency) {
        throw new BadRequestException({
          code: 'LEDGER_ACCOUNT_CURRENCY_MISMATCH',
          message: `Tài khoản ${line.accountCode} dùng ${account.currency}, không khớp ${currency}.`,
        });
      }
      if (account.type !== line.accountType) {
        throw new BadRequestException({
          code: 'LEDGER_ACCOUNT_TYPE_MISMATCH',
          message: `Tài khoản ${line.accountCode} là ${account.type}, không phải ${line.accountType}.`,
        });
      }
      if (!account.isActive) {
        throw new BadRequestException({
          code: 'LEDGER_ACCOUNT_INACTIVE',
          message: `Tài khoản ${line.accountCode} đã ngừng sử dụng.`,
        });
      }
      await tx.ledgerEntry.create({
        data: {
          transactionId: transaction.id,
          accountId: account.id,
          side: line.side,
          amount: line.amount,
          refType: input.refType,
          refId: input.refId,
          note: line.note ?? input.note ?? null,
        },
      });
    }

    return { transactionId: transaction.id, alreadyPosted: false };
  }

  private normalizeLines(lines: LedgerLine[]): LedgerLine[] {
    if (!Array.isArray(lines) || lines.length < 2) {
      invalidLines('Bút toán kép cần ít nhất hai dòng.');
    }
    return lines.map((line) => {
      const code = line.accountCode?.trim();
      if (!code) invalidLines('Thiếu mã tài khoản sổ cái.');
      if (line.side !== 'DEBIT' && line.side !== 'CREDIT') {
        invalidLines('Chiều bút toán không hợp lệ.');
      }
      let amount: Prisma.Decimal;
      try {
        amount = new Prisma.Decimal(line.amount);
      } catch {
        invalidLines('Số tiền bút toán không hợp lệ.');
      }
      if (!amount.isFinite() || amount.lte(0)) {
        invalidLines('Số tiền bút toán phải lớn hơn 0.');
      }
      return { ...line, accountCode: code, amount };
    });
  }

  private assertBalanced(lines: LedgerLine[]): void {
    let debit = new Prisma.Decimal(0);
    let credit = new Prisma.Decimal(0);
    for (const line of lines) {
      if (line.side === 'DEBIT') debit = debit.plus(line.amount);
      else credit = credit.plus(line.amount);
    }
    if (!debit.equals(credit)) {
      throw new BadRequestException({
        code: 'LEDGER_UNBALANCED',
        message: `Tổng nợ ${debit.toFixed(2)} khác tổng có ${credit.toFixed(2)}.`,
      });
    }
  }

  // ---- finance read model (admin_finance/admin_super) ----

  async listAccounts(): Promise<LedgerAccountBalance[]> {
    const [accounts, sums] = await Promise.all([
      this.prismaClient.ledgerAccount.findMany({ orderBy: { code: 'asc' } }),
      this.prismaClient.ledgerEntry.groupBy({
        by: ['accountId', 'side'],
        _sum: { amount: true },
      }),
    ]);
    const totals = new Map<string, { debit: Prisma.Decimal; credit: Prisma.Decimal }>();
    for (const row of sums) {
      const entry = totals.get(row.accountId) ?? {
        debit: new Prisma.Decimal(0),
        credit: new Prisma.Decimal(0),
      };
      const amount = row._sum.amount ?? new Prisma.Decimal(0);
      if (row.side === 'DEBIT') entry.debit = entry.debit.plus(amount);
      else entry.credit = entry.credit.plus(amount);
      totals.set(row.accountId, entry);
    }
    return accounts.map((account) => {
      const total = totals.get(account.id) ?? {
        debit: new Prisma.Decimal(0),
        credit: new Prisma.Decimal(0),
      };
      const debitNormal = account.type === 'ASSET' || account.type === 'EXPENSE';
      const balance = debitNormal
        ? total.debit.minus(total.credit)
        : total.credit.minus(total.debit);
      return {
        id: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        currency: account.currency,
        isActive: account.isActive,
        walletId: account.walletId,
        debitTotal: total.debit.toFixed(2),
        creditTotal: total.credit.toFixed(2),
        balance: balance.toFixed(2),
      };
    });
  }

  async trialBalance(): Promise<{
    debitTotal: string;
    creditTotal: string;
    balanced: boolean;
  }> {
    const sums = await this.prismaClient.ledgerEntry.groupBy({
      by: ['side'],
      _sum: { amount: true },
    });
    let debit = new Prisma.Decimal(0);
    let credit = new Prisma.Decimal(0);
    for (const row of sums) {
      const amount = row._sum.amount ?? new Prisma.Decimal(0);
      if (row.side === 'DEBIT') debit = debit.plus(amount);
      else credit = credit.plus(amount);
    }
    return {
      debitTotal: debit.toFixed(2),
      creditTotal: credit.toFixed(2),
      balanced: debit.equals(credit),
    };
  }

  async listTransactions(query: ListLedgerTransactionsQuery) {
    const where: Prisma.LedgerTransactionWhereInput = {};
    if (query.type) where.type = query.type;
    if (query.refType) where.refType = query.refType;
    if (query.refId) where.refId = query.refId;
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      };
    }

    const prisma = this.prismaClient;
    const [total, items] = await Promise.all([
      prisma.ledgerTransaction.count({ where }),
      prisma.ledgerTransaction.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          type: true,
          status: true,
          currency: true,
          expectedEntries: true,
          refType: true,
          refId: true,
          idempotencyKey: true,
          note: true,
          postedAt: true,
          createdAt: true,
          createdById: true,
          entries: {
            select: {
              id: true,
              side: true,
              amount: true,
              note: true,
              account: { select: { code: true, name: true, type: true } },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  async getTransaction(id: string) {
    const transaction = await this.prismaClient.ledgerTransaction.findUnique({
      where: { id },
      select: {
        id: true,
        type: true,
        status: true,
        currency: true,
        expectedEntries: true,
        refType: true,
        refId: true,
        idempotencyKey: true,
        note: true,
        postedAt: true,
        createdAt: true,
        createdById: true,
        entries: {
          select: {
            id: true,
            side: true,
            amount: true,
            refType: true,
            refId: true,
            note: true,
            createdAt: true,
            account: { select: { id: true, code: true, name: true, type: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!transaction) throw new NotFoundException('Bút toán sổ cái không tồn tại.');
    return transaction;
  }
}
