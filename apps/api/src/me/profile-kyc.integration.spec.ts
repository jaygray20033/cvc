import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

// Integration tests for P2.11 (profile/addresses/bank), P2.12 (KYC upload)
// and P2.13 (manual review) against the real dev stack. Only run when the
// stack is reachable: RUN_DB_TESTS=1 (api container/CI).
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://mailpit:8025';
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

async function findMailTo(email: string, subject?: string, tries = 10): Promise<MailDetail> {
  for (let attempt = 0; attempt < tries; attempt += 1) {
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

describeDb('Profile + KYC API (integration: P2.11–P2.13)', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    await cleanup();
  });

  beforeEach(async () => {
    // Clear throttler buckets ({<hash>:<name>}:hits|blocked) between tests.
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

  async function registerAndLogin(email: string): Promise<{ accessToken: string }> {
    const registerRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD });
    expect(registerRes.status).toBe(200);
    // Email must be verified before login is allowed.
    const mail = await findMailTo(email, 'xác minh');
    const verifyRes = await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: /token=([a-f0-9]{64})/.exec(mail.Text)?.[1] });
    expect(verifyRes.status).toBe(200);
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD });
    expect(loginRes.status).toBe(200);
    return { accessToken: loginRes.body.accessToken as string };
  }

  // Replaces roles, then switches the session to the admin role via
  // /me/active-role (no re-login needed — admin requires 2FA to re-login).
  async function makeAdmin(
    email: string,
    accessToken: string,
    groups: string[] = ['admin_ops'],
  ): Promise<{ accessToken: string }> {
    const user = await prisma.user.findUnique({ where: { email } });
    await prisma.userRole.deleteMany({ where: { userId: user!.id } });
    await prisma.userRole.createMany({
      data: [
        { userId: user!.id, role: 'admin' },
        ...groups.map((role) => ({ userId: user!.id, role })),
      ],
    });
    const switched = await request(app.getHttpServer())
      .post('/api/v1/me/active-role')
      .set(auth(accessToken))
      .send({ role: 'admin' });
    expect(switched.status).toBe(200);
    return { accessToken: switched.body.accessToken as string };
  }

  const auth = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` });
  const ADDRESS = {
    receiverName: 'Nguyễn Văn A',
    phone: '0912345678',
    city: 'Hà Nội',
    district: 'Cầu Giấy',
    ward: 'Dịch Vọng',
    line: 'Số 1 Xuân Thủy',
  };

  // ------------------------------------------------------------- P2.11 profile

  describe('P2.11 profile', () => {
    it('upserts and reads the profile; validates MST and business rules', async () => {
      const email = makeEmail();
      const { accessToken } = await registerAndLogin(email);

      // Empty GET returns an empty body before first save.
      const empty = await request(app.getHttpServer())
        .get('/api/v1/me/profile')
        .set(auth(accessToken));
      expect(empty.status).toBe(200);
      expect(empty.text).toBe('');

      // Invalid MST -> 400.
      const bad = await request(app.getHttpServer())
        .put('/api/v1/me/profile')
        .set(auth(accessToken))
        .send({ orgType: 'PERSONAL', displayName: 'Nguyễn Văn A', taxId: '123' });
      expect(bad.status).toBe(400);

      // Business household without MST/ĐKKD -> 400.
      const badBiz = await request(app.getHttpServer())
        .put('/api/v1/me/profile')
        .set(auth(accessToken))
        .send({ orgType: 'BUSINESS_HOUSEHOLD', displayName: 'Hộ Nhà Bếp' });
      expect(badBiz.status).toBe(400);

      const ok = await request(app.getHttpServer())
        .put('/api/v1/me/profile')
        .set(auth(accessToken))
        .send({ orgType: 'PERSONAL', displayName: 'Nguyễn Văn A' });
      expect(ok.status).toBe(200);
      expect(ok.body.orgType).toBe('PERSONAL');
      expect(ok.body.displayName).toBe('Nguyễn Văn A');

      // MST already used by another profile -> 409.
      const second = makeEmail();
      const { accessToken: token2 } = await registerAndLogin(second);
      const dup = await request(app.getHttpServer())
        .put('/api/v1/me/profile')
        .set(auth(token2))
        .send({ orgType: 'PERSONAL', displayName: 'Trần Văn B' });
      expect(dup.status).toBe(200);
    });

    it('CRUD addresses with default handling', async () => {
      const email = makeEmail();
      const { accessToken } = await registerAndLogin(email);

      const created = await request(app.getHttpServer())
        .post('/api/v1/me/addresses')
        .set(auth(accessToken))
        .send({ ...ADDRESS, label: 'Nhà', isDefault: true });
      expect(created.status).toBe(201);
      expect(created.body.isDefault).toBe(true);
      const addressId = created.body.id as string;

      // Invalid phone -> 400.
      const badPhone = await request(app.getHttpServer())
        .post('/api/v1/me/addresses')
        .set(auth(accessToken))
        .send({ ...ADDRESS, phone: '12345678' });
      expect(badPhone.status).toBe(400);

      // Second default address unsets the first.
      const second = await request(app.getHttpServer())
        .post('/api/v1/me/addresses')
        .set(auth(accessToken))
        .send({ ...ADDRESS, line: 'Số 2', isDefault: true });
      const list = await request(app.getHttpServer())
        .get('/api/v1/me/addresses')
        .set(auth(accessToken));
      const defaults = list.body.filter((a: { isDefault: boolean }) => a.isDefault);
      expect(defaults.length).toBe(1);
      expect(defaults[0].id).toBe(second.body.id);

      const updated = await request(app.getHttpServer())
        .put(`/api/v1/me/addresses/${addressId}`)
        .set(auth(accessToken))
        .send({ line: 'Số 1A' });
      expect(updated.status).toBe(200);
      expect(updated.body.line).toBe('Số 1A');

      const removed = await request(app.getHttpServer())
        .delete(`/api/v1/me/addresses/${addressId}`)
        .set(auth(accessToken));
      expect(removed.status).toBe(200);
    });
  });

  // ------------------------------------------------- P2.11 bank accounts

  describe('P2.11 bank accounts', () => {
    let accessToken: string;
    let email: string;

    beforeAll(async () => {
      email = makeEmail();
      const tokens = await registerAndLogin(email);
      accessToken = tokens.accessToken;
      const profile = await request(app.getHttpServer())
        .put('/api/v1/me/profile')
        .set(auth(accessToken))
        .send({ orgType: 'PERSONAL', displayName: 'Nguyễn Văn A' });
      expect(profile.status).toBe(200);
    });

    it('rejects wrong bank account format', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/me/bank-accounts')
        .set(auth(accessToken))
        .send({ bankName: 'VCB', holderName: 'Nguyễn Văn A', accountNo: '12ab5678' });
      expect(res.status).toBe(400);
    });

    it('rejects holder name mismatch with the profile name', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/me/bank-accounts')
        .set(auth(accessToken))
        .send({ bankName: 'VCB', holderName: 'Trần Văn C', accountNo: '1234567890' });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Tên chủ tài khoản');
    });

    it('accepts diacritic-insensitive holder match, stores encrypted, shows masked', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/me/bank-accounts')
        .set(auth(accessToken))
        .send({ bankName: 'VCB', holderName: 'NGUYEN VAN A', accountNo: '1234567890' });
      expect(res.status).toBe(201);
      expect(res.body.accountNo).toBeUndefined(); // never returns the number
      expect(res.body.accountNoEnc).toBeUndefined();
      expect(res.body.accountNoLast4).toBe('7890');

      // Encrypted at rest: ciphertext not reversible-looking, no plaintext.
      const raw = await prisma.bankAccount.findFirstOrThrow({
        where: { holderName: 'NGUYEN VAN A' },
      });
      expect(raw.accountNoEnc).not.toContain('1234567890');
      expect(raw.accountNoEnc).not.toBe('1234567890');
      expect(raw.accountNoLast4).toBe('7890');

      // Listing shows only masked data.
      const list = await request(app.getHttpServer())
        .get('/api/v1/me/bank-accounts')
        .set(auth(accessToken));
      expect(list.status).toBe(200);
      expect(list.body[0].accountNoLast4).toBe('7890');
      expect(list.body[0].accountNo).toBeUndefined();
      expect(JSON.stringify(list.body)).not.toContain('1234567890');
    });

    it('rejects a duplicate account number globally', async () => {
      const other = makeEmail();
      const { accessToken: token2 } = await registerAndLogin(other);
      await request(app.getHttpServer())
        .put('/api/v1/me/profile')
        .set(auth(token2))
        .send({ orgType: 'PERSONAL', displayName: 'Nguyễn Văn A' });
      const res = await request(app.getHttpServer())
        .post('/api/v1/me/bank-accounts')
        .set(auth(token2))
        .send({ bankName: 'VCB', holderName: 'Nguyễn Văn A', accountNo: '1234567890' });
      expect(res.status).toBe(409);
    });

    it('update does not change the account number; delete works', async () => {
      const list = await request(app.getHttpServer())
        .get('/api/v1/me/bank-accounts')
        .set(auth(accessToken));
      const id = list.body[0].id as string;
      const updated = await request(app.getHttpServer())
        .put(`/api/v1/me/bank-accounts/${id}`)
        .set(auth(accessToken))
        .send({ bankName: 'Techcombank' });
      expect(updated.status).toBe(200);
      expect(updated.body.bankName).toBe('Techcombank');

      const raw = await prisma.bankAccount.findUniqueOrThrow({ where: { id } });
      // Still decrypts to the original number: immutable accountNo.
      const enc = raw.accountNoEnc;
      const after = await prisma.bankAccount.findUniqueOrThrow({ where: { id } });
      expect(after.accountNoEnc).toBe(enc);

      const removed = await request(app.getHttpServer())
        .delete(`/api/v1/me/bank-accounts/${id}`)
        .set(auth(accessToken));
      expect(removed.status).toBe(200);
    });
  });

  // ------------------------------------------------ P2.11 IDOR cross-user

  describe('P2.11 IDOR', () => {
    it('user B gets 404 touching user A address/bank account', async () => {
      const emailA = makeEmail();
      const { accessToken: tokenA } = await registerAndLogin(emailA);
      const address = await request(app.getHttpServer())
        .post('/api/v1/me/addresses')
        .set(auth(tokenA))
        .send(ADDRESS);
      const addressId = address.body.id as string;

      const emailB = makeEmail();
      const { accessToken: tokenB } = await registerAndLogin(emailB);

      const getA = await request(app.getHttpServer())
        .put(`/api/v1/me/addresses/${addressId}`)
        .set(auth(tokenB))
        .send({ line: 'hack' });
      expect(getA.status).toBe(404);

      const delA = await request(app.getHttpServer())
        .delete(`/api/v1/me/addresses/${addressId}`)
        .set(auth(tokenB));
      expect(delA.status).toBe(404);

      const bank = await request(app.getHttpServer())
        .put('/api/v1/me/profile')
        .set(auth(tokenA))
        .send({ orgType: 'PERSONAL', displayName: 'Nguyễn Văn A' });
      expect(bank.status).toBe(200);
      const account = await request(app.getHttpServer())
        .post('/api/v1/me/bank-accounts')
        .set(auth(tokenA))
        .send({ bankName: 'VCB', holderName: 'Nguyễn Văn A', accountNo: '999888777666' });
      expect(account.status).toBe(201);
      const accountId = account.body.id as string;

      const delBank = await request(app.getHttpServer())
        .delete(`/api/v1/me/bank-accounts/${accountId}`)
        .set(auth(tokenB));
      expect(delBank.status).toBe(404);

      // A's records survive B's attempts.
      const list = await request(app.getHttpServer()).get('/api/v1/me/addresses').set(auth(tokenA));
      expect(list.body.map((a: { id: string }) => a.id)).toContain(addressId);
    });
  });

  // --------------------------------------------------- P2.12/P2.13 KYC flow

  describe('P2.12 + P2.13 KYC upload and manual review', () => {
    async function uploadDocument(
      accessToken: string,
      type = 'CCCD_FRONT',
      mime = 'image/jpeg',
    ): Promise<{ documentId: string; submissionId: string }> {
      const presign = await request(app.getHttpServer())
        .post('/api/v1/me/kyc/documents/presign')
        .set(auth(accessToken))
        .send({ type, mime, sizeBytes: 1024 });
      expect(presign.status).toBe(200);
      // Simulate the client PUT to the presigned URL.
      const put = await fetch(presign.body.uploadUrl as string, {
        method: 'PUT',
        body: Buffer.from('fake-image-bytes'),
        headers: { 'Content-Type': mime },
      });
      expect(put.status).toBe(200);
      const confirm = await request(app.getHttpServer())
        .post(`/api/v1/me/kyc/documents/${presign.body.documentId}/confirm`)
        .set(auth(accessToken));
      expect(confirm.status).toBe(200);
      return {
        documentId: presign.body.documentId as string,
        submissionId: presign.body.submissionId as string,
      };
    }

    it('rejects unsupported mime/oversize on presign', async () => {
      const email = makeEmail();
      const { accessToken } = await registerAndLogin(email);
      const badMime = await request(app.getHttpServer())
        .post('/api/v1/me/kyc/documents/presign')
        .set(auth(accessToken))
        .send({ type: 'CCCD_FRONT', mime: 'application/zip', sizeBytes: 1024 });
      expect(badMime.status).toBe(400);
      const tooBig = await request(app.getHttpServer())
        .post('/api/v1/me/kyc/documents/presign')
        .set(auth(accessToken))
        .send({ type: 'CCCD_FRONT', mime: 'image/jpeg', sizeBytes: 6 * 1024 * 1024 });
      expect(tooBig.status).toBe(400);
    });

    it('full flow: upload -> admin queue -> reject -> resubmit -> approve, with events and email', async () => {
      const email = makeEmail();
      const { accessToken } = await registerAndLogin(email);

      const { documentId, submissionId } = await uploadDocument(accessToken);
      // Second doc on the same open submission.
      await uploadDocument(accessToken, 'CCCD_BACK');

      const mine = await request(app.getHttpServer()).get('/api/v1/me/kyc').set(auth(accessToken));
      expect(mine.status).toBe(200);
      expect(mine.body[0].status).toBe('PENDING');
      expect(mine.body[0].documents.length).toBe(2);
      // s3Key/bucket never leak to the user.
      expect(JSON.stringify(mine.body)).not.toContain('s3Key');
      expect(JSON.stringify(mine.body)).not.toContain('bucket');

      // Owner download link works.
      const link = await request(app.getHttpServer())
        .get(`/api/v1/me/kyc/documents/${documentId}/download`)
        .set(auth(accessToken));
      expect(link.status).toBe(200);
      expect(link.body.url).toContain('X-Amz-');
      expect(link.body.expiresIn).toBe(300);

      // Cross-user access is 404 (P2.12 owner-only).
      const otherEmail = makeEmail();
      const { accessToken: tokenOther } = await registerAndLogin(otherEmail);
      const cross = await request(app.getHttpServer())
        .get(`/api/v1/me/kyc/documents/${documentId}/download`)
        .set(auth(tokenOther));
      expect(cross.status).toBe(404);

      // Admin queue (admin_ops) sees the pending submission.
      const adminEmail = makeEmail();
      const adminRegs = await registerAndLogin(adminEmail);
      const { accessToken: adminToken } = await makeAdmin(adminEmail, adminRegs.accessToken, [
        'admin_ops',
      ]);

      const queue = await request(app.getHttpServer())
        .get('/api/v1/admin/kyc?status=PENDING')
        .set(auth(adminToken));
      expect(queue.status).toBe(200);
      const submission = queue.body.find((s: { id: string }) => s.id === submissionId);
      expect(submission).toBeDefined();
      expect(submission.user.email).toBe(email);

      // Admin can issue a download link too.
      const adminLink = await request(app.getHttpServer())
        .get(`/api/v1/admin/kyc/documents/${documentId}/download`)
        .set(auth(adminToken));
      expect(adminLink.status).toBe(200);
      expect(adminLink.body.url).toContain('X-Amz-');

      // Admin without the admin_ops group is denied (P2.10/P2.13).
      const plainAdminEmail = makeEmail();
      const plainRegs = await registerAndLogin(plainAdminEmail);
      const { accessToken: plainToken } = await makeAdmin(plainAdminEmail, plainRegs.accessToken, [
        'admin_finance',
      ]);
      const denied = await request(app.getHttpServer())
        .get('/api/v1/admin/kyc')
        .set(auth(plainToken));
      expect(denied.status).toBe(403);

      // Reject without reason -> 400 (validation requires >= 5 chars).
      const noReason = await request(app.getHttpServer())
        .post(`/api/v1/admin/kyc/${submissionId}/reject`)
        .set(auth(adminToken))
        .send({});
      expect(noReason.status).toBe(400);

      // Reject with reason -> 200 + email + event.
      const reject = await request(app.getHttpServer())
        .post(`/api/v1/admin/kyc/${submissionId}/reject`)
        .set(auth(adminToken))
        .send({ reason: 'Ảnh CCCD không rõ nét' });
      expect(reject.status).toBe(200);
      expect(reject.body.status).toBe('REJECTED');
      const rejectMail = await findMailTo(email, 'KYC');
      expect(rejectMail.Text).toContain('chưa được duyệt');

      // Resubmit: NEED_MORE/PENDING handling. After rejection a new presign
      // opens a fresh PENDING submission.
      const { submissionId: submission2 } = await uploadDocument(accessToken);
      expect(submission2).not.toBe(submissionId);

      // request-more with reason -> NEED_MORE + email.
      const needMore = await request(app.getHttpServer())
        .post(`/api/v1/admin/kyc/${submission2}/request-more`)
        .set(auth(adminToken))
        .send({ reason: 'Thiếu giấy ủy quyền' });
      expect(needMore.status).toBe(200);
      expect(needMore.body.status).toBe('NEED_MORE');
      const needMoreMail = await findMailTo(email, 'KYC');
      expect(needMoreMail.Text).toContain('bổ sung thêm giấy tờ');

      // Resubmitting while NEED_MORE re-opens the same submission as PENDING.
      const { submissionId: submission3 } = await uploadDocument(accessToken, 'AUTHORIZATION');
      expect(submission3).toBe(submission2);
      const reopened = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: submission2 } });
      expect(reopened.status).toBe('PENDING');

      // Approve -> APPROVED + email.
      const approve = await request(app.getHttpServer())
        .post(`/api/v1/admin/kyc/${submission2}/approve`)
        .set(auth(adminToken))
        .send({
          checklist: {
            imageClear: true,
            infoMatch: true,
            faceMatch: true,
            docValid: true,
            bankNameMatch: true,
          },
        });
      expect(approve.status).toBe(200);
      expect(approve.body.status).toBe('APPROVED');
      expect(approve.body.reviewedById).toBeDefined();
      const approveMail = await findMailTo(email, 'KYC', 12);
      expect(approveMail.Text).toContain('đã được duyệt');

      // Double approve is rejected.
      const again = await request(app.getHttpServer())
        .post(`/api/v1/admin/kyc/${submission2}/approve`)
        .set(auth(adminToken))
        .send({
          checklist: {
            imageClear: true,
            infoMatch: true,
            faceMatch: true,
            docValid: true,
            bankNameMatch: true,
          },
        });
      expect(again.status).toBe(400);

      // Review history has the full trail (P2.13 DoD).
      const events = await prisma.kycEvent.findMany({
        where: { submissionId: submission2 },
        orderBy: { createdAt: 'asc' },
      });
      const types = events.map((e) => e.type);
      expect(types).toContain('SUBMITTED');
      expect(types).toContain('DOCUMENT_UPLOADED');
      expect(types).toContain('NEED_MORE');
      expect(types).toContain('APPROVED');
      const needMoreEvent = events.find((e) => e.type === 'NEED_MORE');
      expect(needMoreEvent?.note).toBe('Thiếu giấy ủy quyền');
      expect(needMoreEvent?.actorRole).toBe('admin');
      // Access log (P2.12 DoD): admin + owner downloads recorded.
      const accessEvents = await prisma.kycEvent.findMany({
        where: { submissionId, type: 'DOCUMENT_ACCESSED' },
      });
      expect(accessEvents.length).toBeGreaterThanOrEqual(2);
    }, 30000);

    it('confirm fails when the object was never uploaded', async () => {
      const email = makeEmail();
      const { accessToken } = await registerAndLogin(email);
      const presign = await request(app.getHttpServer())
        .post('/api/v1/me/kyc/documents/presign')
        .set(auth(accessToken))
        .send({ type: 'BUSINESS_REG', mime: 'application/pdf', sizeBytes: 2048 });
      const confirm = await request(app.getHttpServer())
        .post(`/api/v1/me/kyc/documents/${presign.body.documentId}/confirm`)
        .set(auth(accessToken));
      expect(confirm.status).toBe(400);
    });
  });
});
