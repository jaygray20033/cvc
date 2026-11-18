import { z } from 'zod';

// P4A.2 — supplier portal DTOs (P4.4) and admin supplier/account management (P4.5).

export const createSupplierSchema = z.object({
  name: z.string().trim().min(1).max(191),
  province: z.string().trim().max(100).optional(),
  country: z.string().trim().length(2).optional(),
  contactName: z.string().trim().max(100).optional(),
  contactPhone: z.string().trim().max(32).optional(),
  contactWechat: z.string().trim().max(64).optional(),
  address: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(500).optional(),
});
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;

// `createAccount` in the demo: supplier company + login account via invite email.
export const createSupplierAccountSchema = z.object({
  supplierId: z.string().cuid(),
  email: z.string().trim().email().max(191),
  title: z.string().trim().max(100).optional(),
  isPrimary: z.boolean().optional(),
});
export type CreateSupplierAccountInput = z.infer<typeof createSupplierAccountSchema>;

// `toggleAccount`: lock/unlock a supplier login.
export const supplierAccountStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED']),
});
export type SupplierAccountStatusInput = z.infer<typeof supplierAccountStatusSchema>;

// Supplier listings use the NCC- SKU namespace (CVC- is reserved for admin).
const supplierSkuSchema = z.string().regex(/^NCC-[A-Z0-9-]{1,27}$/, 'SKU phải có dạng NCC-XXX');

export const supplierProductSchema = z.object({
  name: z.string().trim().min(1).max(200),
  categoryId: z.string().cuid(),
  spec: z.string().trim().max(500).optional(),
  moq: z.number().int().positive().max(1_000_000),
  leadTimeDays: z.number().int().min(1).max(365).optional(),
  // Supplier cost price lives on SupplierProduct (never Product.priceRef).
  costPrice: z.number().min(0),
  currency: z.enum(['CNY', 'VND']).optional(),
  supplierSku: z.string().trim().max(64).optional(),
  sku: supplierSkuSchema.optional(),
});
export type SupplierProductInput = z.infer<typeof supplierProductSchema>;

// SKU is immutable after creation.
export const updateSupplierProductSchema = supplierProductSchema.omit({ sku: true }).partial();
export type UpdateSupplierProductInput = z.infer<typeof updateSupplierProductSchema>;

export const supplierProductVisibilitySchema = z.object({ visible: z.boolean() });
export type SupplierProductVisibilityInput = z.infer<typeof supplierProductVisibilitySchema>;

export const supplierProductQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
export type SupplierProductQueryInput = z.infer<typeof supplierProductQuerySchema>;
