import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../app.module';
import { mountJobBoard } from '../job-board';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { DistributedLockService } from './distributed-lock.service';
import { DEAD_LETTER_QUEUE } from './queue.constants';
import { QueueService } from './queue.service';

// Integration tests for the BullMQ layer (P2.19) against the dev stack:
// retries with backoff, dead-letter, idempotent enqueue, distributed lock,
// the admin jobs API and the bull-board UI guard. RUN_DB_TESTS=1 required.
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

const PASSWORD = 'Sup3r-Secret-Pass!';
const EMAIL_PREFIX = 'p2-test-';

let app: INestApplication;
let prisma: PrismaService;
let redis: RedisService;
let queues: QueueService;
let lock: DistributedLockService;

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

describeDb('Queue layer (integration: P2.19)', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    // Mount before init so the express middleware sits in front of the Nest
    // router (only main.ts does this in the real server).
    mountJobBoard(app);
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    queues = app.get(QueueService);
    lock = app.get(DistributedLockService);
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

  // Promote to admin + switch active role (admin password login needs 2FA).
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
      .set(auth(accessToken))
      .send({ role: 'admin' });
    expect(switched.status).toBe(200);
    return switched.body.accessToken as string;
  }

  it('retries a failing job with backoff then archives it in the dead-letter queue', async () => {
    const jobId = `dlq-test-${Date.now()}`;
    await queues.enqueue(
      'payments',
      'test.fail',
      { marker: jobId },
      {
        jobId,
        attempts: 2,
        backoff: { type: 'fixed', delay: 300 },
      },
    );

    // Wait for both attempts (0.3s backoff) plus worker scheduling slack.
    let entry: { data?: { jobId?: unknown } } | undefined;
    for (let i = 0; i < 30 && !entry; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      const jobs = await queues.getQueue(DEAD_LETTER_QUEUE).getWaiting(0, 100);
      entry = jobs.find((job) => (job.data as { jobId?: unknown }).jobId === jobId);
    }
    expect(entry).toBeTruthy();

    // Original job attempts: exactly the configured 2.
    const original = await queues.getQueue('payments').getJob(jobId);
    expect(original?.attemptsMade).toBe(2);
  }, 30000);

  it('enqueueIdempotent deduplicates the same jobId (10 replays -> one run)', async () => {
    const marker = `idem-enq-${Date.now()}`;
    const id = `count-job-${marker}`;
    const ids = await Promise.all(
      Array.from({ length: 10 }, () =>
        queues.enqueueIdempotent('payments', 'test.count', { marker }, id),
      ),
    );
    expect(new Set(ids).size).toBe(1);

    // Handler counts its runs in Redis; a duplicate enqueue must not add one.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const runs = await redis.count(`qtest:count:${marker}`);
    expect(runs).toBe(1);
    await redis.del(`qtest:count:${marker}`);
  }, 20000);

  it('distributed lock grants one holder and re-arms after release', async () => {
    const key = `lock-test-${Date.now()}`;
    const first = await lock.acquire(key, 5000);
    expect(first).toBeTruthy();
    const second = await lock.acquire(key, 5000);
    expect(second).toBeNull();

    await lock.release(key, first as string);
    const third = await lock.acquire(key, 5000);
    expect(third).toBeTruthy();
  });

  it('notification.deliver job goes through the full emit path', async () => {
    const email = makeEmail();
    const token = await registerAndLogin(email);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });

    await queues.enqueue('notifications', 'notification.deliver', {
      event: 'kyc.status_changed',
      userId: user.id,
      data: { status: 'PENDING' },
    });

    let row = null;
    for (let i = 0; i < 20 && !row; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      row = await prisma.notification.findFirst({
        where: { userId: user.id, event: 'kyc.status_changed' },
      });
    }
    expect(row).toBeTruthy();
    void token;
  }, 20000);

  it('admin jobs API lists queues, dead-letter and supports retry', async () => {
    const email = makeEmail();
    const userToken = await registerAndLogin(email);
    const adminToken = await becomeAdmin(email, userToken);

    const overview = await request(app.getHttpServer())
      .get('/api/v1/admin/jobs')
      .set(auth(adminToken));
    expect(overview.status).toBe(200);
    expect(overview.body.deadLetter.queue).toBe('dead-letter');
    expect(overview.body.items.map((i: { queue: string }) => i.queue)).toContain('notifications');

    const dlq = await request(app.getHttpServer())
      .get('/api/v1/admin/jobs/dead-letter?limit=50')
      .set(auth(adminToken));
    expect(dlq.status).toBe(200);
    expect(dlq.body.items.length).toBeGreaterThan(0);
    expect(dlq.body.items[0].error).toBeTruthy();

    // Retry endpoint on a dead job (it fails again, but must be accepted).
    const [deadJob] = await queues.getQueue('payments').getFailed(0, 0);
    if (deadJob) {
      const retry = await request(app.getHttpServer())
        .post(`/api/v1/admin/jobs/payments/${deadJob.id}/retry`)
        .set(auth(adminToken));
      expect([200, 400]).toContain(retry.status);
    }

    const denied = await request(app.getHttpServer())
      .get('/api/v1/admin/jobs')
      .set(auth(userToken));
    expect(denied.status).toBe(403);
  });

  it('bull-board UI is guarded: 401 without token, 403 non-admin, 200 admin', async () => {
    const email = makeEmail();
    const userToken = await registerAndLogin(email);
    const adminToken = await becomeAdmin(email, userToken);

    const anonymous = await request(app.getHttpServer()).get('/api/v1/admin/queues');
    expect(anonymous.status).toBe(401);

    const user = await request(app.getHttpServer())
      .get('/api/v1/admin/queues')
      .set(auth(userToken));
    expect(user.status).toBe(403);

    const admin = await request(app.getHttpServer())
      .get('/api/v1/admin/queues')
      .set(auth(adminToken));
    expect(admin.status).toBe(200);
    expect(admin.text).toContain('Bull');
  });

  it('unknown queue in admin API is 404', async () => {
    const email = makeEmail();
    const adminToken = await becomeAdmin(email, await registerAndLogin(email));
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/jobs/not-a-queue/failed')
      .set(auth(adminToken));
    expect(res.status).toBe(404);
  });
});
