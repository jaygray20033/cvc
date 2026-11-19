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
