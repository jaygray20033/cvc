import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { LedgerService } from '../common/ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { buildStatementCsv, buildStatementPdf, type StatementRow } from './wallet-statement';

// P4.24 — user wallet. `wallet.balance` is a cache of the ledger liability
// account `CUS-{userId}`; every read reconciles it, and debits are guarded by
// a conditional UPDATE so two concurrent spends cannot drive it negative.
export const WALLET_ACCOUNT_PREFIX = 'CUS-';
export const BANK_ACCOUNT_CODE = 'CVC-BANK';

const DEFAULT_CURRENCY = 'VND';
const MAX_STATEMENT_ROWS = 1000;

export interface WalletMutationInput {
  userId: string;
  amount: Prisma.Decimal | string | number;
  createdById: string;
  refType: string;
  refId: string;
  note?: string;
  currency?: string;
  idempotencyKey?: string;
}

export interface WalletSummary {
  userId: string;
  currency: string;
  status: string;
  balance: string;
  held: string;
  available: string;
  ledgerBalance: string;
  reconciled: boolean;
}

export interface ListWalletTransactionsQuery {
  page: number;
  limit: number;
  from?: Date;
  to?: Date;
}

export interface WalletStatementQuery {
  format: 'csv' | 'pdf';
  from?: Date;
  to?: Date;
}

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  accountCode(userId: string): string {
    return `${WALLET_ACCOUNT_PREFIX}${userId}`;
  }

  async getWallet(userId: string): Promise<WalletSummary> {
    const wallet = await this.ensureWallet(this.prisma, userId);
    const ledgerBalance = await this.ledgerBalance(this.prisma, userId);
    let cached = wallet;
    if (!wallet.balance.equals(ledgerBalance)) {
      cached = await this.prisma.wallet.update({
        where: { userId },
        data: { balance: ledgerBalance },
      });
    }
    return this.summary(cached, ledgerBalance);
  }

  async listTransactions(userId: string, query: ListWalletTransactionsQuery) {
    const account = await this.findAccount(this.prisma, userId);
    if (!account) return { items: [], total: 0, page: query.page, limit: query.limit };

    const where: Prisma.LedgerEntryWhereInput = { accountId: account.id };
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      };
    }
    const [total, rows] = await Promise.all([
      this.prisma.ledgerEntry.count({ where }),
      this.prisma.ledgerEntry.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          side: true,
          amount: true,
          note: true,
          createdAt: true,
          transaction: {
            select: {
              id: true,
              type: true,
              status: true,
              refType: true,
              refId: true,
              note: true,
              postedAt: true,
            },
          },
        },
      }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        side: row.side,
        direction: row.side === 'CREDIT' ? 'IN' : 'OUT',
        amount: row.amount.toFixed(2),
        note: row.note,
        transaction: row.transaction,
      })),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async getStatement(userId: string, query: WalletStatementQuery) {
    const account = await this.findAccount(this.prisma, userId);
    const wallet = await this.ensureWallet(this.prisma, userId);
    const rows: StatementRow[] = [];
    if (account) {
      const where: Prisma.LedgerEntryWhereInput = { accountId: account.id };
      if (query.from || query.to) {
        where.createdAt = {
          ...(query.from ? { gte: query.from } : {}),
          ...(query.to ? { lte: query.to } : {}),
        };
      }
      const entries = await this.prisma.ledgerEntry.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: MAX_STATEMENT_ROWS,
        select: {
          side: true,
          amount: true,
          note: true,
          createdAt: true,
          transaction: { select: { id: true, type: true, refType: true, refId: true } },
        },
      });
      for (const entry of entries) {
        rows.push({
          time: entry.createdAt,
          transactionId: entry.transaction.id,
          type: entry.transaction.type,
          reference: [entry.transaction.refType, entry.transaction.refId]
            .filter(Boolean)
            .join(': '),
          note: entry.note ?? entry.transaction.refId ?? '',
          amount: entry.amount.toFixed(2),
          direction: entry.side === 'CREDIT' ? 'IN' : 'OUT',
        });
      }
    }

    const from = query.from ? query.from.toISOString().slice(0, 10) : 'all';
    const to = query.to ? query.to.toISOString().slice(0, 10) : 'all';
    if (query.format === 'pdf') {
      const body = buildStatementPdf({
        wallet: this.summary(wallet, wallet.balance),
        from,
        to,
        rows,
      });
      return {
        filename: `cvc-wallet-${userId}-${from}-${to}.pdf`,
        contentType: 'application/pdf',
        body,
      };
    }
    return {
      filename: `cvc-wallet-${userId}-${from}-${to}.csv`,
      contentType: 'text/csv; charset=utf-8',
      body: buildStatementCsv({ from, to, rows }),
    };
  }

  // Money in: Dr bank / Cr wallet liability. Posting the ledger first means a
  // duplicate idempotency key never increments the cached balance twice.
  async credit(tx: Prisma.TransactionClient, input: WalletMutationInput) {
    const amount = this.amount(input.amount);
    const currency = this.currency(input.currency);
    const wallet = await this.ensureWallet(tx, input.userId, currency);
    if (wallet.status !== 'ACTIVE') throw this.frozen();

    const posted = await this.ledger.post(tx, {
      type: 'DEPOSIT',
      refType: input.refType,
      refId: input.refId,
      currency,
      createdById: input.createdById,
      note: input.note,
      idempotencyKey: input.idempotencyKey,
      lines: [
        {
          accountCode: BANK_ACCOUNT_CODE,
          accountName: 'Tiền gửi ngân hàng CVC',
          accountType: 'ASSET',
          side: 'DEBIT',
          amount,
        },
        {
          accountCode: this.accountCode(input.userId),
          accountName: 'Ví người dùng',
          accountType: 'LIABILITY',
          side: 'CREDIT',
          amount,
        },
      ],
    });
    if (!posted.alreadyPosted) {
      await tx.wallet.update({
        where: { userId: input.userId },
        data: { balance: { increment: amount } },
      });
    }
    return posted;
  }

  // Money out: guarded conditional UPDATE (row lock) then Dr wallet / Cr bank.
  async debit(tx: Prisma.TransactionClient, input: WalletMutationInput) {
    const amount = this.amount(input.amount);
    const currency = this.currency(input.currency);
    const wallet = await this.ensureWallet(tx, input.userId, currency);
    if (wallet.status !== 'ACTIVE') throw this.frozen();

    const posted = await this.ledger.post(tx, {
      type: 'PAYMENT',
      refType: input.refType,
      refId: input.refId,
      currency,
      createdById: input.createdById,
      note: input.note,
      idempotencyKey: input.idempotencyKey,
      lines: [
        {
          accountCode: this.accountCode(input.userId),
          accountName: 'Ví người dùng',
          accountType: 'LIABILITY',
          side: 'DEBIT',
          amount,
        },
        {
          accountCode: BANK_ACCOUNT_CODE,
          accountName: 'Tiền gửi ngân hàng CVC',
          accountType: 'ASSET',
          side: 'CREDIT',
          amount,
        },
      ],
    });
    if (posted.alreadyPosted) return posted;

    const changed = await tx.$executeRaw`
      UPDATE wallets
      SET balance = balance - ${amount}
      WHERE id = ${wallet.id}
        AND status = 'ACTIVE'
        AND balance - heldBalance >= ${amount}
    `;
    if (changed === 0) throw this.insufficient();
    return posted;
  }

  // Reserve available funds for a pending withdrawal (no ledger entry yet).
  async hold(tx: Prisma.TransactionClient, input: WalletMutationInput) {
    const amount = this.amount(input.amount);
    const wallet = await this.ensureWallet(tx, input.userId, this.currency(input.currency));
    if (wallet.status !== 'ACTIVE') throw this.frozen();
    const changed = await tx.$executeRaw`
      UPDATE wallets
      SET heldBalance = heldBalance + ${amount}
      WHERE id = ${wallet.id}
        AND status = 'ACTIVE'
        AND balance - heldBalance >= ${amount}
    `;
    if (changed === 0) throw this.insufficient();
  }

  async release(tx: Prisma.TransactionClient, input: WalletMutationInput) {
    const amount = this.amount(input.amount);
    const wallet = await this.ensureWallet(tx, input.userId, this.currency(input.currency));
    const changed = await tx.$executeRaw`
      UPDATE wallets
      SET heldBalance = heldBalance - ${amount}
      WHERE id = ${wallet.id}
        AND heldBalance >= ${amount}
    `;
    if (changed === 0) throw this.insufficient('Số tiền tạm giữ không đủ để hoàn.');
  }

  // Pay a held amount out: Dr wallet liability / Cr bank, reducing both totals.
  async captureHeld(tx: Prisma.TransactionClient, input: WalletMutationInput) {
    const amount = this.amount(input.amount);
    const currency = this.currency(input.currency);
    const wallet = await this.ensureWallet(tx, input.userId, currency);
    if (wallet.status !== 'ACTIVE') throw this.frozen();

    const posted = await this.ledger.post(tx, {
      type: 'PAYOUT',
      refType: input.refType,
      refId: input.refId,
      currency,
      createdById: input.createdById,
      note: input.note,
      idempotencyKey: input.idempotencyKey,
      lines: [
        {
          accountCode: this.accountCode(input.userId),
          accountName: 'Ví người dùng',
          accountType: 'LIABILITY',
          side: 'DEBIT',
          amount,
        },
        {
          accountCode: BANK_ACCOUNT_CODE,
          accountName: 'Tiền gửi ngân hàng CVC',
          accountType: 'ASSET',
          side: 'CREDIT',
          amount,
        },
      ],
    });
    if (posted.alreadyPosted) return posted;

    const changed = await tx.$executeRaw`
      UPDATE wallets
      SET balance = balance - ${amount}, heldBalance = heldBalance - ${amount}
      WHERE id = ${wallet.id}
        AND heldBalance >= ${amount}
    `;
    if (changed === 0) throw this.insufficient('Số tiền tạm giữ không đủ để chi.');
    return posted;
  }

  private async ensureWallet(
    client: Prisma.TransactionClient,
    userId: string,
    currency = DEFAULT_CURRENCY,
  ) {
    const wallet = await client.wallet.upsert({
      where: { userId },
      create: { userId, currency },
      update: {},
    });
    if (wallet.currency !== currency) {
      throw new BadRequestException({
        code: 'WALLET_CURRENCY_MISMATCH',
        message: `Ví dùng ${wallet.currency}, không khớp ${currency}.`,
      });
    }
    return wallet;
  }

  private async findAccount(client: Prisma.TransactionClient, userId: string) {
    return client.ledgerAccount.findUnique({
      where: { code: this.accountCode(userId) },
      select: { id: true, currency: true },
    });
  }

  private async ledgerBalance(
    client: Prisma.TransactionClient,
    userId: string,
  ): Promise<Prisma.Decimal> {
    const account = await this.findAccount(client, userId);
    if (!account) return new Prisma.Decimal(0);
    const sums = await client.ledgerEntry.groupBy({
      by: ['side'],
      where: { accountId: account.id },
      _sum: { amount: true },
    });
    let debit = new Prisma.Decimal(0);
    let credit = new Prisma.Decimal(0);
    for (const row of sums) {
      const amount = row._sum.amount ?? new Prisma.Decimal(0);
      if (row.side === 'DEBIT') debit = debit.plus(amount);
      else credit = credit.plus(amount);
    }
    // Wallet liability is credit-normal.
    return credit.minus(debit);
  }

  private summary(
    wallet: {
      userId: string;
      currency: string;
      status: string;
      balance: Prisma.Decimal;
      heldBalance: Prisma.Decimal;
    },
    ledgerBalance: Prisma.Decimal,
  ): WalletSummary {
    const available = wallet.balance.minus(wallet.heldBalance);
    return {
      userId: wallet.userId,
      currency: wallet.currency,
      status: wallet.status,
      balance: wallet.balance.toFixed(2),
      held: wallet.heldBalance.toFixed(2),
      available: (available.lt(0) ? new Prisma.Decimal(0) : available).toFixed(2),
      ledgerBalance: ledgerBalance.toFixed(2),
      reconciled: wallet.balance.equals(ledgerBalance),
    };
  }

  private amount(value: Prisma.Decimal | string | number): Prisma.Decimal {
    let amount: Prisma.Decimal;
    try {
      amount = new Prisma.Decimal(value);
    } catch {
      throw this.invalidAmount();
    }
    if (!amount.isFinite() || amount.lte(0)) throw this.invalidAmount();
    return amount;
  }

  private currency(value?: string): string {
    const currency = (value ?? DEFAULT_CURRENCY).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw this.invalidAmount();
    return currency;
  }

  private invalidAmount() {
    return new BadRequestException({
      code: 'WALLET_INVALID_AMOUNT',
      message: 'Số tiền ví phải lớn hơn 0.',
    });
  }

  private insufficient(message = 'Số dư khả dụng không đủ.') {
    return new ConflictException({ code: 'INSUFFICIENT_FUNDS', message });
  }

  private frozen() {
    return new ConflictException({ code: 'WALLET_FROZEN', message: 'Ví đang bị tạm khóa.' });
  }
}
