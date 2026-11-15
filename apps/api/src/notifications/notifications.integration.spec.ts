import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { NotificationsService } from './notifications.service';

// Integration tests for the notification engine (P2.18): channels, opt-outs,
// mandatory events, read state, IDOR. RUN_DB_TESTS=1 required.
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
async function findMailTo(email: string, tries = 5): Promise<MailDetail> {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const list = (await fetch(`${MAILPIT_URL}/api/v1/messages?limit=200`).then((r) =>
      r.json(),
    )) as { messages?: Array<{ ID: string; To?: Array<{ Address?: string }> }> };
    for (const message of list.messages ?? []) {
      const to = (message.To ?? []).map((item) => item.Address ?? '').join(',');
      if (to === email) {
        const detail = (await fetch(`${MAILPIT_URL}/api/v1/message/${message.ID}`).then((r) =>
          r.json(),
        )) as MailDetail;
        return detail;
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

let app: INestApplication;
let prisma: PrismaService;
let redis: RedisService;
let notifications: NotificationsService;

function makeEmail(): string {
  return `${EMAIL_PREFIX}${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`;
}

interface MailSummary {
  ID: string;
  Subject?: string;
  To?: Array<{ Address?: string }>;
}

async function countMails(email: string, subjectIncludes: string): Promise<number> {
  // Small wait so async sends land, then count matches.
  await new Promise((resolve) => setTimeout(resolve, 500));
  const list = (await fetch(`${MAILPIT_URL}/api/v1/messages?limit=200`).then((r) => r.json())) as {
    messages?: MailSummary[];
  };
  return (list.messages ?? []).filter(
    (m) =>
      (m.To ?? []).some((t) => t.Address === email) && (m.Subject ?? '').includes(subjectIncludes),
  ).length;
}

describeDb('Notifications (integration: P2.18)', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    notifications = app.get(NotificationsService);
    await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
  });

  beforeEach(async () => {
    await redis.deleteByPattern('*}:hits');
    await redis.deleteByPattern('*}:blocked');
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function registerAndLogin(email: string): Promise<{ token: string; userId: string }> {
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
    return { token: login.body.accessToken as string, userId: user.id };
  }

  it('emit delivers in-app + email by default (dev mailpit)', async () => {
    const email = makeEmail();
    const { userId } = await registerAndLogin(email);

    await notifications.emit('kyc.status_changed', userId, {
      status: 'REJECTED',
      reason: 'Ảnh không rõ',
    });

    const row = await prisma.notification.findFirstOrThrow({
      where: { userId, event: 'kyc.status_changed' },
      orderBy: { createdAt: 'desc' },
    });
    expect(row.title).toContain('chưa được duyệt');
    expect(row.readAt).toBeNull();
    expect(await countMails(email, 'KYC')).toBeGreaterThanOrEqual(1);
  });

  it('disabling the email channel stops emails for normal events', async () => {
    const email = makeEmail();
    const { token, userId } = await registerAndLogin(email);

    const updated = await request(app.getHttpServer())
      .put('/api/v1/me/notification-preferences')
      .set(auth(token))
      .send({ email: false });
    expect(updated.status).toBe(200);
    expect(updated.body.email).toBe(false);

    await notifications.emit('kyc.status_changed', userId, { status: 'APPROVED' });
    const row = await prisma.notification.findFirstOrThrow({
      where: { userId, event: 'kyc.status_changed', title: { contains: 'được duyệt' } },
    });
    expect(row).toBeTruthy();
    expect(await countMails(email, 'KYC')).toBe(0);
  });

  it('mandatory security events ignore the opt-out', async () => {
    const email = makeEmail();
    const { userId } = await registerAndLogin(email);
    await notifications.updatePreferences(userId, { email: false, inApp: false });

    await notifications.emit('security.password_changed', userId);

    // Mandatory: email still sent even though email:false.
    expect(await countMails(email, 'Mật khẩu')).toBeGreaterThanOrEqual(1);
  });

  it('read endpoints mark notifications and clear unreadCount', async () => {
    const email = makeEmail();
    const { token, userId } = await registerAndLogin(email);
    await notifications.emit('kyc.status_changed', userId, { status: 'PENDING' });

    const list = await request(app.getHttpServer()).get('/api/v1/notifications').set(auth(token));
    expect(list.status).toBe(200);
    expect(list.body.unreadCount).toBeGreaterThan(0);
    const notificationId = list.body.items[0].id as string;

    const read = await request(app.getHttpServer())
      .post(`/api/v1/notifications/${notificationId}/read`)
      .set(auth(token));
    expect(read.status).toBe(200);
    const row = await prisma.notification.findUniqueOrThrow({ where: { id: notificationId } });
    expect(row.readAt).not.toBeNull();

    await notifications.emit('kyc.status_changed', userId, { status: 'PENDING' });
    const readAll = await request(app.getHttpServer())
      .post('/api/v1/notifications/read-all')
      .set(auth(token));
    expect(readAll.status).toBe(200);
    const after = await request(app.getHttpServer()).get('/api/v1/notifications').set(auth(token));
    expect(after.body.unreadCount).toBe(0);
  });

  it('user B cannot read user A notification (IDOR -> 404)', async () => {
    const emailA = makeEmail();
    const { userId: userIdA } = await registerAndLogin(emailA);
    await notifications.emit('kyc.status_changed', userIdA, { status: 'PENDING' });
    const rowA = await prisma.notification.findFirstOrThrow({ where: { userId: userIdA } });

    const emailB = makeEmail();
    const { token: tokenB } = await registerAndLogin(emailB);
    const res = await request(app.getHttpServer())
      .post(`/api/v1/notifications/${rowA.id}/read`)
      .set(auth(tokenB));
    expect(res.status).toBe(404);
  });
});
