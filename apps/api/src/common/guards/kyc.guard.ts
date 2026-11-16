import type { KycLevel } from '@cvc/shared';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { PrismaService } from '../../prisma/prisma.service';
import { SystemSettingsService } from '../../settings/system-settings.service';
import type { AccessPayload } from '../decorators/current-user.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { REQUIRE_KYC_KEY } from '../decorators/require-kyc.decorator';
import { ErrorCode } from '../errors/error-codes';

// KYC gate (P2.15). Runs after JwtAuthGuard + RolesGuard. Denies money/
// participation actions until the account is verified. Only acts on routes
// that opt in with @RequireKyc(level); everything else passes untouched.
@Injectable()
export class KycGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly settings: SystemSettingsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const level = this.reflector.getAllAndOverride<KycLevel | undefined>(REQUIRE_KYC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!level) return true; // route did not opt in

    const user = context.switchToHttp().getRequest().user as AccessPayload | undefined;
    if (!user?.sub) {
      throw new ForbiddenException({
        code: ErrorCode.KycRequired,
        message: 'Vui lòng đăng nhập và xác minh danh tính trước khi thao tác.',
      });
    }

    // BASIC: at least one APPROVED KYC submission.
    const approved = await this.prisma.kycSubmission.count({
      where: { userId: user.sub, status: 'APPROVED' },
    });
    if (approved === 0) {
      throw new ForbiddenException({
        code: ErrorCode.KycRequired,
        message: 'Bạn cần xác minh danh tính (KYC) và được duyệt trước khi thực hiện thao tác này.',
        details: { requiredLevel: level, slaHours: await this.slaHours() },
      });
    }

    // FULL: also needs a bank account on file (money can leave the account).
    if (level === 'FULL') {
      const banks = await this.prisma.bankAccount.count({ where: { userId: user.sub } });
      if (banks === 0) {
        throw new ForbiddenException({
          code: ErrorCode.KycRequired,
          message: 'Bạn cần thêm tài khoản ngân hàng trùng tên hồ sơ trước khi thao tác này.',
          details: { requiredLevel: level },
        });
      }
    }

    return true;
  }

  private async slaHours(): Promise<number> {
    // Runtime setting (P2.22) with schema default 48h.
    return this.settings.get<number>('kyc.slaHours');
  }
}
