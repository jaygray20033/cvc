import { randomBytes, randomInt } from 'node:crypto';
import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { User } from '@prisma/client';

import { MailService } from '../common/mail/mail.service';
import {
  otpHtml,
  otpText,
  passwordChangedHtml,
  passwordChangedText,
  resetPasswordHtml,
  resetPasswordText,
  verifyEmailHtml,
  verifyEmailText,
} from '../common/mail/mail.templates';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AUTH_LIMITS, AuthErrorCode, type RequestMeta } from './auth.constants';
import type {
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  LogoutInput,
  OtpRequestInput,
  OtpVerifyInput,
  RegisterInput,
  ResetPasswordInput,
  VerifyEmailInput,
} from './auth.dto';
import { PasswordService } from './password.service';
import { type AccessPayload, type RefreshPayload, TokenService } from './token.service';

interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

interface PublicUser {
  id: string;
  email: string;
  status: User['status'];
  emailVerifiedAt: Date | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly mail: MailService,
    private readonly tokens: TokenService,
    private readonly passwords: PasswordService,
    private readonly config: ConfigService,
  ) {}

  // ---------------------------------------------------------------- register

  async register(input: RegisterInput): Promise<{ message: string }> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new ConflictException({
        code: AuthErrorCode.EmailTaken,
        message: 'Email đã được đăng ký.',
      });
    }

    const passwordHash = await this.passwords.hashPassword(input.password);
    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        phone: input.phone,
        status: 'PENDING_VERIFICATION',
      },
    });

    await this.sendVerificationEmail(user.id, user.email);
    return { message: 'Đăng ký thành công. Vui lòng kiểm tra email để xác minh tài khoản.' };
  }

  async verifyEmail(input: VerifyEmailInput): Promise<{ message: string }> {
    const row = await this.prisma.verificationToken.findUnique({
      where: { tokenHash: this.tokens.hashToken(input.token) },
      include: { user: true },
    });
    if (!row || row.type !== 'EMAIL_VERIFY' || row.usedAt) {
      throw new BadRequestException({
        code: AuthErrorCode.TokenInvalid,
        message: 'Đường dẫn xác minh không hợp lệ hoặc đã được sử dụng.',
      });
    }
    if (row.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException({
        code: AuthErrorCode.TokenExpired,
        message: 'Đường dẫn xác minh đã hết hạn. Vui lòng đăng nhập để nhận email mới.',
      });
    }
    if (row.user.status === 'DISABLED') {
      throw new ForbiddenException({
        code: AuthErrorCode.AccountDisabled,
        message: 'Tài khoản đã bị khóa.',
      });
    }

    await this.prisma.$transaction([
      this.prisma.verificationToken.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: row.userId },
        data: {
          emailVerifiedAt: row.user.emailVerifiedAt ?? new Date(),
          status: 'ACTIVE',
        },
      }),
    ]);
    return { message: 'Email đã được xác minh. Bạn có thể đăng nhập.' };
  }

  // ------------------------------------------------------------------- login

  async login(input: LoginInput, meta: RequestMeta): Promise<SessionTokens & { user: PublicUser }> {
    await this.throwIfLocked(`auth:login:fail:email:${input.email}`, 'tài khoản');
    await this.throwIfLocked(`auth:login:fail:ip:${meta.ip ?? 'unknown'}`, 'IP');

    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const passwordOk =
      user?.passwordHash != null &&
      (await this.passwords.verifyPassword(user.passwordHash, input.password));
    if (!user || !passwordOk) {
      // Count failures for the attempted account too, so nonexistent accounts
      // cannot be brute-forced infinitely either.
      await this.countLoginFailure(input.email, meta.ip);
      throw new UnauthorizedException({
        code: AuthErrorCode.InvalidCredentials,
        message: 'Email hoặc mật khẩu không đúng.',
      });
    }
    if (user.status === 'DISABLED') {
      throw new ForbiddenException({
        code: AuthErrorCode.AccountDisabled,
        message: 'Tài khoản đã bị khóa.',
      });
    }
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException({
        code: AuthErrorCode.EmailNotVerified,
        message: 'Email chưa được xác minh. Vui lòng kiểm tra hộp thư để xác minh tài khoản.',
      });
    }

    await this.redis.reset(`auth:login:fail:email:${input.email}`);
    await this.redis.reset(`auth:login:fail:ip:${meta.ip ?? 'unknown'}`);
    const session = await this.createSession(user, meta);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    return { ...session, user: toPublicUser(user) };
  }

  // ------------------------------------------------- email OTP login (P2.2)

  async otpRequest(input: OtpRequestInput, meta: RequestMeta): Promise<{ message: string }> {
    await this.assertSendLimit(
      [`auth:otp:send:email:${input.email}`, `auth:otp:send:ip:${meta.ip ?? 'unknown'}`],
      'otp',
    );

    const genericMessage = 'Nếu email hợp lệ, mã OTP đã được gửi. Vui lòng kiểm tra hộp thư.';
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!user || user.status === 'DISABLED') {
      // Identical response for unknown emails: no account enumeration.
      return { message: genericMessage };
    }

    // Never log the code. Only its SHA-256 hash is persisted.
    const code = randomInt(0, 10 ** AUTH_LIMITS.otpLength)
      .toString()
      .padStart(AUTH_LIMITS.otpLength, '0');
    await this.prisma.otpRequest.updateMany({
      where: { email: input.email, consumedAt: null },
      data: { consumedAt: new Date() }, // a new request supersedes older codes
    });
    await this.prisma.otpRequest.create({
      data: {
        email: input.email,
        codeHash: this.tokens.hashToken(code),
        expiresAt: new Date(Date.now() + AUTH_LIMITS.otpTtlMinutes * 60_000),
        ip: meta.ip,
      },
    });

    try {
      await this.mail.send({
        to: input.email,
        subject: 'CVC – Mã OTP đăng nhập',
        html: otpHtml(code, AUTH_LIMITS.otpTtlMinutes),
        text: otpText(code, AUTH_LIMITS.otpTtlMinutes),
      });
    } catch (error) {
      this.logger.error(
        { err: error instanceof Error ? error.message : String(error) },
        'otp email failed',
      );
      throw new HttpException(
        { code: 'INTERNAL_ERROR', message: 'Không gửi được email OTP. Vui lòng thử lại sau.' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return { message: genericMessage };
  }

  async otpVerify(
    input: OtpVerifyInput,
    meta: RequestMeta,
  ): Promise<SessionTokens & { user: PublicUser }> {
    const row = await this.prisma.otpRequest.findFirst({
      where: { email: input.email, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    const invalid = new BadRequestException({
      code: AuthErrorCode.OtpInvalid,
      message: 'Mã OTP không đúng hoặc đã hết hạn. Vui lòng yêu cầu mã mới.',
    });
    if (!row) throw invalid;
    if (row.expiresAt.getTime() < Date.now()) {
      await this.prisma.otpRequest.update({
        where: { id: row.id },
        data: { consumedAt: new Date() },
      });
      throw invalid;
    }
    if (row.attempts >= AUTH_LIMITS.otpMaxVerifyAttempts) {
      await this.prisma.otpRequest.update({
        where: { id: row.id },
        data: { consumedAt: new Date() },
      });
      throw invalid;
    }
    if (row.codeHash !== this.tokens.hashToken(input.code)) {
      await this.prisma.otpRequest.update({
        where: { id: row.id },
        data: { attempts: { increment: 1 } },
      });
      throw invalid;
    }

    await this.prisma.otpRequest.update({
      where: { id: row.id },
      data: { consumedAt: new Date() },
    });
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!user) throw invalid; // row existed for an email, account since deleted
    if (user.status === 'DISABLED') {
      throw new ForbiddenException({
        code: AuthErrorCode.AccountDisabled,
        message: 'Tài khoản đã bị khóa.',
      });
    }

    // OTP proves control of the mailbox: auto-verify accounts that registered
    // but never clicked the verification link.
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        status: user.status === 'PENDING_VERIFICATION' ? 'ACTIVE' : user.status,
        lastLoginAt: new Date(),
      },
    });

    const session = await this.createSession(updated, meta);
    return { ...session, user: toPublicUser(updated) };
  }

  // ------------------------------------------------- password flows (P2.3)

  async forgotPassword(
    input: ForgotPasswordInput,
    meta: RequestMeta,
  ): Promise<{ message: string }> {
    await this.assertSendLimit(
      [`auth:forgot:email:${input.email}`, `auth:forgot:ip:${meta.ip ?? 'unknown'}`],
      'forgot',
    );

    const genericMessage = 'Nếu email tồn tại, hướng dẫn đặt lại mật khẩu đã được gửi.';
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!user || user.status === 'DISABLED' || !user.passwordHash) {
      return { message: genericMessage }; // no enumeration
    }

    const token = randomBytes(32).toString('hex');
    await this.prisma.verificationToken.create({
      data: {
        userId: user.id,
        type: 'PASSWORD_RESET',
        tokenHash: this.tokens.hashToken(token),
        expiresAt: new Date(Date.now() + AUTH_LIMITS.resetTtlMinutes * 60_000),
      },
    });
    const resetUrl = `${this.appUrl()}/reset-password?token=${token}`;
    await this.mail.send({
      to: user.email,
      subject: 'CVC – Đặt lại mật khẩu',
      html: resetPasswordHtml(resetUrl, AUTH_LIMITS.resetTtlMinutes),
      text: resetPasswordText(resetUrl, AUTH_LIMITS.resetTtlMinutes),
    });
    return { message: genericMessage };
  }

  async resetPassword(input: ResetPasswordInput): Promise<{ message: string }> {
    await this.passwords.assertPolicy(input.newPassword);

    const row = await this.prisma.verificationToken.findUnique({
      where: { tokenHash: this.tokens.hashToken(input.token) },
      include: { user: true },
    });
    if (!row || row.type !== 'PASSWORD_RESET' || row.usedAt) {
      throw new BadRequestException({
        code: AuthErrorCode.ResetTokenInvalid,
        message: 'Đường dẫn đặt lại mật khẩu không hợp lệ hoặc đã được sử dụng.',
      });
    }
    if (row.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException({
        code: AuthErrorCode.ResetTokenInvalid,
        message: 'Đường dẫn đặt lại mật khẩu đã hết hạn. Vui lòng yêu cầu email mới.',
      });
    }
    if (row.user.status === 'DISABLED') {
      throw new ForbiddenException({
        code: AuthErrorCode.AccountDisabled,
        message: 'Tài khoản đã bị khóa.',
      });
    }

    const passwordHash = await this.passwords.hashPassword(input.newPassword);
    await this.prisma.$transaction([
      this.prisma.verificationToken.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: row.userId },
        data: {
          passwordHash,
          status: row.user.status === 'PENDING_VERIFICATION' ? 'ACTIVE' : row.user.status,
          emailVerifiedAt: row.user.emailVerifiedAt ?? new Date(),
        },
      }),
      // Reset/password change revokes every session of the account (P2.3).
      this.prisma.session.updateMany({
        where: { userId: row.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.sendPasswordChangedNotice(row.user.email);
    return { message: 'Đặt lại mật khẩu thành công. Vui lòng đăng nhập lại.' };
  }

  async changePassword(
    actor: AccessPayload,
    input: ChangePasswordInput,
  ): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: actor.sub } });
    if (!user)
      throw new UnauthorizedException({
        code: AuthErrorCode.InvalidCredentials,
        message: 'Tài khoản không tồn tại.',
      });
    if (!user.passwordHash) {
      throw new BadRequestException({
        code: AuthErrorCode.NoPassword,
        message: 'Tài khoản chưa đặt mật khẩu. Vui lòng dùng chức năng đặt lại mật khẩu.',
      });
    }
    if (!(await this.passwords.verifyPassword(user.passwordHash, input.currentPassword))) {
      await this.countLoginFailure(user.email, null);
      throw new UnauthorizedException({
        code: AuthErrorCode.InvalidCredentials,
        message: 'Mật khẩu hiện tại không đúng.',
      });
    }
    if (input.currentPassword === input.newPassword) {
      throw new BadRequestException({
        code: AuthErrorCode.PasswordPolicy,
        message: 'Mật khẩu mới phải khác mật khẩu hiện tại.',
      });
    }
    await this.passwords.assertPolicy(input.newPassword);

    const passwordHash = await this.passwords.hashPassword(input.newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash },
      }),
      // Revoke every session (including the current one, per P2.3 DoD).
      this.prisma.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.sendPasswordChangedNotice(user.email);
    return { message: 'Đổi mật khẩu thành công. Vui lòng đăng nhập lại.' };
  }

  // ------------------------------------------------- sessions & JWT (P2.4)

  async refresh(
    refreshToken: string,
    meta: RequestMeta,
  ): Promise<SessionTokens & { user: PublicUser }> {
    let payload: RefreshPayload;
    try {
      payload = this.tokens.verifyRefreshToken(refreshToken);
    } catch {
      throw new UnauthorizedException({
        code: AuthErrorCode.TokenInvalid,
        message: 'Phiên không hợp lệ. Vui lòng đăng nhập lại.',
      });
    }

    const tokenHash = this.tokens.hashToken(refreshToken);
    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException({
        code: AuthErrorCode.TokenInvalid,
        message: 'Phiên không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.',
      });
    }
    if (session.refreshHash !== tokenHash) {
      // Reuse of an already-rotated token: treat the chain as compromised and
      // revoke every session in the family (P2.4 DoD).
      await this.prisma.session.updateMany({
        where: { userId: session.userId, familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.logger.warn(
        { sessionId: session.id, userId: session.userId },
        'refresh token reuse detected, family revoked',
      );
      throw new UnauthorizedException({
        code: AuthErrorCode.RefreshReused,
        message: 'Phát hiện dùng lại refresh token. Toàn bộ phiên của thiết bị này đã bị thu hồi.',
      });
    }
    if (session.user.status === 'DISABLED') {
      throw new ForbiddenException({
        code: AuthErrorCode.AccountDisabled,
        message: 'Tài khoản đã bị khóa.',
      });
    }

    // Rotate: new refresh token becomes the only valid one for this session.
    const newRefreshToken = this.tokens.createRefreshToken(session.id, session.familyId);
    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        refreshHash: this.tokens.hashToken(newRefreshToken),
        lastUsedAt: new Date(),
        ip: meta.ip ?? session.ip,
        userAgent: meta.userAgent ?? session.userAgent,
      },
    });

    const accessToken = this.tokens.accessToken({
      sub: session.userId,
      email: session.user.email,
      sid: session.id,
    });
    return {
      accessToken,
      refreshToken: newRefreshToken,
      user: toPublicUser(session.user),
    };
  }

  async logout(actor: AccessPayload, input: LogoutInput): Promise<{ message: string }> {
    if (input.refreshToken) {
      try {
        const payload = this.tokens.verifyRefreshToken(input.refreshToken);
        const session = await this.prisma.session.findUnique({ where: { id: payload.sid } });
        if (session && session.userId === actor.sub) {
          await this.prisma.session.update({
            where: { id: session.id },
            data: { revokedAt: new Date() },
          });
        }
      } catch {
        // Unknown/invalid refresh token: the access-token session is still revoked below.
      }
    }
    await this.revokeById(actor.sub, actor.sid);
    return { message: 'Đăng xuất thành công.' };
  }

  async listSessions(actor: AccessPayload): Promise<
    Array<{
      id: string;
      ip: string | null;
      userAgent: string | null;
      lastUsedAt: Date;
      createdAt: Date;
      isCurrent: boolean;
    }>
  > {
    const sessions = await this.prisma.session.findMany({
      where: { userId: actor.sub, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      select: { id: true, ip: true, userAgent: true, lastUsedAt: true, createdAt: true },
    });
    return sessions.map((session) => ({ ...session, isCurrent: session.id === actor.sid }));
  }

  async revokeSession(actor: AccessPayload, sessionId: string): Promise<{ message: string }> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== actor.sub) {
      throw new NotFoundException({
        code: AuthErrorCode.SessionNotFound,
        message: 'Không tìm thấy phiên đăng nhập.',
      });
    }
    await this.revokeById(actor.sub, sessionId);
    return { message: 'Đã thu hồi phiên đăng nhập.' };
  }

  // ----------------------------------------------------------------- helpers

  private async createSession(user: User, meta: RequestMeta): Promise<SessionTokens> {
    const sessionId = randomUUID();
    const familyId = randomUUID();
    const refreshToken = this.tokens.createRefreshToken(sessionId, familyId);
    await this.prisma.session.create({
      data: {
        id: sessionId,
        userId: user.id,
        familyId,
        refreshHash: this.tokens.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + this.tokens.refreshTtlSeconds() * 1000),
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    const accessToken = this.tokens.accessToken({
      sub: user.id,
      email: user.email,
      sid: sessionId,
    });
    return { accessToken, refreshToken };
  }

  private async sendVerificationEmail(userId: string, email: string): Promise<void> {
    const token = randomBytes(32).toString('hex');
    await this.prisma.verificationToken.create({
      data: {
        userId,
        type: 'EMAIL_VERIFY',
        tokenHash: this.tokens.hashToken(token),
        expiresAt: new Date(Date.now() + AUTH_LIMITS.verifyEmailTtlHours * 3600_000),
      },
    });
    const verifyUrl = `${this.appUrl()}/verify-email?token=${token}`;
    await this.mail.send({
      to: email,
      subject: 'CVC – Xác minh email',
      html: verifyEmailHtml(verifyUrl, AUTH_LIMITS.verifyEmailTtlHours),
      text: verifyEmailText(verifyUrl, AUTH_LIMITS.verifyEmailTtlHours),
    });
  }

  private async sendPasswordChangedNotice(email: string): Promise<void> {
    await this.mail.send({
      to: email,
      subject: 'CVC – Mật khẩu của bạn đã được thay đổi',
      html: passwordChangedHtml(new Date().toISOString()),
      text: passwordChangedText(new Date().toISOString()),
    });
  }

  // 429 with the remaining lock window once failures exceed the limit.
  private async throwIfLocked(key: string, label: string): Promise<void> {
    const count = await this.redis.count(key);
    if (count >= AUTH_LIMITS.loginMaxFailures) {
      const ttl = await this.redis.ttl(key);
      const minutes =
        ttl > 0 ? Math.ceil(ttl / 60) : Math.ceil(AUTH_LIMITS.loginLockWindowSec / 60);
      throw new HttpException(
        {
          code: AuthErrorCode.Locked,
          message: `Đã nhập sai quá nhiều lần cho ${label}. Vui lòng thử lại sau ${minutes} phút.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async countLoginFailure(email: string, ip: string | null): Promise<void> {
    await this.redis.incrementWithTtl(
      `auth:login:fail:email:${email}`,
      AUTH_LIMITS.loginLockWindowSec,
    );
    if (ip) {
      await this.redis.incrementWithTtl(`auth:login:fail:ip:${ip}`, AUTH_LIMITS.loginLockWindowSec);
    }
  }

  // Send limit for OTP/forgot-password: throws 429 once any key exceeds its cap.
  private async assertSendLimit(keys: string[], scope: 'otp' | 'forgot'): Promise<void> {
    const limits: Array<{ cap: number; windowSec: number }> =
      scope === 'otp'
        ? [
            { cap: AUTH_LIMITS.otpSendsPerEmail, windowSec: AUTH_LIMITS.otpSendsPerEmailWindowSec },
            { cap: AUTH_LIMITS.otpSendsPerIp, windowSec: AUTH_LIMITS.otpSendsPerIpWindowSec },
          ]
        : [
            {
              cap: AUTH_LIMITS.forgotSendsPerEmail,
              windowSec: AUTH_LIMITS.forgotSendsPerEmailWindowSec,
            },
            { cap: AUTH_LIMITS.otpSendsPerIp, windowSec: AUTH_LIMITS.otpSendsPerIpWindowSec },
          ];

    for (const [index, key] of keys.entries()) {
      const { cap, windowSec } = limits[index] ?? limits[0]!;
      const count = await this.redis.incrementWithTtl(key, windowSec);
      if (count > cap) {
        const ttl = await this.redis.ttl(key);
        const minutes = ttl > 0 ? Math.ceil(ttl / 60) : Math.ceil(windowSec / 60);
        throw new HttpException(
          {
            code: AuthErrorCode.RateLimited,
            message: `Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau ${minutes} phút.`,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
  }

  private async revokeById(userId: string, sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private appUrl(): string {
    return this.config.get<string>('app.appUrl', 'http://localhost:5180');
  }
}

function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt,
  };
}
