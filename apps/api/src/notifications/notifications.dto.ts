import { z } from 'zod';

export const updatePreferencesSchema = z.object({
  email: z.boolean().optional(),
  inApp: z.boolean().optional(),
  sms: z.boolean().optional(),
  zns: z.boolean().optional(),
  push: z.boolean().optional(),
});
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;

export class UpdatePreferencesDto {
  static schema = updatePreferencesSchema;
  email?: boolean;
  inApp?: boolean;
  sms?: boolean;
  zns?: boolean;
  push?: boolean;
}
