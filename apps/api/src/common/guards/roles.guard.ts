import type { Role } from '@cvc/shared';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { PrismaService } from '../../prisma/prisma.service';
import { ADMIN_GROUPS_KEY } from '../decorators/admin-groups.decorator';
import type { AccessPayload } from '../decorators/current-user.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { ErrorCode } from '../errors/error-codes';

// RBAC guard (P2.7). Runs AFTER JwtAuthGuard (registration order in
// AuthModule), which puts the access-token payload on request.user.
// Deny by default:
// - route without @Roles() and without @Public() -> 403 (must be declared,
//   enforced by the route-scan test);
// - active role not in the declared list -> 403;
// - route with @AdminGroups() (P2.10) additionally requires one of those
//   admin_* rows in user_roles, read from the DB so revocation is immediate.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const user = context.switchToHttp().getRequest().user as AccessPayload | undefined;

    // Role check. `undefined` metadata means the route never declared who may
    // call it — fail closed instead of letting it slip through.
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles === undefined) {
      throw new ForbiddenException({
        code: ErrorCode.Forbidden,
        message: 'Endpoint chưa khai báo vai trò được phép truy cập.',
      });
    }
    if (roles.length > 0 && (!user?.role || !roles.includes(user.role as Role))) {
      throw new ForbiddenException({
        code: ErrorCode.Forbidden,
        message: 'Vai trò hiện tại không có quyền truy cập chức năng này.',
      });
    }

    // Admin group check (P2.10), on top of the role check above.
    const adminGroups = this.reflector.getAllAndOverride<string[] | undefined>(ADMIN_GROUPS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (adminGroups !== undefined && adminGroups.length > 0) {
      if (!user) {
        throw new ForbiddenException({
          code: ErrorCode.Forbidden,
          message: 'Yêu cầu quyền admin.',
        });
      }
      const count = await this.prisma.userRole.count({
        where: { userId: user.sub, role: { in: adminGroups } },
      });
      if (count === 0) {
        throw new ForbiddenException({
          code: ErrorCode.Forbidden,
          message: 'Nhóm quyền admin của bạn không đủ để thực hiện chức năng này.',
        });
      }
    }

    return true;
  }
}
