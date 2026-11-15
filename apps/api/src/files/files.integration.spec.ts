import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

// Integration tests for the shared file service (P2.17) against the real dev
// stack (SeaweedFS S3). RUN_DB_TESTS=1 required.
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

function makeEmail(): string {
  return `${EMAIL_PREFIX}${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`;
}

// Minimal valid-JPEG-looking bytes (magic passes; sharp may fail on the body,
// which is a tolerated non-fatal thumbnail error).
const JPEG_BYTES = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x01, 0x02, 0x03]),
  Buffer.alloc(256, 0x11),
]);

describeDb('Files API (integration: P2.17)', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
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

  async function uploadValid(token: string): Promise<string> {
    const presign = await request(app.getHttpServer())
      .post('/api/v1/files/presign')
      .set(auth(token))
      .send({ purpose: 'general', mime: 'image/jpeg', sizeBytes: JPEG_BYTES.length });
    expect(presign.status).toBe(200);
    const put = await fetch(presign.body.uploadUrl as string, {
      method: 'PUT',
      body: JPEG_BYTES,
      headers: { 'Content-Type': 'image/jpeg' },
    });
    expect(put.status).toBe(200);
    const confirm = await request(app.getHttpServer())
      .post(`/api/v1/files/${presign.body.fileId}/confirm`)
      .set(auth(token));
    expect(confirm.status).toBe(200);
    return presign.body.fileId as string;
  }

  it('rejects oversize at presign (per-type limit)', async () => {
    const token = await registerAndLogin(makeEmail());
    const res = await request(app.getHttpServer())
      .post('/api/v1/files/presign')
      .set(auth(token))
      .send({ mime: 'image/jpeg', sizeBytes: 6 * 1024 * 1024 });
    expect(res.status).toBe(400);
    const pdf = await request(app.getHttpServer())
      .post('/api/v1/files/presign')
      .set(auth(token))
      .send({ mime: 'application/pdf', sizeBytes: 11 * 1024 * 1024 });
    expect(pdf.status).toBe(400);
  });

  it('rejects content that does not match the declared MIME', async () => {
    const token = await registerAndLogin(makeEmail());
    const presign = await request(app.getHttpServer())
      .post('/api/v1/files/presign')
      .set(auth(token))
      .send({ mime: 'image/jpeg', sizeBytes: 64 });
    const put = await fetch(presign.body.uploadUrl as string, {
      method: 'PUT',
      body: Buffer.from('plain text pretending to be a jpeg'),
      headers: { 'Content-Type': 'image/jpeg' },
    });
    expect(put.status).toBe(200);
    const confirm = await request(app.getHttpServer())
      .post(`/api/v1/files/${presign.body.fileId}/confirm`)
      .set(auth(token));
    expect(confirm.status).toBe(400);
    const row = await prisma.fileObject.findUniqueOrThrow({
      where: { id: presign.body.fileId as string },
    });
    expect(row.status).toBe('REJECTED');
  });

  it('confirm -> scan completes -> download works; not-scanned blocks download', async () => {
    const email = makeEmail();
    const token = await registerAndLogin(email);
    const fileId = await uploadValid(token);

    // Wait for the async scan to finish (local fallback, no ClamAV in dev).
    let row = await prisma.fileObject.findUniqueOrThrow({ where: { id: fileId } });
    for (let i = 0; i < 20 && row.scanStatus === 'PENDING'; i += 1) {
      await new Promise((r) => setTimeout(r, 300));
      row = await prisma.fileObject.findUniqueOrThrow({ where: { id: fileId } });
    }
    expect(row.scanStatus).toBe('CLEAN');
    expect(row.detectedMime).toBe('image/jpeg');

    const meta = await request(app.getHttpServer()).get(`/api/v1/files/${fileId}`).set(auth(token));
    expect(meta.status).toBe(200);
    expect(meta.body.mime).toBe('image/jpeg');

    const download = await request(app.getHttpServer())
      .get(`/api/v1/files/${fileId}/download`)
      .set(auth(token));
    expect(download.status).toBe(200);
    expect(download.body.url).toContain('X-Amz-');
  });

  it('PENDING scan status blocks download until clean', async () => {
    const email = makeEmail();
    const token = await registerAndLogin(email);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const file = await prisma.fileObject.create({
      data: {
        ownerType: 'user',
        ownerId: user.id,
        bucket: 'cvc-private',
        s3Key: 'files/test/pending-block.jpg',
        declaredMime: 'image/jpeg',
        sizeBytes: 10,
        status: 'READY',
        scanStatus: 'PENDING',
      },
    });
    const res = await request(app.getHttpServer())
      .get(`/api/v1/files/${file.id}/download`)
      .set(auth(token));
    expect(res.status).toBe(403);
  });

  it('cross-user access is 404 (IDOR)', async () => {
    const tokenA = await registerAndLogin(makeEmail());
    const fileId = await uploadValid(tokenA);

    const tokenB = await registerAndLogin(makeEmail());
    const meta = await request(app.getHttpServer())
      .get(`/api/v1/files/${fileId}`)
      .set(auth(tokenB));
    expect(meta.status).toBe(404);
    const download = await request(app.getHttpServer())
      .get(`/api/v1/files/${fileId}/download`)
      .set(auth(tokenB));
    expect(download.status).toBe(404);
  });
});
