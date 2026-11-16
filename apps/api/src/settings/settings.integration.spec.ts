import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { SystemSettingsService } from './system-settings.service';

// Integration tests for runtime settings (P2.22): per-key validation, cache
// invalidation, admin_super write restriction, audit-based history.
// RUN_DB_TESTS=1 required.
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

const PASSWORD = 'Sup3r-Secret-Pass!';
const EMAIL_PREFIX = 'p2-test-';

let app: INestApplication;
let prisma: PrismaService;
let redis: RedisService;
let settings: SystemSettingsService;

function makeEmail(): string {
  return `${EMAIL_PREFIX}${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`;
}

interface MailDetail {
  Subject: string;
  Text: string;
}

async function findMailTo(email: string, tries = 5): Promise<MailDetail> {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const list = (await fetch('http://mailpit:8025/api/v1/messages?limit=200').then((r) =>
      r.json(),
    )) as {
      messages?: Array<{ ID: string; To?: Array<{ Address?: string }> }>;
    };
    for (const message of list.messages ?? []) {
      const to = (message.To ?? []).map((item) => item.Address ?? '').join(',');
      if (to === email) {
        return (await fetch(`http://mailpit:8025/api/v1/message/${message.ID}`).then((r) =>
          r.json(),
        )) as MailDetail;
      }
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

describeDb('System settings (integration: P2.22)', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    settings = app.get(SystemSettingsService);
  });

  beforeEach(async () => {
    await redis.deleteByPattern('*}:hits');
    await redis.deleteByPattern('*}:blocked');
  });

  afterAll(async () => {
    // Restore any setting this suite may have changed (DB row + 30s cache).
    const keys = ['kyc.slaHours', 'files.maxImageMb'];
    await prisma.systemSetting.deleteMany({ where: { key: { in: keys } } });
    await Promise.all(keys.map((key) => redis.del(`setting:${key}`)));
    await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function registerAndLogin(email: string): Promise<string> {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD });
    const mail = await findMailTo(email);
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: extractToken(mail) });
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD });
    expect(login.status).toBe(200);
    return login.body.accessToken as string;
  }

  // Promote and switch the active role without re-login (2FA on admin).
  async function promote(email: string, accessToken: string, roles: string[]): Promise<string> {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.userRole.deleteMany({ where: { userId: user.id } });
    await prisma.userRole.createMany({ data: roles.map((role) => ({ userId: user.id, role })) });
    const switched = await request(app.getHttpServer())
      .post('/api/v1/me/active-role')
      .set(auth(accessToken))
      .send({ role: 'admin' });
    expect(switched.status).toBe(200);
    return switched.body.accessToken as string;
  }

  it('defaults are served before any row exists; list merges both', async () => {
    const email = makeEmail();
    const adminToken = await promote(email, await registerAndLogin(email), [
      'admin',
      'admin_super',
    ]);

    const list = await request(app.getHttpServer())
      .get('/api/v1/admin/system-settings')
      .set(auth(adminToken));
    expect(list.status).toBe(200);
    const sla = (list.body as Array<{ key: string; value: unknown }>).find(
      (s) => s.key === 'kyc.slaHours',
    );
    expect(sla?.value).toBe(48);

    const one = await request(app.getHttpServer())
      .get('/api/v1/admin/system-settings/kyc.slaHours')
      .set(auth(adminToken));
    expect(one.status).toBe(200);
    expect(one.body.value).toBe(48);
  });

  it('only admin_super can write; invalid values are rejected with the schema details', async () => {
    const emailSuper = makeEmail();
    const superToken = await promote(emailSuper, await registerAndLogin(emailSuper), [
      'admin',
      'admin_super',
    ]);
    const emailOps = makeEmail();
    const opsToken = await promote(emailOps, await registerAndLogin(emailOps), [
      'admin',
      'admin_ops',
    ]);

    // admin_ops can read...
    const read = await request(app.getHttpServer())
      .get('/api/v1/admin/system-settings')
      .set(auth(opsToken));
    expect(read.status).toBe(200);
    // ...but not write.
    const write = await request(app.getHttpServer())
      .put('/api/v1/admin/system-settings/files.maxImageMb')
      .set(auth(opsToken))
      .send({ value: 2 });
    expect(write.status).toBe(403);

    // Invalid value -> 400 with zod details.
    const bad = await request(app.getHttpServer())
      .put('/api/v1/admin/system-settings/files.maxImageMb')
      .set(auth(superToken))
      .send({ value: 0 });
    expect(bad.status).toBe(400);

    // Unknown key -> 400.
    const unknown = await request(app.getHttpServer())
      .put('/api/v1/admin/system-settings/not.a.key')
      .set(auth(superToken))
      .send({ value: 1 });
    expect(unknown.status).toBe(400);
  });

  it('writing a setting takes effect immediately (cache invalidation) and is audited', async () => {
    const email = makeEmail();
    const superToken = await promote(email, await registerAndLogin(email), [
      'admin',
      'admin_super',
    ]);

    const put = await request(app.getHttpServer())
      .put('/api/v1/admin/system-settings/files.maxImageMb')
      .set(auth(superToken))
      .send({ value: 7 });
    expect(put.status).toBe(200);
    expect(put.body.version).toBeGreaterThanOrEqual(1);

    // Read through the API: new value, no stale cache.
    const one = await request(app.getHttpServer())
      .get('/api/v1/admin/system-settings/files.maxImageMb')
      .set(auth(superToken));
    expect(one.body.value).toBe(7);

    // History written to the audit log.
    const history = await request(app.getHttpServer())
      .get('/api/v1/admin/system-settings/files.maxImageMb/history')
      .set(auth(superToken));
    expect(history.status).toBe(200);
    expect(history.body.length).toBeGreaterThanOrEqual(1);
    expect(history.body[0].after.value).toBe(7);

    // Service-level get also reflects the new value.
    expect(await settings.get<number>('files.maxImageMb')).toBe(7);
  });

  it('changing kyc.slaHours propagates to the user-facing SLA endpoint', async () => {
    const email = makeEmail();
    const superToken = await promote(email, await registerAndLogin(email), [
      'admin',
      'admin_super',
    ]);

    const put = await request(app.getHttpServer())
      .put('/api/v1/admin/system-settings/kyc.slaHours')
      .set(auth(superToken))
      .send({ value: 24 });
    expect(put.status).toBe(200);

    const sla = await request(app.getHttpServer()).get('/api/v1/me/kyc/sla').set(auth(superToken));
    expect(sla.body.slaHours).toBe(24);
  });
});
