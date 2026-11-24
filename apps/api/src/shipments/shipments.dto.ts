import { SHIPPING_STOP_CODES } from '@cvc/shared';
import { z } from 'zod';

// P4.19 C/D — hand-entered shipments (no carrier API, D13) and receipt.
const stopCodes = z.enum([...SHIPPING_STOP_CODES, 'OTHER'] as unknown as [string, ...string[]]);

export const createShipmentSchema = z.object({
  carrier: z.string().trim().min(1).max(100),
  trackingNo: z.string().trim().min(1).max(100),
  trackingUrl: z.string().trim().url().max(500).optional(),
  shippedAt: z.coerce.date().optional(),
  expectedAt: z.coerce.date().optional(),
  proofFileObjectId: z.string().cuid().optional(),
});
export type CreateShipmentInput = z.infer<typeof createShipmentSchema>;

export const updateShipmentSchema = z
  .object({
    carrier: z.string().trim().min(1).max(100).optional(),
    trackingNo: z.string().trim().min(1).max(100).optional(),
    trackingUrl: z.string().trim().url().max(500).nullable().optional(),
    shippedAt: z.coerce.date().optional(),
    expectedAt: z.coerce.date().optional(),
    deliveredAt: z.coerce.date().optional(),
    status: z.enum(['PREPARING', 'IN_TRANSIT', 'DELIVERED', 'RETURNED']).optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'Cần ít nhất một trường để cập nhật.',
  });
export type UpdateShipmentInput = z.infer<typeof updateShipmentSchema>;

export const addShipmentStopSchema = z.object({
  type: stopCodes.default('OTHER'),
  description: z.string().trim().min(1).max(500),
  location: z.string().trim().max(200).optional(),
  occurredAt: z.coerce.date().optional(),
});
export type AddShipmentStopInput = z.infer<typeof addShipmentStopSchema>;

export const confirmReceiptSchema = z.object({
  note: z.string().trim().max(500).optional(),
});
export type ConfirmReceiptInput = z.infer<typeof confirmReceiptSchema>;
