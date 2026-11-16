import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

// Integration tests for the Idempotency-Key interceptor (P2.21): parallel
// duplicates create exactly one record, replays return the stored response,
// the same key with a different body is 422. RUN_DB_TESTS=1 required.
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

const PASSWORD = 'Sup3r-Secret-Pass!';
const EMAIL_PREFIX = 'p2-test-';

let app: INestApplication;
let prisma: PrismaService;
let redis: RedisService;

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

describeDb('Idempotency (integration: P2.21)', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
  });

  beforeEach(async () => {
    await redis.deleteByPattern('*}:hits');
    await redis.deleteByPattern('*}:blocked');
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
    await app.close();
  });

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

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('10 parallel POSTs with one key create exactly one record', async () => {
    const token = await registerAndLogin(makeEmail());
    const marker = `idem-marker-${Date.now()}`;
    const key = `idem-key-${marker}`;
    const body = {
      receiverName: 'Nguyễn Văn A',
      phone: '0912345678',
      city: 'Hà Nội',
      district: 'Cầu Giấy',
      ward: 'Dịch Vọng',
      line: marker,
    };

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app.getHttpServer())
          .post('/api/v1/me/addresses')
          .set(auth(token))
          .set('Idempotency-Key', key)
          .send(body),
      ),
    );

    // Exactly one stored address for the marker.
    const created = await prisma.address.count({ where: { line: marker } });
    expect(created).toBe(1);

    // Every response either replays the stored body or reports in-flight.
    const ids = new Set(
      responses
        .filter((r) => r.status !== 409)
        .map((r) => (r.body as { id?: string }).id ?? 'unknown'),
    );
    expect(ids.size).toBe(1);
    expect(responses.every((r) => [201, 200, 409].includes(r.status))).toBe(true);
  }, 30000);

  it('replaying after completion returns the stored response without a new record', async () => {
    const token = await registerAndLogin(makeEmail());
    const marker = `replay-${Date.now()}`;
    const body = {
      receiverName: 'Trần Thị B',
      phone: '0912345679',
      city: 'Hà Nội',
      district: 'Cầu Giấy',
      ward: 'Dịch Vọng',
      line: marker,
    };

    const first = await request(app.getHttpServer())
      .post('/api/v1/me/addresses')
      .set(auth(token))
      .set('Idempotency-Key', `key-${marker}`)
      .send(body);
    expect(first.status).toBe(201);

    const second = await request(app.getHttpServer())
      .post('/api/v1/me/addresses')
      .set(auth(token))
      .set('Idempotency-Key', `key-${marker}`)
      .send(body);
    expect(second.status).toBe(first.status);
    expect(second.body.id).toBe(first.body.id);
    expect(await prisma.address.count({ where: { line: marker } })).toBe(1);
  }, 20000);

  it('same key with a different body is 422', async () => {
    const token = await registerAndLogin(makeEmail());
    const marker = `conflict-${Date.now()}`;
    const base = {
      receiverName: 'Lê Văn C',
      phone: '0912345670',
      city: 'Hà Nội',
      district: 'Cầu Giấy',
      ward: 'Dịch Vọng',
      line: marker,
    };

    const first = await request(app.getHttpServer())
      .post('/api/v1/me/addresses')
      .set(auth(token))
      .set('Idempotency-Key', `key-${marker}`)
      .send(base);
    expect(first.status).toBe(201);

    const replay = await request(app.getHttpServer())
      .post('/api/v1/me/addresses')
      .set(auth(token))
      .set('Idempotency-Key', `key-${marker}`)
      .send({ ...base, line: `${marker}-changed` });
    expect(replay.status).toBe(422);
  }, 20000);

  it('POST without an Idempotency-Key behaves normally (two records)', async () => {
    const token = await registerAndLogin(makeEmail());
    const marker = `nokey-${Date.now()}`;
    const body = {
      receiverName: 'Phạm Văn D',
      phone: '0912345671',
      city: 'Hà Nội',
      district: 'Cầu Giấy',
      ward: 'Dịch Vọng',
      line: marker,
    };
    await request(app.getHttpServer()).post('/api/v1/me/addresses').set(auth(token)).send(body);
    await request(app.getHttpServer()).post('/api/v1/me/addresses').set(auth(token)).send(body);
    expect(await prisma.address.count({ where: { line: marker } })).toBe(2);
  }, 20000);
});
