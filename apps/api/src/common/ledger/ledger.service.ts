import { Injectable } from '@nestjs/common';
import type { LedgerAccountType, LedgerSide, LedgerTransactionType, Prisma } from '@prisma/client';
import { Prisma as PrismaNs } from '@prisma/client';

// P3.9/P4.19 — minimal double-entry writer. Entries are immutable at the DB
// level and the trigger `ledger_entries_balanced` verifies debit == credit once
// expectedEntries rows exist. Callers pass an interactive transaction so the
// business row and its ledger rows commit together.
export interface LedgerLine {
  accountCode: string;
  accountName: string;
  accountType: LedgerAccountType;
  side: LedgerSide;
  amount: PrismaNs.Decimal | string | number;
}

export interface PostLedgerInput {
  type: LedgerTransactionType;
  refType: string;
  refId: string;
  currency: string;
  createdById: string;
  note?: string;
  lines: LedgerLine[];
}

export interface PostLedgerResult {
  transactionId: string;
  alreadyPosted: boolean;
}

@Injectable()
export class LedgerService {
  // Post once per (refType, refId): a retry returns the existing transaction
  // instead of writing a second set of entries.
  async post(tx: Prisma.TransactionClient, input: PostLedgerInput): Promise<PostLedgerResult> {
    const existing = await tx.ledgerTransaction.findFirst({
      where: { refType: input.refType, refId: input.refId },
      select: { id: true },
    });
    if (existing) return { transactionId: existing.id, alreadyPosted: true };

    const transaction = await tx.ledgerTransaction.create({
      data: {
        expectedEntries: input.lines.length,
        type: input.type,
        status: 'POSTED',
        currency: input.currency,
        postedAt: new Date(),
        refType: input.refType,
        refId: input.refId,
        note: input.note ?? null,
        createdById: input.createdById,
      },
      select: { id: true },
    });

    for (const line of input.lines) {
      const account = await tx.ledgerAccount.upsert({
        where: { code: line.accountCode },
        create: {
          code: line.accountCode,
          name: line.accountName,
          type: line.accountType,
          currency: input.currency,
        },
        update: {},
        select: { id: true },
      });
      await tx.ledgerEntry.create({
        data: {
          transactionId: transaction.id,
          accountId: account.id,
          side: line.side,
          amount: new PrismaNs.Decimal(line.amount),
          refType: input.refType,
          refId: input.refId,
          note: input.note ?? null,
        },
      });
    }

    return { transactionId: transaction.id, alreadyPosted: false };
  }
}
