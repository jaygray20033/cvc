import { z } from 'zod';

// P4.20 — manual supplier payouts (D1: CVC holds the money and posts the
// ledger). Amounts mirror the payment DTO precision rules.
const moneyAmount = z
  .number()
  .positive()
  .max(1_000_000_000_000)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
    message: 'Số tiền tối đa 2 chữ số thập phân.',
  });

export const createSupplierPayoutSchema = z.object({
  amount: moneyAmount,
  // The receiving account must belong to a verified supplier user; without it
  // the request fails with PAYOUT_BANK_ACCOUNT_REQUIRED.
  bankAccountId: z.string().cuid().optional(),
  reason: z.string().trim().min(3).max(500),
  note: z.string().trim().max(500).optional(),
});
export type CreateSupplierPayoutInput = z.infer<typeof createSupplierPayoutSchema>;

export const approvePayoutSchema = z.object({
  note: z.string().trim().max(500).optional(),
});
export type ApprovePayoutInput = z.infer<typeof approvePayoutSchema>;

export const rejectPayoutSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type RejectPayoutInput = z.infer<typeof rejectPayoutSchema>;

export const markPayoutPaidSchema = z.object({
  fileObjectId: z.string().cuid(),
  transactionRef: z.string().trim().min(3).max(100),
  paidAt: z.coerce.date().optional(),
  note: z.string().trim().max(500).optional(),
});
export type MarkPayoutPaidInput = z.infer<typeof markPayoutPaidSchema>;

export const confirmPayoutReceivedSchema = z.object({
  note: z.string().trim().max(500).optional(),
});
export type ConfirmPayoutReceivedInput = z.infer<typeof confirmPayoutReceivedSchema>;

export const payoutStatuses = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

export const listPayoutsSchema = z.object({
  status: z.enum(payoutStatuses).optional(),
  orderId: z.string().cuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListPayoutsInput = z.infer<typeof listPayoutsSchema>;
