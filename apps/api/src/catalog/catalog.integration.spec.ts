import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../app.module';
import { TokenService } from '../auth/token.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

// Integration tests for the catalog module (P4A.1): product CRUD + visibility,
// public catalog (no price/supplier leak), and sourcing-case publishing.
// RUN_DB_TESTS=1 required (api container dev stack).
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

const EMAIL_PREFIX = 'p4a-test-';

let app: INestApplication;
let prisma: PrismaService;
let redis: RedisService;
let tokens: TokenService;

function makeEmail(): string {
  return `${EMAIL_PREFIX}${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`;
}

function makeSku(): string {
  return `CVC-T${Math.floor(Math.random() * 1e9)}`;
}

// Creates a verified user directly (no OTP: the request endpoint is
// throttled per IP and consecutive jest runs would exhaust it) and mints an
// access token via TokenService with the first role active (P2.9 semantics).
async function createRoleUser(roles: string[]): Promise<{ email: string; accessToken: string }> {
  const email = makeEmail();
  const user = await prisma.user.create({
    data: { email, passwordHash: 'x', emailVerifiedAt: new Date() },
  });
  await prisma.userRole.createMany({
    data: roles.map((role) => ({ userId: user.id, role })),
  });
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
  const accessToken = tokens.accessToken({
    sub: user.id,
    email,
    sid: sessionId,
    role: roles[0],
  });
  return { email, accessToken };
}

describeDb('Catalog (P4A.1: products + public catalog + sourcing cases)', () => {
  // Shared privileged users: OTP request is throttled (8/min), so tests
  // reuse one admin + one buyer instead of creating fresh accounts each time.
  let adminToken = '';
  let buyerToken = '';
  let buyerEmail = '';

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    tokens = app.get(TokenService);
    await cleanup();
    const admin = await createRoleUser(['admin']);
    adminToken = admin.accessToken;
    const buyer = await createRoleUser(['buyer']);
    buyerToken = buyer.accessToken;
    buyerEmail = buyer.email;
  }, 90_000);

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  async function cleanup(): Promise<void> {
    await prisma.sourcingCase.deleteMany({});
    // Delete test orders first: products/users restrict via orders.
    const testUsers = await prisma.user.findMany({
      where: { email: { startsWith: EMAIL_PREFIX } },
      select: { id: true },
    });
    const userIds = testUsers.map((user) => user.id);
    await prisma.order.deleteMany({ where: { buyerId: { in: userIds } } });
    await prisma.product.deleteMany({
      where: {
        OR: [{ sku: { startsWith: 'CVC-T' } }, { sku: { startsWith: 'CVC-CASE-' } }],
      },
    });
    await prisma.fileObject.deleteMany({ where: { ownerId: { in: ['p4a-image-test'] } } });
    await prisma.category.deleteMany({ where: { slug: { startsWith: 'p4a-cat-' } } });
    await prisma.supplier.deleteMany({ where: { name: { startsWith: 'p4a-supplier-' } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
    await redis.deleteByPattern('catalog:public:*');
  }

  async function createCategory(name: string): Promise<{ id: string; slug: string }> {
    const slug = `p4a-cat-${Math.floor(Math.random() * 1e9)}`;
    const category = await prisma.category.create({ data: { name, slug } });
    return { id: category.id, slug: category.slug };
  }

  async function createReadyFile(): Promise<string> {
    const file = await prisma.fileObject.create({
      data: {
        ownerType: 'product',
        ownerId: 'p4a-image-test',
        bucket: 'files',
        s3Key: `p4a/image-${Date.now()}-${Math.floor(Math.random() * 1e9)}.png`,
        declaredMime: 'image/png',
        detectedMime: 'image/png',
        sizeBytes: 1024,
        status: 'READY',
        scanStatus: 'CLEAN',
      },
    });
    return file.id;
  }

  async function createOrder(buyerId: string, status: 'COMPLETED' | 'NEGOTIATING') {
    const supplier = await prisma.supplier.create({
      data: { name: `p4a-supplier-${Math.floor(Math.random() * 1e9)}` },
    });
    return prisma.order.create({
      data: {
        orderNo: `CVC-ORD-${Date.now()}${Math.floor(Math.random() * 100)}`.slice(0, 32),
        buyerId,
        supplierId: supplier.id,
        status,
        totalAmount: 5_000_000,
      },
    });
  }

  it('RBAC: buyer cannot create products; sales and admin can', async () => {
    const sales = await createRoleUser(['sales']);
    const category = await createCategory('Đồ dùng nhà bếp');
    const salesAuth = { Authorization: `Bearer ${sales.accessToken}` };
    const buyerAuth = { Authorization: `Bearer ${buyerToken}` };
    const adminAuth = { Authorization: `Bearer ${adminToken}` };

    const denied = await request(app.getHttpServer())
      .post('/api/v1/admin/products')
      .set(buyerAuth)
      .send({ sku: makeSku(), name: 'Nồi cơm', categoryId: category.id, moq: 10 });
    expect(denied.status).toBe(403);

    const asSales = await request(app.getHttpServer())
      .post('/api/v1/admin/products')
      .set(salesAuth)
      .send({ sku: makeSku(), name: 'Nồi cơm điện', categoryId: category.id, moq: 10 });
    expect(asSales.status).toBe(201);
    expect(asSales.body.status).toBe('DRAFT');

    const asAdmin = await request(app.getHttpServer())
      .post('/api/v1/admin/products')
      .set(adminAuth)
      .send({ sku: makeSku(), name: 'Chảo chống dính', categoryId: category.id, moq: 5 });
    expect(asAdmin.status).toBe(201);
  });

  it('validation: MOQ must be positive, SKU format enforced, duplicate SKU → 409', async () => {
    const category = await createCategory('Gia dụng');
    const auth = { Authorization: `Bearer ${adminToken}` };

    const badMoq = await request(app.getHttpServer())
      .post('/api/v1/admin/products')
      .set(auth)
      .send({ sku: makeSku(), name: 'X', categoryId: category.id, moq: 0 });
    expect(badMoq.status).toBe(400);

    const badSku = await request(app.getHttpServer())
      .post('/api/v1/admin/products')
      .set(auth)
      .send({ sku: 'invalid-sku', name: 'X', categoryId: category.id, moq: 1 });
    expect(badSku.status).toBe(400);

    const sku = makeSku();
    const first = await request(app.getHttpServer())
      .post('/api/v1/admin/products')
      .set(auth)
      .send({ sku, name: 'Bình giữ nhiệt', categoryId: category.id, moq: 10 });
    expect(first.status).toBe(201);

    const dup = await request(app.getHttpServer())
      .post('/api/v1/admin/products')
      .set(auth)
      .send({ sku, name: 'Bình giữ nhiệt 2', categoryId: category.id, moq: 10 });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('UNIQUE_CONSTRAINT');
  });

  it('CRUD: update, specs replace, images, then visibility controls public exposure', async () => {
    const category = await createCategory('Mẹ và bé');
    const auth = { Authorization: `Bearer ${adminToken}` };

    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/products')
      .set(auth)
      .send({
        sku: makeSku(),
        name: 'Bỉm quần gói 60',
        categoryId: category.id,
        moq: 2,
        priceRef: 85_000,
        specs: [{ key: 'size', value: 'XL' }],
      });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    const sku = created.body.sku as string;

    // Hidden while DRAFT: absent from public APIs.
    const draftDetail = await request(app.getHttpServer()).get(`/api/v1/public/products/${sku}`);
    expect(draftDetail.status).toBe(404);

    // Update + replace specs.
    const updated = await request(app.getHttpServer())
      .put(`/api/v1/admin/products/${id}`)
      .set(auth)
      .send({ name: 'Bỉm quần gói 70', moq: 3 });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Bỉm quần gói 70');
    expect(updated.body.moq).toBe(3);

    const specs = await request(app.getHttpServer())
      .put(`/api/v1/admin/products/${id}/specs`)
      .set(auth)
      .send({
        specs: [
          { key: 'size', value: 'XL' },
          { key: 'màu', value: 'Trắng' },
        ],
      });
    expect(specs.status).toBe(200);
    expect(specs.body.replaced).toBe(2);

    // Images: only READY, non-infected file objects.
    const fileId = await createReadyFile();
    const images = await request(app.getHttpServer())
      .post(`/api/v1/admin/products/${id}/images`)
      .set(auth)
      .send({ fileObjectIds: [fileId] });
    expect(images.status).toBe(200);
    expect(images.body.added).toBe(1);

    const missingFile = await request(app.getHttpServer())
      .post(`/api/v1/admin/products/${id}/images`)
      .set(auth)
      .send({ fileObjectIds: ['cmnoooooooo000000000000000'] });
    expect(missingFile.status).toBe(400);

    // Publish → appears in the public catalog.
    const shown = await request(app.getHttpServer())
      .patch(`/api/v1/admin/products/${id}/visibility`)
      .set(auth)
      .send({ visible: true });
    expect(shown.status).toBe(200);

    const publicDetail = await request(app.getHttpServer()).get(`/api/v1/public/products/${sku}`);
    expect(publicDetail.status).toBe(200);
    expect(publicDetail.body.images).toHaveLength(1);
    expect(publicDetail.body.specs.map((s: { key: string }) => s.key)).toEqual(
      expect.arrayContaining(['size', 'màu']),
    );

    // Hide again → disappears from public APIs.
    const hidden = await request(app.getHttpServer())
      .patch(`/api/v1/admin/products/${id}/visibility`)
      .set(auth)
      .send({ visible: false });
    expect(hidden.status).toBe(200);
    const goneDetail = await request(app.getHttpServer()).get(`/api/v1/public/products/${sku}`);
    expect(goneDetail.status).toBe(404);
  });

  it('public catalog never exposes priceRef or supplier fields', async () => {
    const category = await createCategory('Đồ chơi');
    const auth = { Authorization: `Bearer ${adminToken}` };
    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/products')
      .set(auth)
      .send({
        sku: makeSku(),
        name: 'Xe điều khiển',
        categoryId: category.id,
        moq: 4,
        priceRef: 199,
      });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/products/${id}/visibility`)
      .set(auth)
      .send({ visible: true });

    const list = await request(app.getHttpServer()).get('/api/v1/public/products');
    expect(list.status).toBe(200);
    const detail = await request(app.getHttpServer()).get(
      `/api/v1/public/products/${created.body.sku}`,
    );
    expect(detail.status).toBe(200);
    // Assert on the raw JSON: the fields must not exist anywhere.
    for (const body of [list.body, detail.body]) {
      const json = JSON.stringify(body).toLowerCase();
      expect(json).not.toContain('priceref');
      expect(json).not.toContain('supplier');
      expect(json).not.toContain('currency');
    }
  });

  it('public search is accent-insensitive and categories list product counts', async () => {
    const category = await createCategory('Thời trang mưa');
    const auth = { Authorization: `Bearer ${adminToken}` };
    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/products')
      .set(auth)
      .send({
        sku: makeSku(),
        name: 'Áo mưa trẻ em',
        categoryId: category.id,
        moq: 6,
        spec: 'PVC trong suốt',
      });
    const id = created.body.id as string;
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/products/${id}/visibility`)
      .set(auth)
      .send({ visible: true });

    const found = await request(app.getHttpServer()).get(
      '/api/v1/public/products?q=ao mua&category=' + category.slug,
    );
    expect(found.status).toBe(200);
    expect(found.body.items.map((item: { name: string }) => item.name)).toContain('Áo mưa trẻ em');

    const categories = await request(app.getHttpServer()).get('/api/v1/public/categories');
    expect(categories.status).toBe(200);
    const ours = (categories.body as Array<{ slug: string; productCount: number }>).find(
      (entry) => entry.slug === category.slug,
    );
    expect(ours?.productCount).toBeGreaterThanOrEqual(1);
  });

  it('publish sourcing case: completed order → public case without buyer/supplier data', async () => {
    const category = await createCategory('Túi xách');
    const auth = { Authorization: `Bearer ${adminToken}` };

    // Source product with images + specs, published.
    const source = await request(app.getHttpServer())
      .post('/api/v1/admin/products')
      .set(auth)
      .send({
        sku: makeSku(),
        name: 'Túi da công sở',
        categoryId: category.id,
        moq: 30,
        priceRef: 320_000,
        specs: [{ key: 'material', value: 'Da PU' }],
      });
    expect(source.status).toBe(201);
    const sourceId = source.body.id as string;
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/products/${sourceId}/visibility`)
      .set(auth)
      .send({ visible: true });

    const buyerUser = await prisma.user.findUniqueOrThrow({ where: { email: buyerEmail } });

    // Not completed yet → 422.
    const pendingOrder = await createOrder(buyerUser.id, 'NEGOTIATING');
    const tooEarly = await request(app.getHttpServer())
      .post(`/api/v1/admin/sourcing-cases/${pendingOrder.id}/publish`)
      .set(auth)
      .send({ productId: sourceId, name: 'Túi da công sở' });
    expect(tooEarly.status).toBe(422);

    const order = await createOrder(buyerUser.id, 'COMPLETED');
    const published = await request(app.getHttpServer())
      .post(`/api/v1/admin/sourcing-cases/${order.id}/publish`)
      .set(auth)
      .send({ productId: sourceId, name: 'Túi da công sở' });
    expect(published.status).toBe(200);
    expect(published.body.sku).toMatch(/^CVC-CASE-/);

    // Idempotent: publishing the same order again returns the same case.
    const again = await request(app.getHttpServer())
      .post(`/api/v1/admin/sourcing-cases/${order.id}/publish`)
      .set(auth)
      .send({ productId: sourceId, name: 'Túi da công sở' });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(published.body.id);

    // Public portfolio: sanitized payload only.
    const cases = await request(app.getHttpServer()).get('/api/v1/public/sourcing-cases');
    expect(cases.status).toBe(200);
    const json = JSON.stringify(cases.body).toLowerCase();
    expect(json).not.toContain('priceref');
    expect(json).not.toContain('supplier');
    expect(json).not.toContain('buyer');
    const caseItem = cases.body.items.find(
      (item: { sku: string }) => item.sku === published.body.sku,
    );
    expect(caseItem).toBeTruthy();
    expect(caseItem.name).toBe('Túi da công sở');
  });
});
