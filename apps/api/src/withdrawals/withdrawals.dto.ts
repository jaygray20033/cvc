import { z } from 'zod';

// P4.26 — user withdrawals. Amounts mirror the payment/payout precision rules.
const moneyAmount = z
  .number()
  .positive()
  .max(1_000_000_000_000)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
    message: 'Số tiền tối đa 2 chữ số thập phân.',
  });

export const withdrawalStatuses = [
  'PENDING',
  'APPROVED',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'REJECTED',
  'CANCELLED',
] as const;

export const createWithdrawalSchema = z.object({
  amount: moneyAmount,
  // Must be one of the caller's own bank accounts (verified by holder name
  // when it was created); KYC FULL is enforced by KycGuard.
  bankAccountId: z.string().cuid(),
  note: z.string().trim().max(500).optional(),
});
export type CreateWithdrawalInput = z.infer<typeof createWithdrawalSchema>;

export const approveWithdrawalSchema = z.object({
  note: z.string().trim().max(500).optional(),
});
export type ApproveWithdrawalInput = z.infer<typeof approveWithdrawalSchema>;

export const rejectWithdrawalSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type RejectWithdrawalInput = z.infer<typeof rejectWithdrawalSchema>;

export const cancelWithdrawalSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type CancelWithdrawalInput = z.infer<typeof cancelWithdrawalSchema>;

export const markWithdrawalPaidSchema = z.object({
  fileObjectId: z.string().cuid(),
  transactionRef: z.string().trim().min(3).max(100),
  paidAt: z.coerce.date().optional(),
  note: z.string().trim().max(500).optional(),
});
export type MarkWithdrawalPaidInput = z.infer<typeof markWithdrawalPaidSchema>;

export const listWithdrawalsSchema = z.object({
  status: z.enum(withdrawalStatuses).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListWithdrawalsInput = z.infer<typeof listWithdrawalsSchema>;
