import type { AdminGroup } from '@cvc/shared';
import { SetMetadata } from '@nestjs/common';

export const ADMIN_GROUPS_KEY = 'admin_groups';

// Restricts a route to callers holding one of the given admin permission
// groups (P2.10), e.g. money approval needs AdminGroups('admin_finance',
// 'admin_super'). Verified against the user's admin_* rows in user_roles,
// fetched fresh from the DB on every request.
export const AdminGroups = (...groups: AdminGroup[]) => SetMetadata(ADMIN_GROUPS_KEY, groups);
