import { z } from 'zod';

// P4.6 — partner banners (supplier / shipping placements with a display window).

const partnerTypeSchema = z.enum(['SUPPLIER', 'SHIPPING']);
const positionSchema = z.enum(['HOME_TOP', 'HOME_MID', 'CATEGORY_SIDEBAR', 'SEARCH_SIDEBAR']);

// Absolute http(s) URL or an in-app relative path (demo banners link to "/...").
const linkUrlSchema = z
  .string()
  .trim()
  .max(500)
  .regex(/^(https?:\/\/|\/)/, 'Link phải là URL http(s) hoặc đường dẫn nội bộ');

export const createPartnerBannerSchema = z.object({
  partnerType: partnerTypeSchema,
  name: z.string().trim().min(1).max(191),
  // Confirmed file objects only (READY, not infected) - same rule as P4.1.
  logoFileObjectId: z.string().cuid().optional(),
  linkUrl: linkUrlSchema.optional(),
  position: positionSchema,
  isActive: z.boolean().optional(),
  sortIndex: z.number().int().min(0).max(10_000).optional(),
  // Display window; omitted = always active.
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
});
export type CreatePartnerBannerInput = z.infer<typeof createPartnerBannerSchema>;

export const updatePartnerBannerSchema = createPartnerBannerSchema.partial();
export type UpdatePartnerBannerInput = z.infer<typeof updatePartnerBannerSchema>;

export const partnerBannerQuerySchema = z.object({
  partnerType: partnerTypeSchema.optional(),
  position: positionSchema.optional(),
});
export type PartnerBannerQueryInput = z.infer<typeof partnerBannerQuerySchema>;
