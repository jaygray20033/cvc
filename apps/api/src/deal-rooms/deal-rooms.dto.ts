import { z } from 'zod';

// P4.12 — Deal Room membership. Sales can invite more colleagues/inspectors
// into an existing room; the room itself is created by P4.10/P4.11.

export const dealRoomMemberRoleSchema = z.enum([
  'buyer',
  'supplier',
  'sales',
  'inspector',
  'admin',
  'member',
]);
export type DealRoomMemberRole = z.infer<typeof dealRoomMemberRoleSchema>;

export const addDealRoomMemberSchema = z.object({
  userId: z.string().cuid(),
  role: dealRoomMemberRoleSchema.default('member'),
});
export type AddDealRoomMemberInput = z.infer<typeof addDealRoomMemberSchema>;

// P4.13 — chat. Cursors are message ids; pages walk older messages.
export const listDealRoomMessagesSchema = z.object({
  cursor: z.string().cuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
export type ListDealRoomMessagesInput = z.infer<typeof listDealRoomMessagesSchema>;

export const sendDealRoomMessageSchema = z.object({
  body: z.string().trim().min(1).max(2000),
  attachmentIds: z.array(z.string().cuid()).max(10).optional(),
});
export type SendDealRoomMessageInput = z.infer<typeof sendDealRoomMessageSchema>;

export const markDealRoomReadSchema = z.object({
  messageId: z.string().cuid(),
});
export type MarkDealRoomReadInput = z.infer<typeof markDealRoomReadSchema>;

// P4.14 — POST /messages/:id/translate?lang=vi|zh|en|zh-CN...
export const translateMessageQuerySchema = z.object({
  lang: z
    .string()
    .trim()
    .regex(/^[a-zA-Z]{2}(-[a-zA-Z]{2})?$/, 'Mã ngôn ngữ phải dạng vi, en hoặc zh-CN.')
    .transform((value) => value.toLowerCase()),
});
export type TranslateMessageQueryInput = z.infer<typeof translateMessageQuerySchema>;

// P4.15 — price offers. Amounts are decimal money; the currency defaults to
// the order currency and must match it when provided.
const moneyAmount = z
  .number()
  .positive()
  .max(1_000_000_000_000)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
    message: 'Đơn giá tối đa 2 chữ số thập phân.',
  });

export const createOfferSchema = z.object({
  unitPrice: moneyAmount,
  quantity: z.number().int().positive().max(1_000_000),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase())
    .optional(),
  conditions: z.string().trim().max(1000).optional(),
  validUntil: z.coerce
    .date()
    .refine((value) => value.getTime() > Date.now(), {
      message: 'Hạn hiệu lực phải ở tương lai.',
    })
    .optional(),
});
export type CreateOfferInput = z.infer<typeof createOfferSchema>;
export type CounterOfferInput = CreateOfferInput;

// Terms are structured JSON, bounded so a single edit cannot bloat the
// immutable snapshot. Versioning happens in the service.
const termsValue = z.union([
  z.string().max(2000),
  z.number(),
  z.boolean(),
  z.null(),
  z
    .array(
      z.object({
        name: z.string().trim().min(1).max(100),
        value: z.string().trim().min(1).max(500),
      }),
    )
    .max(50),
]);

export const saveDealTermsSchema = z
  .object({
    terms: z.record(termsValue),
    currency: z
      .string()
      .trim()
      .length(3)
      .transform((value) => value.toUpperCase())
      .optional(),
  })
  .refine((input) => Object.keys(input.terms).length <= 30, {
    message: 'Quá nhiều trường điều khoản.',
    path: ['terms'],
  })
  .refine((input) => JSON.stringify(input.terms).length <= 20_000, {
    message: 'Điều khoản quá lớn.',
    path: ['terms'],
  });
export type SaveDealTermsInput = z.infer<typeof saveDealTermsSchema>;
