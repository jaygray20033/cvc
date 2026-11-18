import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../app.module';
import { TokenService } from '../auth/token.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

// Integration tests for P4.4 (supplier portal: own listings, admin approval)
// and P4.5 (supplier accounts: invite, lock/unlock). RUN_DB_TESTS=1 required.
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://mailpit:8025';
const PASSWORD = 'Sup3r-Secret-Pass!';
const EMAIL_PREFIX = 'p4b-test-';

let app: INestApplication;
let prisma: PrismaService;
let redis: RedisService;
let tokens: TokenService;

interface MailDetail {
  Subject: string;
  Text: string;
}

async function findMailTo(email: string, tries = 6): Promise<MailDetail> {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const list = (await fetch(`${MAILPIT_URL}/api/v1/messages?limit=200`).then((r) =>
      r.json(),
    )) as {
      messages?: Array<{ ID: string; Subject?: string; To?: Array<{ Address?: string }> }>;
    };
    for (const message of list.messages ?? []) {
      const to = (message.To ?? []).map((item) => item.Address ?? '').join(',');
      if (to !== email) continue;
      return (await fetch(`${MAILPIT_URL}/api/v1/message/${message.ID}`).then((r) =>
        r.json(),
      )) as MailDetail;
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

function makeEmail(): string {
  return `${EMAIL_PREFIX}${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`;
}

// Direct user + session creation (see catalog spec: avoids OTP throttle).
async function createUser(roles: string[]): Promise<{ email: string; accessToken: string }> {
  const email = makeEmail();
  const user = await prisma.user.create({
    data: { email, passwordHash: 'x', emailVerifiedAt: new Date() },
  });
  await prisma.userRole.createMany({ data: roles.map((role) => ({ userId: user.id, role })) });
  const sessionId = randomUUID();
  await prisma.session.create({
    data: {
      id: sessionId,
      userId: user.id,
      familyId: randomUUID(),
      refreshHash: tokens.hashToken(randomUUID()),
      activeRole: roles[0],
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  const accessToken = tokens.accessToken({ sub: user.id, email, sid: sessionId, role: roles[0] });
  return { email, accessToken };
}

describeDb('Suppliers (P4A.2: portal P4.4 + accounts P4.5)', () => {
  let adminToken = '';
  let buyerToken = '';

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    tokens = app.get(TokenService);
    await cleanup();
    adminToken = (await createUser(['admin'])).accessToken;
    buyerToken = (await createUser(['buyer'])).accessToken;
  }, 60_000);

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  async function cleanup(): Promise<void> {
    await prisma.product.deleteMany({ where: { sku: { startsWith: 'NCC-' } } });
    await prisma.supplier.deleteMany({ where: { name: { startsWith: 'p4b-supplier-' } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
    await redis.deleteByPattern('catalog:public:*');
  }

  async function createCategory(name: string): Promise<string> {
    const category = await prisma.category.create({
      data: { name, slug: `p4b-cat-${Math.floor(Math.random() * 1e9)}` },
    });
    return category.id;
  }

  // Seed a supplier company plus one login account for it.
  async function createSupplierWithAccount(label: string): Promise<{
    supplierId: string;
    userId: string;
    accessToken: string;
    accountId: string;
    email: string;
  }> {
    const supplier = await prisma.supplier.create({
      data: { name: `p4b-supplier-${label}-${Math.floor(Math.random() * 1e9)}` },
    });
    const { email, accessToken } = await createUser(['supplier']);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const account = await prisma.supplierAccount.create({
      data: { userId: user.id, supplierId: supplier.id },
    });
    return { supplierId: supplier.id, userId: user.id, accessToken, accountId: account.id, email };
  }

  it('RBAC: buyers cannot use the supplier portal or admin supplier APIs', async () => {
    const buyer = { Authorization: `Bearer ${buyerToken}` };
    expect(
      (await request(app.getHttpServer()).get('/api/v1/supplier/products').set(buyer)).status,
    ).toBe(403);
    expect(
      (
        await request(app.getHttpServer())
          .post('/api/v1/admin/suppliers')
          .set(buyer)
          .send({ name: 'p4b-supplier-nope' })
      ).status,
    ).toBe(403);
  });

  it('DoD isolation: supplier A cannot see or modify supplier B listings', async () => {
    const a = await createSupplierWithAccount('isoA');
    const b = await createSupplierWithAccount('isoB');
    const categoryId = await createCategory('Gia dụng NCC');
    const authA = { Authorization: `Bearer ${a.accessToken}` };
    const authB = { Authorization: `Bearer ${b.accessToken}` };

    const created = await request(app.getHttpServer())
      .post('/api/v1/supplier/products')
      .set(authA)
      .send({ name: 'Bộ chén sứ', categoryId, moq: 12, costPrice: 45.5 });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('DRAFT');
    expect(created.body.approved).toBe(false);
    const productId = created.body.id as string;

    // A sees it, B does not.
    const listA = await request(app.getHttpServer()).get('/api/v1/supplier/products').set(authA);
    expect(listA.status).toBe(200);
    expect(listA.body.items.map((item: { id: string }) => item.id)).toContain(productId);
    const listB = await request(app.getHttpServer()).get('/api/v1/supplier/products').set(authB);
    expect(listB.body.items.map((item: { id: string }) => item.id)).not.toContain(productId);

    // B cannot read, edit or toggle A's product.
    expect(
      (await request(app.getHttpServer()).get(`/api/v1/supplier/products/${productId}`).set(authB))
        .status,
    ).toBe(404);
    expect(
      (
        await request(app.getHttpServer())
          .put(`/api/v1/supplier/products/${productId}`)
          .set(authB)
          .send({ name: 'Chiếm đoạt' })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app.getHttpServer())
          .patch(`/api/v1/supplier/products/${productId}/visibility`)
          .set(authB)
          .send({ visible: false })
      ).status,
    ).toBe(404);
  });

  it('approval flow: publish requires admin approval; public API hides cost/supplier fields', async () => {
    const a = await createSupplierWithAccount('approve');
    const categoryId = await createCategory('Thủ công mỹ nghệ');
    const auth = { Authorization: `Bearer ${a.accessToken}` };
    const admin = { Authorization: `Bearer ${adminToken}` };

    const created = await request(app.getHttpServer())
      .post('/api/v1/supplier/products')
      .set(auth)
      .send({
        name: 'Giỏ mây đan tay',
        categoryId,
        moq: 20,
        leadTimeDays: 18,
        costPrice: 120_000,
        currency: 'VND',
        supplierSku: 'NCC-GIO-01',
      });
    expect(created.status).toBe(201);
    const productId = created.body.id as string;
    const sku = created.body.sku as string;

    // Update own listing: cost/supplierSku only live on the supplier row.
    const updated = await request(app.getHttpServer())
      .put(`/api/v1/supplier/products/${productId}`)
      .set(auth)
      .send({ name: 'Giỏ mây đan tay loại lớn', costPrice: 135_000 });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Giỏ mây đan tay loại lớn');
    expect(Number(updated.body.costPrice)).toBe(135_000);

    // Not approved yet: supplier publish is blocked, public detail is 404.
    const blocked = await request(app.getHttpServer())
      .patch(`/api/v1/supplier/products/${productId}/visibility`)
      .set(auth)
      .send({ visible: true });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('APPROVAL_REQUIRED');
    expect((await request(app.getHttpServer()).get(`/api/v1/public/products/${sku}`)).status).toBe(
      404,
    );

    // Admin publishing the product approves the listing (D12).
    const approved = await request(app.getHttpServer())
      .patch(`/api/v1/admin/products/${productId}/visibility`)
      .set(admin)
      .send({ visible: true });
    expect(approved.status).toBe(200);
    const detailAfter = await request(app.getHttpServer())
      .get(`/api/v1/supplier/products/${productId}`)
      .set(auth);
    expect(detailAfter.body.approved).toBe(true);

    // Supplier can now toggle visibility; public payload has no cost fields.
    const shown = await request(app.getHttpServer())
      .patch(`/api/v1/supplier/products/${productId}/visibility`)
      .set(auth)
      .send({ visible: true });
    expect(shown.status).toBe(200);
    const publicDetail = await request(app.getHttpServer()).get(`/api/v1/public/products/${sku}`);
    expect(publicDetail.status).toBe(200);
    const json = JSON.stringify(publicDetail.body).toLowerCase();
    expect(json).not.toContain('costprice');
    expect(json).not.toContain('suppliersku');
    expect(json).not.toContain('supplier');

    const hidden = await request(app.getHttpServer())
      .patch(`/api/v1/supplier/products/${productId}/visibility`)
      .set(auth)
      .send({ visible: false });
    expect(hidden.status).toBe(200);
    expect((await request(app.getHttpServer()).get(`/api/v1/public/products/${sku}`)).status).toBe(
      404,
    );
  });

  it('P4.5 accounts: invite email → set password → lock blocks login → unlock restores', async () => {
    const admin = { Authorization: `Bearer ${adminToken}` };

    const supplier = await request(app.getHttpServer())
      .post('/api/v1/admin/suppliers')
      .set(admin)
      .send({ name: `p4b-supplier-account-${Date.now()}`, province: 'Quảng Châu' });
    expect(supplier.status).toBe(201);

    const email = makeEmail();
    const account = await request(app.getHttpServer())
      .post('/api/v1/admin/supplier-accounts')
      .set(admin)
      .send({ supplierId: supplier.body.id, email, title: 'Sales', isPrimary: true });
    expect(account.status).toBe(201);
    expect(account.body.status).toBe('ACTIVE');

    // Row checks: supplier role + account link exist.
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(
      await prisma.userRole.findFirst({ where: { userId: user.id, role: 'supplier' } }),
    ).toBeTruthy();
    expect(await prisma.supplierAccount.findUnique({ where: { userId: user.id } })).toBeTruthy();

    // Invite mail arrives; use the reset link to set a password.
    const mail = await findMailTo(email);
    const reset = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: extractToken(mail), newPassword: PASSWORD });
    expect(reset.status).toBe(200);

    const loginOk = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD });
    expect(loginOk.status).toBe(200);
    const supplierAccess = loginOk.body.accessToken as string;
    expect(supplierAccess).toBeTruthy();

    // Duplicate account email → 409.
    const dup = await request(app.getHttpServer())
      .post('/api/v1/admin/supplier-accounts')
      .set(admin)
      .send({ supplierId: supplier.body.id, email });
    expect(dup.status).toBe(409);

    // Lock: login is refused and the existing session is revoked.
    const lock = await request(app.getHttpServer())
      .patch(`/api/v1/admin/supplier-accounts/${account.body.id}/status`)
      .set(admin)
      .send({ status: 'SUSPENDED' });
    expect(lock.status).toBe(200);
    expect(lock.body.status).toBe('SUSPENDED');

    const loginLocked = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD });
    expect(loginLocked.status).toBe(403);
    expect(loginLocked.body.code).toBe('AUTH_ACCOUNT_DISABLED');

    // The suspended account's existing session was revoked (no active rows).
    const staleSession = await request(app.getHttpServer())
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${supplierAccess}`);
    expect(staleSession.status).toBe(200);
    expect(staleSession.body).toEqual([]);

    // Unlock: login works again.
    const unlock = await request(app.getHttpServer())
      .patch(`/api/v1/admin/supplier-accounts/${account.body.id}/status`)
      .set(admin)
      .send({ status: 'ACTIVE' });
    expect(unlock.status).toBe(200);
    const loginAgain = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD });
    expect(loginAgain.status).toBe(200);
  });
});
