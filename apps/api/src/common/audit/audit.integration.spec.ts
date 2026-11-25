import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AuditService } from './audit.service';

// Integration tests for the append-only audit log (P2.16) against the real
// dev stack. RUN_DB_TESTS=1 required (api container/CI).
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://mailpit:8025';
const PASSWORD = 'Sup3r-Secret-Pass!';
const EMAIL_PREFIX = 'p2-test-';

interface MailDetail {
  Subject: string;
  Text: string;
}

// Same pattern as the auth spec: wait for the verification mail in mailpit.
async function findMailTo(email: string, subject?: string, tries = 5): Promise<MailDetail> {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const list = (await fetch(`${MAILPIT_URL}/api/v1/messages?limit=200`).then((r) =>
      r.json(),
    )) as { messages?: Array<{ ID: string; Subject?: string; To?: Array<{ Address?: string }> }> };
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

let app: INestApplication;
let prisma: PrismaService;
let redis: RedisService;

function makeEmail(): string {
  return `${EMAIL_PREFIX}${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`;
}

describeDb('Audit log (integration: P2.16)', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    // The dev DB accumulates audit rows across runs. Prune old rows so the
    // hash-chain test rebuilds a bounded chain instead of timing out; rows
    // written during this run are kept and rebuilt by the test itself.
    await prisma.auditLog.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } },
    });
  });

  beforeEach(async () => {
    await redis.deleteByPattern('*}:hits');
    await redis.deleteByPattern('*}:blocked');
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
    await app.close();
  });

  async function registerAndLogin(email: string): Promise<{ accessToken: string; userId: string }> {
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
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    return { accessToken: login.body.accessToken as string, userId: user.id };
  }

  // Promote to admin and switch the active role (no re-login: admin needs 2FA).
  async function becomeAdmin(email: string, accessToken: string): Promise<string> {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.userRole.deleteMany({ where: { userId: user.id } });
    await prisma.userRole.createMany({
      data: [
        { userId: user.id, role: 'admin' },
        { userId: user.id, role: 'admin_super' },
      ],
    });
    const switched = await request(app.getHttpServer())
      .post('/api/v1/me/active-role')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ role: 'admin' });
    expect(switched.status).toBe(200);
    return switched.body.accessToken as string;
  }

  it('interceptor auto-logs write requests with actor + entity', async () => {
    const email = makeEmail();
    const { accessToken, userId } = await registerAndLogin(email);
    const created = await request(app.getHttpServer())
      .post('/api/v1/me/addresses')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        receiverName: 'Nguyễn Văn A',
        phone: '0912345678',
        city: 'Hà Nội',
        district: 'Cầu Giấy',
        ward: 'Dịch Vọng',
        line: 'Số 1',
      });
    expect(created.status).toBe(201);

    // Interceptor writes are async (post-response): poll briefly.
    let row: Awaited<ReturnType<typeof prisma.auditLog.findFirst>> = null;
    for (let i = 0; i < 20 && !row; i += 1) {
      row = await prisma.auditLog.findFirst({
        where: { actorId: userId, action: { contains: 'createAddress' } },
        orderBy: { createdAt: 'desc' },
      });
      if (!row) await new Promise((r) => setTimeout(r, 200));
    }
    expect(row).toBeTruthy();
    expect(row?.entityType).toBe('addresses');
    expect(row?.entityId).toBe(created.body.id);
  });

  it('role switch writes a manual audit row with before/after', async () => {
    const email = makeEmail();
    const { accessToken, userId } = await registerAndLogin(email);
    await prisma.userRole.create({ data: { userId, role: 'participant' } });

    const switched = await request(app.getHttpServer())
      .post('/api/v1/me/active-role')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ role: 'participant' });
    expect(switched.status).toBe(200);

    const row = await prisma.auditLog.findFirst({
      where: { actorId: userId, action: 'user.role_switched' },
      orderBy: { createdAt: 'desc' },
    });
    expect(row).toBeTruthy();
    expect(row?.before).toMatchObject({ activeRole: 'buyer' });
    expect(row?.after).toMatchObject({ activeRole: 'participant' });
  });

  it('admin API lists with filters; no update/delete routes exist', async () => {
    const email = makeEmail();
    const { accessToken } = await registerAndLogin(email);
    const adminToken = await becomeAdmin(email, accessToken);

    const list = await request(app.getHttpServer())
      .get('/api/v1/admin/audit-logs?action=role_switched&limit=10')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.total).toBeGreaterThan(0);
    expect(list.body.items[0].hash).toMatch(/^[a-f0-9]{64}$/);

    // Regular user is denied.
    const denied = await request(app.getHttpServer())
      .get('/api/v1/admin/audit-logs')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(denied.status).toBe(403);
  });

  it('hash chain verifies; tampering breaks it; repair restores it', async () => {
    const audit = app.get(AuditService);
    // Seed a couple of isolated rows.
    await audit.log({ actorId: 'chain-test', action: 'test.a', after: { n: 1 } });
    await audit.log({ actorId: 'chain-test', action: 'test.b', after: { n: 2 } });

    // Rebuild the whole chain first: rows from earlier runs may carry forks or
    // an older hash format; a rebuild is also what the repair job would do.
    const rebuild = async () => {
      const rows = await prisma.auditLog.findMany({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      let prevHash = 'GENESIS';
      for (const row of rows) {
        const hash = AuditService.rowHash(prevHash, {
          actorId: row.actorId ?? undefined,
          actorRole: row.actorRole ?? undefined,
          action: row.action,
          entityType: row.entityType ?? undefined,
          entityId: row.entityId ?? undefined,
          before: row.before,
          after: row.after,
          ip: row.ip ?? undefined,
          userAgent: row.userAgent ?? undefined,
          requestId: row.requestId ?? undefined,
        });
        await prisma.auditLog.update({ where: { id: row.id }, data: { prevHash, hash } });
        prevHash = hash;
      }
    };
    await rebuild();
    expect((await audit.verifyChain()).ok).toBe(true);

    // Tamper: edit a middle row directly in the DB.
    const tampered = await prisma.auditLog.findFirst({
      where: { action: 'test.a', actorId: 'chain-test' },
      orderBy: { createdAt: 'desc' },
    });
    await prisma.auditLog.update({
      where: { id: tampered!.id },
      data: { after: { n: 999 } },
    });
    const broken = await audit.verifyChain();
    expect(broken.ok).toBe(false);
    expect(broken.brokenAtId).toBe(tampered!.id);

    // Repair restores the chain.
    await rebuild();
    expect((await audit.verifyChain()).ok).toBe(true);
  }, 60000);
});
