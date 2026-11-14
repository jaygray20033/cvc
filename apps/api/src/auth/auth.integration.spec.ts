import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Secret, TOTP } from 'otpauth';
import request from 'supertest';

import { AppModule } from '../app.module';
import { MeService } from '../me/me.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { TokenService } from './token.service';

// Integration tests against the real dev stack (MySQL + Redis + Mailpit).
// They only run where the stack is reachable: RUN_DB_TESTS=1 (api container/CI).
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://mailpit:8025';
const PASSWORD = 'Sup3r-Secret-Pass!';
const EMAIL_PREFIX = 'p2-test-';

let app: INestApplication;
let prisma: PrismaService;
let redis: RedisService;
let tokens: TokenService;

// Unique mailbox per test run; prefix makes cleanup trivial.
function makeEmail(): string {
  return `${EMAIL_PREFIX}${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`;
}

interface MailDetail {
  Subject: string;
  Text: string;
}

async function findMailTo(email: string, subject?: string, tries = 5): Promise<MailDetail> {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    // List and filter client-side for deterministic matching.
    const list = (await fetch(`${MAILPIT_URL}/api/v1/messages?limit=200`).then((r) =>
      r.json(),
    )) as {
      messages?: Array<{ ID: string; Subject?: string; To?: Array<{ Address?: string }> }>;
    };
    for (const message of list.messages ?? []) {
      const to = (message.To ?? []).map((item) => item.Address ?? '').join(',');
      if (to !== email) continue;
      if (subject && !(message.Subject ?? '').toLowerCase().includes(subject.toLowerCase()))
        continue;
      const detail = (await fetch(`${MAILPIT_URL}/api/v1/message/${message.ID}`).then((r) =>
        r.json(),
      )) as MailDetail;
      return detail;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`No mail received for ${email}`);
}

function extractToken(mail: MailDetail): string {
  const match = /token=([a-f0-9]{64})/.exec(mail.Text);
  if (!match) throw new Error('No token found in email body');
  return match[1];
}

function extractOtp(mail: MailDetail): string {
  const match = /(\d{6})/.exec(mail.Text);
  if (!match) throw new Error('No OTP code found in email body');
  return match[1];
}

describeDb('Auth API (integration: P2.1–P2.4)', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    tokens = app.get(TokenService);
    await cleanup();
  });

  beforeEach(async () => {
    // Reset auth counters AND throttler buckets (storage keys are sha256-hashed
    // `{<hash>:<name>}:hits|blocked`) so limits never leak between tests.
    await clearThrottlerBuckets();
    await redis.deleteByPattern('auth:*');
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  async function cleanup(): Promise<void> {
    await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
    await prisma.otpRequest.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
    await redis.deleteByPattern('auth:*');
    await clearThrottlerBuckets();
  }

  // Throttler storage keys are `{<sha256>:<name>}:hits` / `:blocked` — no fixed
  // prefix, so match on the shape instead of a namespace.
  async function clearThrottlerBuckets(): Promise<void> {
    await redis.deleteByPattern('*}:hits');
    await redis.deleteByPattern('*}:blocked');
  }

  // Registers and verifies a fresh account, returns login tokens.
  async function registerAndLogin(
    email: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const registerRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD });
    expect(registerRes.status).toBe(200);
    const mail = await findMailTo(email);
    const verifyRes = await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: extractToken(mail) });
    expect(verifyRes.status).toBe(200);
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD });
    expect(loginRes.status).toBe(200);
    return { accessToken: loginRes.body.accessToken, refreshToken: loginRes.body.refreshToken };
  }

  // ------------------------------------------------------------- P2.1 flows

  describe('P2.1 register / verify-email / login', () => {
    it('register → verification email → verify → login (full DoD flow)', async () => {
      const email = makeEmail();

      // Unverified login is rejected.
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: PASSWORD });
      const early = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD });
      expect(early.status).toBe(403);
      expect(early.body.code).toBe('AUTH_EMAIL_NOT_VERIFIED');

      const mail = await findMailTo(email, 'xác minh');
      expect(mail.Subject.toLowerCase()).toContain('xác minh');
      const verify = await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .send({ token: extractToken(mail) });
      expect(verify.status).toBe(200);

      // Token is one-time: second use fails.
      const replay = await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .send({ token: extractToken(mail) });
      expect(replay.status).toBe(400);
      expect(replay.body.code).toBe('AUTH_TOKEN_INVALID');

      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD });
      expect(login.status).toBe(200);
      expect(login.body.accessToken).toEqual(expect.any(String));
      expect(login.body.refreshToken).toEqual(expect.any(String));
      expect(login.body.user.email).toBe(email);
    });

    it('duplicate email is rejected', async () => {
      const email = makeEmail();
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: PASSWORD });
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: PASSWORD });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('AUTH_EMAIL_TAKEN');
    });

    it('wrong password fails without leaking account existence', async () => {
      const email = makeEmail();
      await registerAndLogin(email);
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'Wrong-Password-1!' });
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Email hoặc mật khẩu không đúng.');
      // Same generic message for an account that does not exist at all.
      const unknown = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: makeEmail(), password: 'Wrong-Password-1!' });
      expect(unknown.body.message).toBe(res.body.message);
    });

    it('expired verification token is rejected', async () => {
      const email = makeEmail();
      const user = await prisma.user.create({
        data: { email, passwordHash: 'x', status: 'PENDING_VERIFICATION' },
      });
      const knownToken = 'a'.repeat(64);
      await prisma.verificationToken.create({
        data: {
          userId: user.id,
          type: 'EMAIL_VERIFY',
          tokenHash: tokens.hashToken(knownToken),
          expiresAt: new Date(Date.now() - 60_000),
        },
      });
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .send({ token: knownToken });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('AUTH_TOKEN_EXPIRED');
    });
  });

  // ------------------------------------------------------------- P2.2 flows

  describe('P2.2 email OTP login', () => {
    it('request → code arrives by email → verify issues a session; wrong code rejected', async () => {
      const email = makeEmail();
      await registerAndLogin(email);

      const otp = await request(app.getHttpServer())
        .post('/api/v1/auth/otp/request')
        .send({ email });
      expect(otp.status).toBe(200);
      expect(otp.body.message).toContain('Nếu email hợp lệ');

      const wrong = await request(app.getHttpServer())
        .post('/api/v1/auth/otp/verify')
        .send({ email, code: '000000' });
      expect(wrong.status).toBe(400);
      expect(wrong.body.code).toBe('AUTH_OTP_INVALID');

      const code = extractOtp(await findMailTo(email, 'OTP'));
      const verify = await request(app.getHttpServer())
        .post('/api/v1/auth/otp/verify')
        .send({ email, code });
      expect(verify.status).toBe(200);
      expect(verify.body.accessToken).toEqual(expect.any(String));
    });

    it('OTP expires after the configured TTL', async () => {
      const email = makeEmail();
      await registerAndLogin(email);
      await request(app.getHttpServer()).post('/api/v1/auth/otp/request').send({ email });
      const code = extractOtp(await findMailTo(email, 'OTP'));

      await prisma.otpRequest.updateMany({
        where: { email },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/otp/verify')
        .send({ email, code });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('hết hạn');
    });

    it('unknown email gets the same generic response (no enumeration) and no mail is sent', async () => {
      const email = makeEmail();
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/otp/request')
        .send({ email });
      const known = await request(app.getHttpServer())
        .post('/api/v1/auth/otp/request')
        .send({ email: makeEmail() });
      expect(res.body.message).toBe(known.body.message);
      expect(res.status).toBe(200);
      const unknown = await fetch(`${MAILPIT_URL}/api/v1/messages?limit=200`).then((r) => r.json());
      const sentToUnknown = (
        unknown as {
          messages?: Array<{ To?: Array<{ Address?: string }> }>;
        }
      ).messages?.some((m) => (m.To ?? []).some((t) => t.Address === email));
      expect(sentToUnknown).toBeFalsy();
    });

    it('send limit: capped requests per email, then 429', async () => {
      const email = makeEmail();
      await registerAndLogin(email);
      for (let i = 0; i < 3; i += 1) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/otp/request')
          .send({ email });
        expect(res.status).toBe(200);
      }
      const blocked = await request(app.getHttpServer())
        .post('/api/v1/auth/otp/request')
        .send({ email });
      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe('AUTH_RATE_LIMITED');
    });

    it('too many wrong attempts invalidate the OTP', async () => {
      const email = makeEmail();
      await registerAndLogin(email);
      await request(app.getHttpServer()).post('/api/v1/auth/otp/request').send({ email });
      const code = extractOtp(await findMailTo(email, 'OTP'));

      for (let i = 0; i < 5; i += 1) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/otp/verify')
          .send({ email, code: '999999' });
        expect(res.status).toBe(400);
      }
      // Correct code no longer works after max attempts.
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/otp/verify')
        .send({ email, code });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('AUTH_OTP_INVALID');
    });
  });

  // ------------------------------------------------------------- P2.3 flows

  describe('P2.3 forgot / reset / change password', () => {
    it('forgot-password does not reveal whether the email exists', async () => {
      const unknown = await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email: makeEmail() });
      const email = makeEmail();
      await registerAndLogin(email);
      const known = await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email });
      expect(unknown.status).toBe(200);
      expect(known.body.message).toBe(unknown.body.message);
    });

    it('reset with the emailed token sets a new password and revokes sessions', async () => {
      const email = makeEmail();
      const { refreshToken: oldRefresh } = await registerAndLogin(email);

      await request(app.getHttpServer()).post('/api/v1/auth/forgot-password').send({ email });
      const token = extractToken(await findMailTo(email, 'Đặt lại'));

      // Too-short password rejected by validation/policy.
      const weak = await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: '1234567' });
      expect(weak.status).toBe(400);

      const reset = await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: 'Brand-New-Pass-99!' });
      expect(reset.status).toBe(200);

      // Token is single-use.
      const replay = await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: 'Another-New-Pass-99!' });
      expect(replay.status).toBe(400);
      expect(replay.body.code).toBe('AUTH_RESET_TOKEN_INVALID');

      // All sessions were revoked by the reset.
      const oldRefreshRes = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: oldRefresh });
      expect(oldRefreshRes.status).toBe(401);

      // Old password no longer works; new one does.
      const oldLogin = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD });
      expect(oldLogin.status).toBe(401);
      const newLogin = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'Brand-New-Pass-99!' });
      expect(newLogin.status).toBe(200);
      // Password-changed notice was emailed.
      await findMailTo(email, 'thay đổi');
    });

    it('expired reset token is rejected', async () => {
      const email = makeEmail();
      const user = await prisma.user.create({
        data: { email, passwordHash: 'x', status: 'ACTIVE', emailVerifiedAt: new Date() },
      });
      const knownToken = 'b'.repeat(64);
      await prisma.verificationToken.create({
        data: {
          userId: user.id,
          type: 'PASSWORD_RESET',
          tokenHash: tokens.hashToken(knownToken),
          expiresAt: new Date(Date.now() - 60_000),
        },
      });
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token: knownToken, newPassword: 'Brand-New-Pass-99!' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('AUTH_RESET_TOKEN_INVALID');
    });

    it('change-password verifies the current password, then revokes all sessions', async () => {
      const email = makeEmail();
      const { accessToken, refreshToken: oldRefresh } = await registerAndLogin(email);

      const wrongCurrent = await request(app.getHttpServer())
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ currentPassword: 'Wrong-Current-1!', newPassword: 'Changed-Pass-777!' });
      expect(wrongCurrent.status).toBe(401);

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ currentPassword: PASSWORD, newPassword: 'Changed-Pass-777!' });
      expect(res.status).toBe(200);

      // Every session revoked → refresh dead; notice email sent.
      const refresh = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: oldRefresh });
      expect(refresh.status).toBe(401);
      const sessions = await request(app.getHttpServer())
        .get('/api/v1/auth/sessions')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(sessions.status).toBe(200);
      expect(sessions.body).toHaveLength(0);
    });

    it('temporary lockout after repeated failures (account + IP)', async () => {
      const email = makeEmail();
      await registerAndLogin(email);

      for (let i = 0; i < 5; i += 1) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email, password: 'Nope-Nope-123!' });
        expect(res.status).toBe(401);
      }
      // 6th attempt (even with the correct password) is locked.
      const locked = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD });
      expect(locked.status).toBe(429);
      expect(locked.body.code).toBe('AUTH_LOCKED');
      expect(locked.body.message).toContain('phút');
    });
  });

  // ------------------------------------------------------------- P2.4 flows

  describe('P2.4 JWT, refresh rotation and sessions', () => {
    it('refresh rotates the token; reusing the old one revokes the whole chain', async () => {
      const email = makeEmail();
      const { refreshToken } = await registerAndLogin(email);

      const first = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken });
      expect(first.status).toBe(200);
      expect(first.body.refreshToken).not.toBe(refreshToken);

      // Reuse of the already-rotated token → 401 + family revoked.
      const reuse = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken });
      expect(reuse.status).toBe(401);
      expect(reuse.body.code).toBe('AUTH_REFRESH_REUSED');

      // The rotated token from the revoked chain is now dead too.
      const rotated = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first.body.refreshToken });
      expect(rotated.status).toBe(401);
    });

    it('garbage or tampered refresh tokens are rejected', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'not-a-real-refresh-token-value-1234567890' });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('AUTH_TOKEN_INVALID');
    });

    it('lists active sessions with device info and revokes one by id', async () => {
      const email = makeEmail();
      const { accessToken: tokenA, refreshToken: refreshA } = await registerAndLogin(email);
      const loginB = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('User-Agent', 'CVC-Test/1.0')
        .send({ email, password: PASSWORD });
      const tokenB = loginB.body.accessToken as string;
      const refreshB = loginB.body.refreshToken as string;
      void tokenB;

      const list = await request(app.getHttpServer())
        .get('/api/v1/auth/sessions')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(2);
      expect(list.body.filter((s: { isCurrent: boolean }) => s.isCurrent)).toHaveLength(1);
      // The session created with an explicit UA stores it.
      const withUa = list.body.find((s: { userAgent: string | null }) =>
        s.userAgent?.includes('CVC-Test'),
      );
      expect(withUa).toBeTruthy();

      // Revoke the *other* session (the one behind refreshB) by id.
      const other = (list.body as Array<{ id: string; isCurrent: boolean }>).find(
        (s) => !s.isCurrent,
      )!.id;
      const revoke = await request(app.getHttpServer())
        .delete(`/api/v1/auth/sessions/${other}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(revoke.status).toBe(200);

      const afterRevoke = await request(app.getHttpServer())
        .get('/api/v1/auth/sessions')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(afterRevoke.body).toHaveLength(1);

      const revokedRefresh = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: refreshB });
      expect(revokedRefresh.status).toBe(401);

      // Current session still refreshes normally.
      const stillAlive = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: refreshA });
      expect(stillAlive.status).toBe(200);
    });

    it('logout revokes the current session', async () => {
      const email = makeEmail();
      const { accessToken, refreshToken } = await registerAndLogin(email);

      const logout = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ refreshToken });
      expect(logout.status).toBe(200);

      const refresh = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken });
      expect(refresh.status).toBe(401);
    });

    it('protected endpoints require a bearer token', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/auth/sessions');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });
  });

  // ------------------------------------------------------------- P2.5 TOTP 2FA

  // Computes the current 6-digit TOTP code the way a real authenticator
  // app would, from the base32 secret returned by /auth/2fa/setup.
  function totpCode(secretBase32: string): string {
    return new TOTP({
      issuer: 'CVC',
      label: 'test',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(secretBase32),
    }).generate();
  }

  // Replaces the account's roles with the given list (P2.9 semantics).
  async function promoteToRoles(email: string, roles: string[]): Promise<void> {
    const user = await prisma.user.findUnique({ where: { email } });
    await prisma.userRole.deleteMany({ where: { userId: user!.id } });
    await prisma.userRole.createMany({
      data: roles.map((role) => ({ userId: user!.id, role })),
    });
  }

  // OTP login for users who cannot password-login (no 2FA yet, or challenge
  // flow active). Returns bootstrap session tokens.
  async function loginViaOtp(
    email: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    await request(app.getHttpServer()).post('/api/v1/auth/otp/request').send({ email });
    const mail = await findMailTo(email, 'otp');
    const verify = await request(app.getHttpServer())
      .post('/api/v1/auth/otp/verify')
      .send({ email, code: extractOtp(mail) });
    expect(verify.status).toBe(200);
    expect(verify.body.twoFactorRequired).toBeUndefined();
    return { accessToken: verify.body.accessToken, refreshToken: verify.body.refreshToken };
  }

  // Registers, verifies, promotes to the given roles, then OTP-logins.
  async function createRoleUser(roles: string[]): Promise<{ email: string; accessToken: string }> {
    const email = makeEmail();
    const registerRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD });
    expect(registerRes.status).toBe(200);
    const mail = await findMailTo(email);
    const verifyRes = await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: extractToken(mail) });
    expect(verifyRes.status).toBe(200);
    await promoteToRoles(email, roles);
    const tokens = await loginViaOtp(email);
    return { email, accessToken: tokens.accessToken };
  }

  // Takes a user through setup → enable, returning the TOTP secret and the
  // recovery codes.
  async function enable2fa(
    email: string,
    accessToken: string,
  ): Promise<{ secret: string; recoveryCodes: string[] }> {
    const setup = await request(app.getHttpServer())
      .post('/api/v1/auth/2fa/setup')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(setup.status).toBe(200);
    expect(setup.body.secret).toMatch(/^[A-Z2-7]+=*$/);
    expect(setup.body.otpauthUri).toContain('otpauth://totp/');

    const enable = await request(app.getHttpServer())
      .post('/api/v1/auth/2fa/enable')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: totpCode(setup.body.secret) });
    expect(enable.status).toBe(200);
    expect(enable.body.recoveryCodes).toHaveLength(10);
    return { secret: setup.body.secret, recoveryCodes: enable.body.recoveryCodes };
  }

  describe('P2.5 TOTP 2FA', () => {
    it('admin without 2FA is blocked from password login but can OTP-login to bootstrap', async () => {
      const { email } = await createRoleUser(['admin']);

      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD });
      expect(login.status).toBe(403);
      expect(login.body.code).toBe('AUTH_2FA_REQUIRED');
    });

    it('full lifecycle: enable → password login challenges → TOTP verify → session', async () => {
      const { email, accessToken } = await createRoleUser(['admin']);
      const { secret } = await enable2fa(email, accessToken);

      // Password login now returns the two-factor challenge, not 403.
      const challenge = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD });
      expect(challenge.status).toBe(200);
      expect(challenge.body.twoFactorRequired).toBe(true);
      expect(challenge.body.pendingToken).toBeTruthy();
      expect(challenge.body.accessToken).toBeUndefined();

      // Wrong code (computed from a different secret) → 400 AUTH_2FA_INVALID.
      const wrong = await request(app.getHttpServer())
        .post('/api/v1/auth/2fa/verify')
        .send({
          pendingToken: challenge.body.pendingToken,
          code: totpCode('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'),
        });
      expect(wrong.status).toBe(400);
      expect(wrong.body.code).toBe('AUTH_2FA_INVALID');

      // Correct code → real session that works on protected routes.
      const ok = await request(app.getHttpServer())
        .post('/api/v1/auth/2fa/verify')
        .send({ pendingToken: challenge.body.pendingToken, code: totpCode(secret) });
      expect(ok.status).toBe(200);
      expect(ok.body.accessToken).toBeTruthy();
      const sessions = await request(app.getHttpServer())
        .get('/api/v1/auth/sessions')
        .set('Authorization', `Bearer ${ok.body.accessToken}`);
      expect(sessions.status).toBe(200);
    });

    it('recovery codes are single-use', async () => {
      const { email, accessToken } = await createRoleUser(['admin']);
      const { recoveryCodes } = await enable2fa(email, accessToken);

      // First use works.
      const challenge = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD });
      const first = await request(app.getHttpServer())
        .post('/api/v1/auth/2fa/verify')
        .send({ pendingToken: challenge.body.pendingToken, code: recoveryCodes[0] });
      expect(first.status).toBe(200);

      // Same code again fails; another code from the set works once.
      const challenge2 = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD });
      const reuse = await request(app.getHttpServer())
        .post('/api/v1/auth/2fa/verify')
        .send({ pendingToken: challenge2.body.pendingToken, code: recoveryCodes[0] });
      expect(reuse.status).toBe(400);
      expect(reuse.body.code).toBe('AUTH_2FA_INVALID');
      const second = await request(app.getHttpServer())
        .post('/api/v1/auth/2fa/verify')
        .send({ pendingToken: challenge2.body.pendingToken, code: recoveryCodes[1] });
      expect(second.status).toBe(200);
    });

    it('expired or garbage pendingToken is rejected', async () => {
      const { email, accessToken } = await createRoleUser(['admin']);
      await enable2fa(email, accessToken);
      const user = await prisma.user.findUnique({ where: { email } });
      const userId = user!.id;

      const garbage = await request(app.getHttpServer())
        .post('/api/v1/auth/2fa/verify')
        .send({ pendingToken: 'not-a-real-pending-token-value-123456', code: '123456' });
      expect(garbage.status).toBe(400);
      expect(garbage.body.code).toBe('AUTH_TOKEN_INVALID');

      const expiredToken = tokens.createMfaToken(userId, '1s');
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const expired = await request(app.getHttpServer())
        .post('/api/v1/auth/2fa/verify')
        .send({ pendingToken: expiredToken, code: '123456' });
      expect(expired.status).toBe(400);
      expect(expired.body.code).toBe('AUTH_TOKEN_EXPIRED');
    });

    it('disable requires the correct password and removes recovery codes', async () => {
      const email = makeEmail();
      const { accessToken } = await registerAndLogin(email); // buyer: no 2FA mandate
      await enable2fa(email, accessToken);

      const wrong = await request(app.getHttpServer())
        .post('/api/v1/auth/2fa/disable')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ password: 'Wrong-Password-1!' });
      expect(wrong.status).toBe(401);

      const ok = await request(app.getHttpServer())
        .post('/api/v1/auth/2fa/disable')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ password: PASSWORD });
      expect(ok.status).toBe(200);

      const user = await prisma.user.findUnique({ where: { email } });
      expect(user!.totpEnabledAt).toBeNull();
      expect(user!.totpSecret).toBeNull();
      expect(await prisma.recoveryCode.count({ where: { userId: user!.id } })).toBe(0);
    });

    it('setup is rejected when 2FA is already enabled; enable rejects bad/second codes', async () => {
      const { email, accessToken } = await createRoleUser(['admin']);
      await enable2fa(email, accessToken);

      const setupAgain = await request(app.getHttpServer())
        .post('/api/v1/auth/2fa/setup')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(setupAgain.status).toBe(409);
      expect(setupAgain.body.code).toBe('AUTH_2FA_ALREADY_ENABLED');

      const enableAgain = await request(app.getHttpServer())
        .post('/api/v1/auth/2fa/enable')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ code: '123456' });
      expect(enableAgain.status).toBe(409);
      expect(enableAgain.body.code).toBe('AUTH_2FA_ALREADY_ENABLED');
    });

    it('non-2FA buyer password login is unaffected (no challenge)', async () => {
      const email = makeEmail();
      await registerAndLogin(email);
      const second = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD });
      expect(second.status).toBe(200);
      expect(second.body.twoFactorRequired).toBeUndefined();
      expect(second.body.accessToken).toBeTruthy();
      expect(second.body.user.email).toBe(email);
    });
  });

  // ------------------------------------------------------------ P2.6 rate limit

  describe('P2.6 rate limiting', () => {
    it('login returns 429 with Retry-After and code RATE_LIMITED past the limit', async () => {
      const email = makeEmail();
      const { accessToken } = await registerAndLogin(email); // counts as attempt #1
      expect(accessToken).toBeTruthy();

      // auth-login limit is 15/min: attempts #2..#15 must all succeed.
      for (let i = 0; i < 14; i += 1) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email, password: PASSWORD });
        expect(res.status).toBe(200);
      }

      const throttled = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD });
      expect(throttled.status).toBe(429);
      expect(throttled.headers['retry-after']).toBeDefined();
      expect(throttled.body.code).toBe('RATE_LIMITED');
    }, 30_000);

    it('health probes are not throttled', async () => {
      for (let i = 0; i < 20; i += 1) {
        const res = await request(app.getHttpServer()).get('/health');
        expect(res.status).toBe(200);
      }
    });
  });

  // ---------------------------------------------- P2.7/P2.8/P2.9 authorization

  describe('P2.8 record ownership (anti-IDOR)', () => {
    it("user A gets 404 when revoking user B's session; B's session keeps working", async () => {
      const emailA = makeEmail();
      const emailB = makeEmail();
      const tokensA = await registerAndLogin(emailA);
      const tokensB = await registerAndLogin(emailB);

      const sessionsB = await request(app.getHttpServer())
        .get('/api/v1/auth/sessions')
        .set('Authorization', `Bearer ${tokensB.accessToken}`);
      const sessionBId = sessionsB.body[0].id as string;

      // A tries to revoke B's session: 404, never 403 (no existence leak).
      const cross = await request(app.getHttpServer())
        .delete(`/api/v1/auth/sessions/${sessionBId}`)
        .set('Authorization', `Bearer ${tokensA.accessToken}`);
      expect(cross.status).toBe(404);

      // B's session is untouched.
      const stillOk = await request(app.getHttpServer())
        .get('/api/v1/auth/sessions')
        .set('Authorization', `Bearer ${tokensB.accessToken}`);
      expect(stillOk.status).toBe(200);

      // A's own list never contains B's session.
      const sessionsA = await request(app.getHttpServer())
        .get('/api/v1/auth/sessions')
        .set('Authorization', `Bearer ${tokensA.accessToken}`);
      expect(sessionsA.body.map((s: { id: string }) => s.id)).not.toContain(sessionBId);
    });
  });

  describe('P2.9 multi-role /me + active-role', () => {
    it('GET /me returns the account roles and the active one', async () => {
      const email = makeEmail();
      await registerAndLogin(email);
      await promoteToRoles(email, ['participant', 'retailer']);

      // Session was created before promotion: activeRole stays buyer until
      // the user switches (roles are read from the session's activeRole).
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD });
      const { accessToken } = login.body;
      const me = await request(app.getHttpServer())
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(me.status).toBe(200);
      expect(me.body.email).toBe(email);
      expect(me.body.roles).toEqual(['participant', 'retailer']);
      expect(me.body.activeRole).toBe('participant'); // first assigned role
    });

    it('switching active role re-issues the token without re-login and keeps it on refresh', async () => {
      const email = makeEmail();
      await registerAndLogin(email);
      await promoteToRoles(email, ['participant', 'retailer']);
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD });
      const { accessToken, refreshToken } = login.body;

      // Audit trail (P2.9): the switch must be logged (AuditLog in P2.16).
      const meService = app.get(MeService);
      const warnSpy = jest.spyOn(meService['logger'], 'warn');

      const switched = await request(app.getHttpServer())
        .post('/api/v1/me/active-role')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ role: 'retailer' });
      expect(switched.status).toBe(200);
      expect(switched.body.activeRole).toBe('retailer');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'role_switched', from: 'participant', to: 'retailer' }),
        'active role switched',
      );

      // The session row keeps the role in use.
      const decoded = JSON.parse(
        Buffer.from(switched.body.accessToken.split('.')[1], 'base64url').toString(),
      ) as { role: string; sid: string };
      expect(decoded.role).toBe('retailer');
      const session = await prisma.session.findUnique({ where: { id: decoded.sid } });
      expect(session?.activeRole).toBe('retailer');

      // ...is accepted on protected routes...
      const me = await request(app.getHttpServer())
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${switched.body.accessToken}`);
      expect(me.status).toBe(200);
      expect(me.body.activeRole).toBe('retailer');

      // ...and survives a refresh rotation.
      const refresh = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken });
      expect(refresh.status).toBe(200);
      const refreshedPayload = JSON.parse(
        Buffer.from(refresh.body.accessToken.split('.')[1], 'base64url').toString(),
      ) as { role: string };
      expect(refreshedPayload.role).toBe('retailer');
    });

    it('rejects switching to a role the account does not hold', async () => {
      const email = makeEmail();
      const { accessToken } = await registerAndLogin(email); // buyer only
      const res = await request(app.getHttpServer())
        .post('/api/v1/me/active-role')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ role: 'admin' });
      expect(res.status).toBe(400);
    });
  });
});
