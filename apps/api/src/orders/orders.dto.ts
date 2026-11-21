import { ORDER_STATUSES, type OrderStatusCode } from '@cvc/shared';
import { z } from 'zod';

// P4.16 — order reads + the single transition entry point.
const orderStatusSchema = z.enum(
  ORDER_STATUSES as unknown as [OrderStatusCode, ...OrderStatusCode[]],
);

export const listOrdersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: orderStatusSchema.optional(),
});
export type ListOrdersQueryInput = z.infer<typeof listOrdersQuerySchema>;

export const transitionOrderSchema = z.object({
  to: orderStatusSchema,
  reason: z.string().trim().min(1).max(500).optional(),
});
export type TransitionOrderInput = z.infer<typeof transitionOrderSchema>;
