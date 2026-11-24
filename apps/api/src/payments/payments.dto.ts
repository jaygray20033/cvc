import { z } from 'zod';

// P4.19 — manual P2P payment requests and proof submission (D3/D13).
const moneyAmount = z
  .number()
  .positive()
  .max(1_000_000_000_000)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
    message: 'Số tiền tối đa 2 chữ số thập phân.',
  });

export const orderPaymentKindSchema = z.enum(['DEPOSIT', 'FINAL']);
export type OrderPaymentKindInput = z.infer<typeof orderPaymentKindSchema>;

export const createOrderPaymentSchema = z.object({
  kind: orderPaymentKindSchema,
  note: z.string().trim().max(500).optional(),
});
export type CreateOrderPaymentInput = z.infer<typeof createOrderPaymentSchema>;

export const submitPaymentProofSchema = z.object({
  fileObjectId: z.string().cuid(),
  amount: moneyAmount,
  transferredAt: z.coerce.date(),
  senderBank: z.string().trim().min(2).max(100),
  transactionRef: z.string().trim().min(3).max(100),
  note: z.string().trim().max(255).optional(),
});
export type SubmitPaymentProofInput = z.infer<typeof submitPaymentProofSchema>;

export const approvePaymentSchema = z.object({
  // Admin enters the amount actually seen on the bank statement.
  receivedAmount: moneyAmount,
  note: z.string().trim().max(500).optional(),
});
export type ApprovePaymentInput = z.infer<typeof approvePaymentSchema>;

export const rejectPaymentSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type RejectPaymentInput = z.infer<typeof rejectPaymentSchema>;

export const requestMorePaymentSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type RequestMorePaymentInput = z.infer<typeof requestMorePaymentSchema>;

export const paymentStatuses = [
  'AWAITING_PROOF',
  'PROOF_SUBMITTED',
  'APPROVED',
  'PARTIAL',
  'REJECTED',
  'EXPIRED',
  'CONFIRMED',
] as const;

export const listAdminPaymentsSchema = z.object({
  status: z.enum(paymentStatuses).optional(),
  orderId: z.string().cuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListAdminPaymentsInput = z.infer<typeof listAdminPaymentsSchema>;
