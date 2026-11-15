import { Controller, Get, Module } from '@nestjs/common';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../app.module';
import { RequireKyc } from '../common/decorators/require-kyc.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

// Integration tests for P2.14 (manual photo identity review: portrait, photo +
// salted-CCCD duplicate detection, admin eye-match checklist, SLA, view log)
// and P2.15 (@RequireKyc gate). Only run against the real dev stack:
// RUN_DB_TESTS=1.

const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

const PASSWORD = 'Sup3r-Secret-Pass!';
const EMAIL_PREFIX = 'p214-test-';
const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://mailpit:8025';

// Probe routes for the KYC gate (P2.15): the real protected endpoints (join a
// lot, register to sell, withdraw, sign a contract) land in P4/P5 and reuse the
// same @RequireKyc decorator. The global APP_GUARDs from AppModule apply here.
@Controller('probe-kyc')
class ProbeKycController {
  @Roles()
  @RequireKyc('BASIC')
  @Get('basic')
  basic() {
    return { ok: true };
  }

  @Roles()
  @RequireKyc('FULL')
  @Get('full')
  full() {
    return { ok: true };
  }
}

@Module({ controllers: [ProbeKycController] })
class ProbeKycModule {}

let app: INestApplication;
let prisma: PrismaService;
let redis: RedisService;

function makeEmail(): string {
  return `${EMAIL_PREFIX}${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`;
}

async function findMailTo(email: string, subject?: string, tries = 10): Promise<{ Text: string }> {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const list = (await fetch(`${MAILPIT_URL}/api/v1/messages?limit=200`).then((r) =>
      r.json(),
    )) as { messages?: Array<{ ID: string; Subject?: string; To?: Array<{ Address?: string }> }> };
    for (const message of list.messages ?? []) {
      const to = (message.To ?? []).map((i) => i.Address ?? '').join(',');
      if (to !== email) continue;
      if (subject && !(message.Subject ?? '').toLowerCase().includes(subject.toLowerCase()))
        continue;
      return (await fetch(`${MAILPIT_URL}/api/v1/message/${message.ID}`).then((r) => r.json())) as {
        Text: string;
      };
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`No mail for ${email}`);
}

describeDb('KYC photo review + gate (integration: P2.14/P2.15)', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule, ProbeKycModule],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    await cleanup();
  });

  beforeEach(async () => {
    await redis.deleteByPattern('*}:hits');
    await redis.deleteByPattern('*}:blocked');
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  async function cleanup(): Promise<void> {
    await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
    await redis.deleteByPattern('*}:hits');
    await redis.deleteByPattern('*}:blocked');
  }

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function registerAndLogin(email: string): Promise<string> {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD })
      .expect(200);
    const mail = await findMailTo(email, 'xác minh');
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: /token=([a-f0-9]{64})/.exec(mail.Text)?.[1] })
      .expect(200);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return login.body.accessToken as string;
  }

  async function makeAdmin(email: string, token: string): Promise<string> {
    const u = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.userRole.deleteMany({ where: { userId: u.id } });
    await prisma.userRole.createMany({
      data: [
        { userId: u.id, role: 'admin' },
        { userId: u.id, role: 'admin_ops' },
      ],
    });
    const switched = await request(app.getHttpServer())
      .post('/api/v1/me/active-role')
      .set(auth(token))
      .send({ role: 'admin' })
      .expect(200);
    return switched.body.accessToken as string;
  }

  // Uploads a document with the given bytes; returns ids + submission.
  async function uploadDoc(
    token: string,
    type: string,
    bytes: string,
    mime = 'image/jpeg',
  ): Promise<{ documentId: string; submissionId: string }> {
    const presign = await request(app.getHttpServer())
      .post('/api/v1/me/kyc/documents/presign')
      .set(auth(token))
      .send({ type, mime, sizeBytes: Buffer.byteLength(bytes) })
      .expect(200);
    const put = await fetch(presign.body.uploadUrl as string, {
      method: 'PUT',
      body: Buffer.from(bytes),
      headers: { 'Content-Type': mime },
    });
    expect(put.status).toBe(200);
    await request(app.getHttpServer())
      .post(`/api/v1/me/kyc/documents/${presign.body.documentId}/confirm`)
      .set(auth(token))
      .expect(200);
    return {
      documentId: presign.body.documentId as string,
      submissionId: presign.body.submissionId as string,
    };
  }

  const FULL_CHECKLIST = {
    checklist: {
      imageClear: true,
      infoMatch: true,
      faceMatch: true,
      docValid: true,
      bankNameMatch: true,
    },
  };

  // ---------------------------------------------------------- P2.14 review

  it('accepts PORTRAIT, detects duplicate image + CCCD, records checklist, hides raw CCCD', async () => {
    const email = makeEmail();
    const token = await registerAndLogin(email);
    await request(app.getHttpServer())
      .put('/api/v1/me/profile')
      .set(auth(token))
      .send({ orgType: 'PERSONAL', displayName: 'Nguyễn Văn A' })
      .expect(200);

    const uniqueBytes = `portrait-${Date.now()}`;
    const { submissionId } = await uploadDoc(token, 'CCCD_FRONT', 'front-bytes-A');
    await uploadDoc(token, 'CCCD_BACK', 'back-bytes-A');
    const portrait = await uploadDoc(token, 'PORTRAIT', uniqueBytes);
    expect(portrait.submissionId).toBe(submissionId);

    // Submit CCCD number.
    const cccdRes = await request(app.getHttpServer())
      .put('/api/v1/me/kyc/cccd')
      .set(auth(token))
      .send({ cccdNumber: '012345678901' })
      .expect(200);
    expect(cccdRes.body.duplicate).toBe(false);

    // Invalid CCCD format -> 400.
    await request(app.getHttpServer())
      .put('/api/v1/me/kyc/cccd')
      .set(auth(token))
      .send({ cccdNumber: '12345' })
      .expect(400);

    // GET /me/kyc must not leak the encrypted number or its hash.
    const mine = await request(app.getHttpServer())
      .get('/api/v1/me/kyc')
      .set(auth(token))
      .expect(200);
    expect(JSON.stringify(mine.body)).not.toContain('cccdNumberEnc');
    expect(JSON.stringify(mine.body)).not.toContain('cccdHash');
    expect(mine.body[0].duplicateFlag).toBe(false);

    // SLA is exposed for display.
    const sla = await request(app.getHttpServer())
      .get('/api/v1/me/kyc/sla')
      .set(auth(token))
      .expect(200);
    expect(typeof sla.body.slaHours).toBe('number');

    // Admin queue + detail (reveals CCCD, logs access).
    const adminEmail = makeEmail();
    const adminToken = await makeAdmin(adminEmail, await registerAndLogin(adminEmail));
    const queue = await request(app.getHttpServer())
      .get('/api/v1/admin/kyc?status=PENDING')
      .set(auth(adminToken))
      .expect(200);
    expect(queue.body.some((s: { id: string }) => s.id === submissionId)).toBe(true);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/admin/kyc/${submissionId}`)
      .set(auth(adminToken))
      .expect(200);
    expect(detail.body.cccdNumber).toBe('012345678901');
    const cccdEvents = await prisma.kycEvent.findMany({
      where: { submissionId, type: 'CCCD_ACCESSED' },
    });
    expect(cccdEvents.length).toBeGreaterThanOrEqual(1);

    // Approve needs the full eye-match checklist.
    await request(app.getHttpServer())
      .post(`/api/v1/admin/kyc/${submissionId}/approve`)
      .set(auth(adminToken))
      .send({ checklist: { ...FULL_CHECKLIST.checklist, faceMatch: false } })
      .expect(400);

    const approved = await request(app.getHttpServer())
      .post(`/api/v1/admin/kyc/${submissionId}/approve`)
      .set(auth(adminToken))
      .send(FULL_CHECKLIST)
      .expect(200);
    expect(approved.body.status).toBe('APPROVED');
    expect(approved.body.reviewChecklist).toMatchObject(FULL_CHECKLIST.checklist);

    // ---- duplicate detection: a second account reusing the SAME photo bytes
    // and the SAME CCCD number must both get flagged.
    const email2 = makeEmail();
    const token2 = await registerAndLogin(email2);
    await request(app.getHttpServer())
      .put('/api/v1/me/profile')
      .set(auth(token2))
      .send({ orgType: 'PERSONAL', displayName: 'Trần Văn B' })
      .expect(200);
    const { submissionId: sub2 } = await uploadDoc(token2, 'CCCD_FRONT', 'front-bytes-A');
    const dupCccd = await request(app.getHttpServer())
      .put('/api/v1/me/kyc/cccd')
      .set(auth(token2))
      .send({ cccdNumber: '012345678901' })
      .expect(200);
    expect(dupCccd.body.duplicate).toBe(true);

    // Both the new submission and the original are flagged.
    const s2 = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: sub2 } });
    const s1 = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: submissionId } });
    expect(s2.duplicateFlag).toBe(true);
    expect(s1.duplicateFlag).toBe(true); // via the shared CCCD number

    const dupEvents = await prisma.kycEvent.findMany({
      where: { submissionId: sub2, type: 'DUPLICATE_FLAGGED' },
    });
    expect(dupEvents.length).toBeGreaterThanOrEqual(1);
  }, 30000);

  it('image-only duplicate (different CCCD) still flags both accounts', async () => {
    const a = await registerAndLogin(makeEmail());
    await uploadDoc(a, 'PORTRAIT', 'shared-selfie-bytes');
    const b = await registerAndLogin(makeEmail());
    const { submissionId: subB } = await uploadDoc(b, 'PORTRAIT', 'shared-selfie-bytes');
    const sB = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: subB } });
    expect(sB.duplicateFlag).toBe(true);
  }, 30000);

  // ---------------------------------------------------------- P2.15 gate

  it('blocks protected endpoints until KYC is approved (BASIC) and bank set (FULL)', async () => {
    const email = makeEmail();
    const token = await registerAndLogin(email);

    // Not verified yet: both gates deny with KYC_REQUIRED.
    const blocked = await request(app.getHttpServer())
      .get('/api/v1/probe-kyc/basic')
      .set(auth(token));
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('KYC_REQUIRED');
    await request(app.getHttpServer()).get('/api/v1/probe-kyc/full').set(auth(token)).expect(403);

    // Verify + approve KYC.
    await request(app.getHttpServer())
      .put('/api/v1/me/profile')
      .set(auth(token))
      .send({ orgType: 'PERSONAL', displayName: 'Lê Văn C' })
      .expect(200);
    const { submissionId } = await uploadDoc(token, 'CCCD_FRONT', `f-${Date.now()}`);
    await request(app.getHttpServer())
      .put('/api/v1/me/kyc/cccd')
      .set(auth(token))
      .send({ cccdNumber: `9${Date.now().toString().slice(-11)}` })
      .expect(200);
    const adminEmail = makeEmail();
    const adminTok = await makeAdmin(adminEmail, await registerAndLogin(adminEmail));
    await request(app.getHttpServer())
      .post(`/api/v1/admin/kyc/${submissionId}/approve`)
      .set(auth(adminTok))
      .send(FULL_CHECKLIST)
      .expect(200);

    // BASIC now passes, FULL still needs a bank account.
    await request(app.getHttpServer()).get('/api/v1/probe-kyc/basic').set(auth(token)).expect(200);
    await request(app.getHttpServer()).get('/api/v1/probe-kyc/full').set(auth(token)).expect(403);

    // Add a matching bank account -> FULL passes.
    await request(app.getHttpServer())
      .post('/api/v1/me/bank-accounts')
      .set(auth(token))
      .send({
        bankName: 'VCB',
        holderName: 'Lê Văn C',
        accountNo: `5${Date.now().toString().slice(-9)}`,
      })
      .expect(201);
    await request(app.getHttpServer()).get('/api/v1/probe-kyc/full').set(auth(token)).expect(200);
  }, 30000);
});
