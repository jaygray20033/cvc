import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../app.module';
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
    // Reset auth counters so per-IP lockouts never leak between tests.
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
});
