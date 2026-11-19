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
  // P4.9: lets suppliers in the same category see the RFQ without an invite.
  categoryId: z.string().cuid().optional(),
  // P4.11: reference catalogue product + immediate guided experience.
  referenceProductId: z.string().cuid().optional(),
  startExperience: z.boolean().optional(),
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

// P4.9 — supplier quoting. One quote per supplier per RFQ; MOQ may not exceed
// the requested quantity, price must be positive.
export const createQuoteSchema = z.object({
  unitPrice: z.number().positive().max(1_000_000_000),
  currency: z.enum(['VND', 'CNY']).optional(),
  moq: z.number().int().positive().max(1_000_000),
  leadTimeDays: z.number().int().min(0).max(365),
  validUntil: z.coerce.date().optional(),
  deliveryTerms: z.string().trim().max(500).optional(),
  note: z.string().trim().max(1000).optional(),
});
export type CreateQuoteInput = z.infer<typeof createQuoteSchema>;

export const updateQuoteSchema = createQuoteSchema.partial();
export type UpdateQuoteInput = z.infer<typeof updateQuoteSchema>;

export const supplierRequestQuerySchema = z.object({
  status: z.enum(['OPEN', 'QUOTED']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
export type SupplierRequestQueryInput = z.infer<typeof supplierRequestQuerySchema>;

// P4.8/P4.9: sales invites one or more suppliers to quote on an RFQ.
export const inviteSuppliersSchema = z.object({
  supplierIds: z.array(z.string().cuid()).min(1).max(50),
});
export type InviteSuppliersInput = z.infer<typeof inviteSuppliersSchema>;

// P4.10 — buyer picks the winning quote.
export const selectQuoteSchema = z.object({
  quoteId: z.string().cuid(),
  note: z.string().trim().max(500).optional(),
});
export type SelectQuoteInput = z.infer<typeof selectQuoteSchema>;

// P4.11 — CVC concierge: sales files a request for a walk-in customer (or an
// existing buyer) and opens a private Deal Room with a matched supplier.
export const adminConciergeRequestSchema = z
  .object({
    buyerId: z.string().cuid().optional(),
    buyerName: z.string().trim().min(1).max(100).optional(),
    buyerPhone: z.string().trim().min(6).max(20).optional(),
    title: z.string().trim().min(1).max(200),
    content: z.string().trim().max(2000).optional(),
    quantity: z.number().int().positive().max(1_000_000),
    categoryId: z.string().cuid().optional(),
    referenceProductId: z.string().cuid().optional(),
    market: z.string().trim().max(100).optional(),
    targetPrice: z.number().positive().max(1_000_000_000).optional(),
    currency: z.enum(['VND', 'CNY']).optional(),
    expiresAt: z.coerce.date().optional(),
    // When true the supplier is matched and the Deal Room opened immediately.
    startExperience: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.buyerId && !value.buyerName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['buyerName'],
        message: 'Cần buyerId hoặc tên khách hàng.',
      });
    }
  });
export type AdminConciergeRequestInput = z.infer<typeof adminConciergeRequestSchema>;

export const openConciergeRoomSchema = z.object({
  requestId: z.string().cuid(),
  // Optional: connect an exact quote, or an explicit supplier without a quote.
  quoteId: z.string().cuid().optional(),
  supplierId: z.string().cuid().optional(),
});
export type OpenConciergeRoomInput = z.infer<typeof openConciergeRoomSchema>;
