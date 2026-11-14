import type { Role } from '@cvc/shared';
import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

// Declares the roles allowed on a route (P2.7). Checked by RolesGuard against
// the active role in the access token. Called with no arguments, @Roles()
// means "any authenticated user" (the JWT guard ensures authentication).
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
