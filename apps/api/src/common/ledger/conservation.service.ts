import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';

// P4.25 — money conservation checks. Runs periodically (cron), right after
// important money flows (payment approval, payout, refund) and on demand from
// the finance admin API. A MISMATCH alerts finance admins and temporarily
// blocks withdrawals until a later run is OK again.
const FINANCE_ROLES = ['admin_finance', 'admin_super'] as const;
const BANK_ACCOUNT_CODE = 'CVC-BANK';
const WALLET_ACCOUNT_PREFIX = 'CUS-';

export type ConservationRunStatus = 'OK' | 'MISMATCH';

export interface ConservationRunInput {
  source: string;
  triggeredById?: string;
}

export interface WalletMismatch {
  userId: string;
  cached: string;
  ledger: string;
  reason: string;
}

export interface ConservationReport {
  id?: string;
  source: string;
  status: ConservationRunStatus;
  checkedAt: string;
  ledger: { balanced: boolean; debitTotal: string; creditTotal: string };
  wallets: { checked: number; mismatches: WalletMismatch[]; uncachedAccounts: number };
  cash: { moneyIn: string; moneyOut: string; cashHeld: string; negative: boolean };
  alerted: boolean;
}

@Injectable()
export class ConservationService {
  private readonly logger = new Logger(ConservationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // Full run: trial balance, wallet cache vs ledger, and cash movement. The
  // cash section is advisory (a negative bank balance alone does not block
  // money) while the first two decide the run status.
  async run(input: ConservationRunInput): Promise<ConservationReport> {
    const checkedAt = new Date();
    const [ledger, walletResult, cash] = await Promise.all([
      this.checkTrialBalance(),
      this.checkWallets(),
      this.checkCash(),
    ]);

    const status: ConservationRunStatus =
      ledger.balanced && walletResult.mismatches.length === 0 ? 'OK' : 'MISMATCH';

    const report = {
      source: input.source,
      status,
      checkedAt: checkedAt.toISOString(),
      ledger: {
        balanced: ledger.balanced,
        debitTotal: ledger.debitTotal,
        creditTotal: ledger.creditTotal,
      },
      wallets: walletResult,
      cash,
    };

    const previous = await this.prisma.moneyConservationRun.findFirst({
      orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
      select: { status: true },
    });
    // Alert only on the OK -> MISMATCH transition so a persisted / recurring
    // mismatch does not spam finance every 15 minutes.
    const shouldAlert = status === 'MISMATCH' && previous?.status !== 'MISMATCH';

    const row = await this.prisma.moneyConservationRun.create({
      data: {
        source: input.source.slice(0, 40),
        status,
        ledgerBalanced: ledger.balanced,
        debitTotal: new Prisma.Decimal(ledger.debitTotal),
        creditTotal: new Prisma.Decimal(ledger.creditTotal),
        walletsChecked: walletResult.checked,
        walletMismatches: walletResult.mismatches.length,
        moneyIn: new Prisma.Decimal(cash.moneyIn),
        moneyOut: new Prisma.Decimal(cash.moneyOut),
        cashHeld: new Prisma.Decimal(cash.cashHeld),
        report: report as unknown as Prisma.InputJsonValue,
        triggeredById: input.triggeredById ?? null,
      },
      select: { id: true },
    });

    if (shouldAlert) {
      try {
        await this.alertFinanceAdmins(report);
        await this.prisma.moneyConservationRun.update({
          where: { id: row.id },
          data: { alertedAt: checkedAt },
        });
      } catch (error) {
        this.logger.error(
          { err: error instanceof Error ? error.message : String(error) },
          'conservation alert failed',
        );
      }
    }

    return { ...report, id: row.id, alerted: shouldAlert };
  }

  // Called after a money transaction commits. Never throws into the caller:
  // the money op already committed and must not fail because of the check.
  async runAfter(source: string): Promise<void> {
    try {
      await this.run({ source });
    } catch (error) {
      this.logger.error(
        { err: error instanceof Error ? error.message : String(error), source },
        'conservation run failed',
      );
    }
  }

  async status() {
    const latest = await this.prisma.moneyConservationRun.findFirst({
      orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        source: true,
        status: true,
        ledgerBalanced: true,
        walletMismatches: true,
        report: true,
        alertedAt: true,
        checkedAt: true,
      },
    });
    return { withdrawalsBlocked: latest?.status === 'MISMATCH', latest };
  }

  async isWithdrawalsBlocked(): Promise<boolean> {
    const latest = await this.prisma.moneyConservationRun.findFirst({
      orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
      select: { status: true },
    });
    return latest?.status === 'MISMATCH';
  }

  // P4.26 will call this at the start of every withdrawal request.
  async assertWithdrawalsAllowed(): Promise<void> {
    if (await this.isWithdrawalsBlocked()) {
      throw new ConflictException({
        code: 'WITHDRAWALS_BLOCKED_CONSERVATION',
        message:
          'Rút tiền đang tạm khóa do kiểm tra bảo toàn tiền chưa khớp. Liên hệ admin tài chính.',
      });
    }
  }

  private async checkTrialBalance() {
    const sums = await this.prisma.ledgerEntry.groupBy({
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
      balanced: debit.equals(credit),
      debitTotal: debit.toFixed(2),
      creditTotal: credit.toFixed(2),
    };
  }

  // Compares each existing Wallet.balance cache with the credit-normal sum of
  // its `CUS-{userId}` ledger account. `CUS-*` accounts without a Wallet row
  // are reported as uncached liabilities (a user who has not opened the wallet
  // yet) but do not by themselves fail the run.
  private async checkWallets(): Promise<{
    checked: number;
    mismatches: WalletMismatch[];
    uncachedAccounts: number;
  }> {
    const [wallets, accounts] = await Promise.all([
      this.prisma.wallet.findMany({
        select: { userId: true, balance: true, heldBalance: true, status: true },
      }),
      this.prisma.ledgerAccount.findMany({
        where: { code: { startsWith: WALLET_ACCOUNT_PREFIX } },
        select: { id: true, code: true },
      }),
    ]);

    const accountIds = accounts.map((account) => account.id);
    const sums = accountIds.length
      ? await this.prisma.ledgerEntry.groupBy({
          by: ['accountId', 'side'],
          where: { accountId: { in: accountIds } },
          _sum: { amount: true },
        })
      : [];
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

    const balanceByCode = new Map<string, Prisma.Decimal>();
    for (const account of accounts) {
      const entry = totals.get(account.id) ?? {
        debit: new Prisma.Decimal(0),
        credit: new Prisma.Decimal(0),
      };
      balanceByCode.set(account.code, entry.credit.minus(entry.debit));
    }

    const mismatches: WalletMismatch[] = [];
    const walletCodes = new Set<string>();
    for (const wallet of wallets) {
      const code = `${WALLET_ACCOUNT_PREFIX}${wallet.userId}`;
      walletCodes.add(code);
      const ledgerBalance = balanceByCode.get(code) ?? new Prisma.Decimal(0);
      if (!wallet.balance.equals(ledgerBalance)) {
        mismatches.push({
          userId: wallet.userId,
          cached: wallet.balance.toFixed(2),
          ledger: ledgerBalance.toFixed(2),
          reason: 'BALANCE_MISMATCH',
        });
        continue;
      }
      if (wallet.balance.lt(0) || wallet.heldBalance.lt(0)) {
        mismatches.push({
          userId: wallet.userId,
          cached: wallet.balance.toFixed(2),
          ledger: ledgerBalance.toFixed(2),
          reason: 'NEGATIVE_BALANCE',
        });
      } else if (wallet.heldBalance.gt(wallet.balance)) {
        mismatches.push({
          userId: wallet.userId,
          cached: wallet.balance.toFixed(2),
          ledger: ledgerBalance.toFixed(2),
          reason: 'HELD_EXCEEDS_BALANCE',
        });
      }
    }

    let uncachedAccounts = 0;
    for (const [code, balance] of balanceByCode) {
      if (!walletCodes.has(code) && !balance.isZero()) uncachedAccounts += 1;
    }

    return { checked: wallets.length, mismatches, uncachedAccounts };
  }

  // Cash movement through CVC-BANK: money received = cash held + paid out.
  private async checkCash() {
    const account = await this.prisma.ledgerAccount.findUnique({
      where: { code: BANK_ACCOUNT_CODE },
      select: { id: true },
    });
    let moneyIn = new Prisma.Decimal(0);
    let moneyOut = new Prisma.Decimal(0);
    if (account) {
      const sums = await this.prisma.ledgerEntry.groupBy({
        by: ['side'],
        where: { accountId: account.id },
        _sum: { amount: true },
      });
      for (const row of sums) {
        const amount = row._sum.amount ?? new Prisma.Decimal(0);
        if (row.side === 'DEBIT') moneyIn = moneyIn.plus(amount);
        else moneyOut = moneyOut.plus(amount);
      }
    }
    const cashHeld = moneyIn.minus(moneyOut);
    return {
      moneyIn: moneyIn.toFixed(2),
      moneyOut: moneyOut.toFixed(2),
      cashHeld: cashHeld.toFixed(2),
      negative: cashHeld.lt(0),
    };
  }

  private async alertFinanceAdmins(report: {
    checkedAt: string;
    ledger: { debitTotal: string; creditTotal: string };
    wallets: { mismatches: WalletMismatch[] };
  }): Promise<void> {
    const roles = await this.prisma.userRole.findMany({
      where: { role: { in: [...FINANCE_ROLES] } },
      select: { userId: true },
    });
    const userIds = [...new Set(roles.map((row) => row.userId))];
    const data = {
      checkedAt: report.checkedAt,
      debitTotal: report.ledger.debitTotal,
      creditTotal: report.ledger.creditTotal,
      walletMismatches: report.wallets.mismatches.length,
      firstWallet: report.wallets.mismatches[0]?.userId ?? null,
    };
    await Promise.all(
      userIds.map((userId) => this.notifications.emit('money.conservation_mismatch', userId, data)),
    );
  }
}
