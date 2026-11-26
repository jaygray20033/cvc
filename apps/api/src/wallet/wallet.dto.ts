import { z } from 'zod';

// P4.24 — wallet transaction filters and statement export.
export const listWalletTransactionsSchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'Thời điểm bắt đầu phải trước thời điểm kết thúc.',
    path: ['from'],
  });
export type ListWalletTransactionsInput = z.infer<typeof listWalletTransactionsSchema>;

export const walletStatementSchema = z
  .object({
    format: z.enum(['csv', 'pdf']).default('csv'),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'Thời điểm bắt đầu phải trước thời điểm kết thúc.',
    path: ['from'],
  });
export type WalletStatementInput = z.infer<typeof walletStatementSchema>;
