import { z } from 'zod';

// P4A.2 — RFQ (P4.7) and sales intake (P4.8) DTOs.

export const sourcingRequestStatusSchema = z.enum([
  'OPEN',
  'QUOTED',
  'SELECTED',
  'CONVERTED',
  'EXPIRED',
  'CLOSED',
  'CANCELLED',
]);

export const createSourcingRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().max(2000).optional(),
  // DoD: quantity must be a positive integer.
  quantity: z.number().int().positive().max(1_000_000),
  // Target sales market (optional free text).
  market: z.string().trim().max(100).optional(),
  targetPrice: z.number().min(0).optional(),
  currency: z.enum(['VND', 'CNY']).optional(),
  // Optional deadline: expired requests accept no quotes and cannot be selected.
  expiresAt: z.coerce.date().optional(),
  fileObjectIds: z.array(z.string().cuid()).max(10).optional(),
});
export type CreateSourcingRequestInput = z.infer<typeof createSourcingRequestSchema>;

export const sourcingRequestQuerySchema = z.object({
  status: sourcingRequestStatusSchema.optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
export type SourcingRequestQueryInput = z.infer<typeof sourcingRequestQuerySchema>;

export const adminSourcingRequestQuerySchema = sourcingRequestQuerySchema.extend({
  assignee: z.string().cuid().optional(),
});
export type AdminSourcingRequestQueryInput = z.infer<typeof adminSourcingRequestQuerySchema>;

export const assignSourcingRequestSchema = z.object({
  assigneeId: z.string().cuid(),
  slaDueAt: z.coerce.date().optional(),
});
export type AssignSourcingRequestInput = z.infer<typeof assignSourcingRequestSchema>;

export const addSourcingNoteSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});
export type AddSourcingNoteInput = z.infer<typeof addSourcingNoteSchema>;
