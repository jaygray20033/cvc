import { type Role, ROLE_VALUES } from '@cvc/shared';
import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

// Switch the role in use for the current session (P2.9). The role must be one
// the account actually holds; the service checks that too.
export const switchRoleSchema = z.object({
  // ROLE_VALUES is a plain array; the tuple cast is for z.enum().
  role: z.enum(ROLE_VALUES as unknown as [Role, ...Role[]]),
});

export type SwitchRoleInput = z.infer<typeof switchRoleSchema>;

export class SwitchRoleDto {
  static schema = switchRoleSchema;
  @ApiProperty({ example: 'participant', enum: ROLE_VALUES }) role!: Role;
}
