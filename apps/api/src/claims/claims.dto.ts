import { z } from 'zod';

// P4.22 — claim (dispute) DTOs. Money follows the same two-decimal rule as the
// payment/payout modules; evidence (photos/videos) is mandatory when filing.
const moneyAmount = z
  .number()
  .positive()
  .max(1_000_000_000_000)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
    message: 'Số tiền tối đa 2 chữ số thập phân.',
  });

export const claimTypeSchema = z.enum(['MISSING', 'QUALITY', 'DAMAGED', 'WRONG_ITEM', 'OTHER']);
export type ClaimTypeInput = z.infer<typeof claimTypeSchema>;

export const issueClaimSchema = z
  .object({
    // Demo-compatible aliases: missing/quality.
    kind: z.enum(['missing', 'quality']).optional(),
    type: claimTypeSchema.optional(),
    missingQuantity: z.number().int().positive().max(1_000_000).optional(),
    notes: z.string().trim().min(3).max(2000),
    evidenceFileObjectIds: z.array(z.string().cuid()).min(1).max(10),
  })
  .superRefine((value, ctx) => {
    const type = value.type ?? (value.kind === 'missing' ? 'MISSING' : 'QUALITY');
    if (type === 'MISSING' && value.missingQuantity === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['missingQuantity'],
        message: 'Nhập số lượng thiếu.',
      });
    }
    if (type !== 'MISSING' && value.missingQuantity !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['missingQuantity'],
        message: 'Chỉ khiếu nại thiếu hàng mới khai số lượng thiếu.',
      });
    }
  });
export type IssueClaimInput = z.infer<typeof issueClaimSchema>;

export const claimProposalSchema = z.object({
  kind: z.enum(['REFUND', 'PARTIAL_REFUND', 'RETURN', 'REPLACE', 'COMPENSATE']),
  amount: moneyAmount.optional(),
  note: z.string().trim().max(1000).optional(),
});
export type ClaimProposalInput = z.infer<typeof claimProposalSchema>;

export const chooseClaimResolutionSchema = z.object({
  choice: z.enum(['TOPUP', 'REFUND', 'RETURN_REFUND']),
  note: z.string().trim().max(1000).optional(),
});
export type ChooseClaimResolutionInput = z.infer<typeof chooseClaimResolutionSchema>;

export const moveTopupSchema = z.object({
  note: z.string().trim().max(500).optional(),
});
export type MoveTopupInput = z.infer<typeof moveTopupSchema>;

export const confirmTopupSchema = z.object({
  note: z.string().trim().max(500).optional(),
});
export type ConfirmTopupInput = z.infer<typeof confirmTopupSchema>;

export const sendReturnSchema = z.object({
  carrier: z.string().trim().min(2).max(100),
  trackingNo: z.string().trim().min(3).max(100),
  proofFileObjectId: z.string().cuid().optional(),
  consent: z.literal(true),
  note: z.string().trim().max(500).optional(),
});
export type SendReturnInput = z.infer<typeof sendReturnSchema>;

export const receiveReturnSchema = z.object({
  note: z.string().trim().max(500).optional(),
});
export type ReceiveReturnInput = z.infer<typeof receiveReturnSchema>;

export const executeRefundSchema = z.object({
  // Defaults to the claim amount; may not exceed it or the money collected.
  amount: moneyAmount.optional(),
  method: z.enum(['BANK_TRANSFER', 'WALLET']).default('BANK_TRANSFER'),
  paymentRef: z.string().trim().min(3).max(64).optional(),
  note: z.string().trim().max(500).optional(),
});
export type ExecuteRefundInput = z.infer<typeof executeRefundSchema>;

export const confirmRefundSchema = z.object({
  received: z.literal(true),
  // For a partial-missing claim the buyer also confirms the remaining goods.
  match: z.boolean().optional(),
  note: z.string().trim().max(500).optional(),
});
export type ConfirmRefundInput = z.infer<typeof confirmRefundSchema>;

export const resolveClaimSchema = z.object({
  decision: z.enum(['ACCEPT', 'REJECT']),
  note: z.string().trim().max(1000).optional(),
});
export type ResolveClaimInput = z.infer<typeof resolveClaimSchema>;

export const withdrawClaimSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type WithdrawClaimInput = z.infer<typeof withdrawClaimSchema>;

export const claimStatuses = [
  'OPEN',
  'PROPOSED',
  'RESOLUTION_CHOSEN',
  'TOPUP_PENDING',
  'TOPUP_CONFIRMED',
  'RETURN_SENT',
  'RETURN_RECEIVED',
  'REFUND_EXECUTED',
  'REFUND_CONFIRMED',
  'CLOSED',
  'REJECTED',
  'WITHDRAWN',
] as const;

export const listAdminClaimsSchema = z.object({
  status: z.enum(claimStatuses).optional(),
  orderId: z.string().cuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListAdminClaimsInput = z.infer<typeof listAdminClaimsSchema>;
