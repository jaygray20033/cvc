import { z } from 'zod';

// P4A.1 — catalog DTOs (products, categories, sourcing cases).

// SKU format mirrors the demo catalog: CVC-<alphanumeric-with-dashes>.
const skuSchema = z
  .string()
  .regex(/^CVC-[A-Z0-9][A-Z0-9-]{0,23}$/, 'SKU phải có dạng CVC-XXX (chữ hoa, số, gạch ngang)');

const specItemSchema = z.object({
  key: z.string().trim().min(1).max(100),
  value: z.string().trim().min(1).max(255),
});

export const createProductSchema = z.object({
  sku: skuSchema,
  name: z.string().trim().min(1).max(200),
  categoryId: z.string().cuid(),
  spec: z.string().trim().max(500).optional(),
  moq: z.number().int().positive().max(1_000_000),
  leadTimeDays: z.number().int().min(1).max(365).optional(),
  priceRef: z.number().min(0).optional(),
  currency: z.enum(['VND', 'CNY']).optional(),
  specs: z.array(specItemSchema).max(50).optional(),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

// SKU is immutable after creation (referenced by orders/cases).
export const updateProductSchema = createProductSchema.omit({ sku: true }).partial();
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const visibilitySchema = z.object({ visible: z.boolean() });
export type VisibilityInput = z.infer<typeof visibilitySchema>;

export const productImagesSchema = z.object({
  // Must reference confirmed file objects (READY, not infected).
  fileObjectIds: z.array(z.string().cuid()).min(1).max(20),
});
export type ProductImagesInput = z.infer<typeof productImagesSchema>;

export const replaceSpecsSchema = z.object({ specs: z.array(specItemSchema).max(50) });
export type ReplaceSpecsInput = z.infer<typeof replaceSpecsSchema>;

export const publishCaseSchema = z.object({
  // The catalog product this completed-order case is based on.
  productId: z.string().cuid(),
  name: z.string().trim().min(1).max(200),
  spec: z.string().trim().max(500).optional(),
});
export type PublishCaseInput = z.infer<typeof publishCaseSchema>;

export const productQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
export type ProductQueryInput = z.infer<typeof productQuerySchema>;

// Admin list filters.
export const adminProductQuerySchema = productQuerySchema.extend({
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
});
export type AdminProductQueryInput = z.infer<typeof adminProductQuerySchema>;
