import type { Role } from '@cvc/shared';
import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';

import { TokenService } from '../auth/token.service';
import type { AccessPayload } from '../common/decorators/current-user.decorator';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';

// Profile summary and multi-role handling (P2.9). A user may hold several
// roles (e.g. participant + retailer); one session has exactly one active
// role, carried in the access token and switchable without a new login.
@Injectable()
export class MeService {
  private readonly logger = new Logger(MeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  // GET /me: who am I, which roles do I hold, which one is active now.
  async getMe(user: AccessPayload): Promise<{
    id: string;
    email: string;
    status: string;
    emailVerifiedAt: Date | null;
    roles: string[];
    activeRole: string;
  }> {
    const [userRow, roleRows, session] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: user.sub },
        select: { id: true, email: true, status: true, emailVerifiedAt: true },
      }),
      this.prisma.userRole.findMany({
        where: { userId: user.sub },
        orderBy: { createdAt: 'asc' },
        select: { role: true },
      }),
      this.prisma.session.findUnique({
        where: { id: user.sid },
        select: { activeRole: true, revokedAt: true },
      }),
    ]);
    if (!userRow || !session || session.revokedAt) {
      throw new UnauthorizedException({
        code: ErrorCode.Unauthorized,
        message: 'Phiên không hợp lệ. Vui lòng đăng nhập lại.',
      });
    }
    return {
      ...userRow,
      roles: roleRows.map((row) => row.role),
      activeRole: session.activeRole,
    };
  }

  // POST /me/active-role: switch roles, re-issue the access token (no re-login
  // needed) and write an audit line (P2.9; the AuditLog table lands in P2.16).
  async switchActiveRole(
    user: AccessPayload,
    role: Role,
  ): Promise<{ accessToken: string; activeRole: string }> {
    const session = await this.prisma.session.findUnique({
      where: { id: user.sid },
      select: { id: true, userId: true, activeRole: true, revokedAt: true },
    });
    if (!session || session.revokedAt || session.userId !== user.sub) {
      throw new UnauthorizedException({
        code: ErrorCode.Unauthorized,
        message: 'Phiên không hợp lệ. Vui lòng đăng nhập lại.',
      });
    }
    const assigned = await this.prisma.userRole.findFirst({
      where: { userId: user.sub, role },
      select: { id: true },
    });
    if (!assigned) {
      throw new BadRequestException({
        code: ErrorCode.Forbidden,
        message: 'Tài khoản không có vai trò này.',
      });
    }

    // Idempotent: switching to the current role just re-issues the token.
    if (session.activeRole !== role) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { activeRole: role },
      });
      // Audit (no sensitive data). Kept in logs until P2.16 adds AuditLog.
      this.logger.warn(
        {
          event: 'role_switched',
          userId: user.sub,
          sessionId: session.id,
          from: session.activeRole,
          to: role,
        },
        'active role switched',
      );
    }
    return {
      accessToken: this.tokens.accessToken({
        sub: user.sub,
        email: user.email,
        sid: user.sid,
        role,
      }),
      activeRole: role,
    };
  }
}
