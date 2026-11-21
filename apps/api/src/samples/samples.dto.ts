import { z } from 'zod';

// P4.17 — production samples. Carriers and milestones are entered by hand
// (D13); no carrier API is called.

const moneyAmount = z
  .number()
  .positive()
  .max(1_000_000_000_000)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
    message: 'Số tiền tối đa 2 chữ số thập phân.',
  });

export const createSampleSchema = z.object({
  note: z.string().trim().max(500).optional(),
  // Optional sample fee; P4.19 turns this into a payment request.
  feeAmount: moneyAmount.optional(),
  feeCurrency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase())
    .optional(),
});
export type CreateSampleInput = z.infer<typeof createSampleSchema>;

export const uploadSampleSchema = z.object({
  note: z.string().trim().max(500).optional(),
  fileObjectId: z.string().cuid().optional(),
});
export type UploadSampleInput = z.infer<typeof uploadSampleSchema>;

export const shipSampleSchema = z.object({
  carrier: z.string().trim().min(1).max(100),
  trackingNo: z.string().trim().min(1).max(100),
  trackingUrl: z.string().trim().url().max(500).optional(),
  shippedAt: z.coerce.date().optional(),
});
export type ShipSampleInput = z.infer<typeof shipSampleSchema>;

export const sampleStopTypeSchema = z.enum([
  'PICKED_UP',
  'IN_TRANSIT',
  'CUSTOMS',
  'DELIVERED',
  'OTHER',
]);
export type SampleStopTypeInput = z.infer<typeof sampleStopTypeSchema>;

export const addSampleStopSchema = z.object({
  type: sampleStopTypeSchema.default('OTHER'),
  description: z.string().trim().min(1).max(500),
  location: z.string().trim().max(200).optional(),
  occurredAt: z.coerce.date().optional(),
});
export type AddSampleStopInput = z.infer<typeof addSampleStopSchema>;

export const receiveSampleSchema = z.object({
  note: z.string().trim().max(500).optional(),
  receivedAt: z.coerce.date().optional(),
});
export type ReceiveSampleInput = z.infer<typeof receiveSampleSchema>;

export const reviseSampleSchema = z.object({
  note: z.string().trim().min(1).max(1000),
  evidenceFileObjectId: z.string().cuid().optional(),
});
export type ReviseSampleInput = z.infer<typeof reviseSampleSchema>;

export const approveSampleSchema = z.object({
  note: z.string().trim().max(500).optional(),
});
export type ApproveSampleInput = z.infer<typeof approveSampleSchema>;
