import { z } from 'zod';

// P4.23 — finance-only read filters for the immutable ledger.
export const ledgerTransactionTypes = [
  'DEPOSIT',
  'PAYMENT',
  'PAYOUT',
  'FEE',
  'REFUND',
  'ADJUSTMENT',
  'SETTLEMENT',
  'OTHER',
] as const;

export const listLedgerTransactionsSchema = z
  .object({
    type: z.enum(ledgerTransactionTypes).optional(),
    refType: z.string().trim().max(32).optional(),
    refId: z.string().trim().max(64).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'Thời điểm bắt đầu phải trước thời điểm kết thúc.',
    path: ['from'],
  });

export type ListLedgerTransactionsInput = z.infer<typeof listLedgerTransactionsSchema>;
