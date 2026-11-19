import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../app.module';
import { TokenService } from '../auth/token.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

// Integration tests for P4.11 (CVC concierge): sales files a request for a
// walk-in customer and opens one private order + Deal Room. Ports the backend
// behaviours of legacy concierge-tests.mjs. RUN_DB_TESTS=1 required.
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

const EMAIL_PREFIX = 'p4f-test-';
const SUPPLIER_PREFIX = 'P4F Supplier ';
const CATEGORY_PREFIX = 'p4f-cat-';
const SKU_PREFIX = 'P4F-';
const GUEST_DOMAIN = '@concierge.local';

let app: INestApplication;
let prisma: PrismaService;
let tokens: TokenService;
let realtime: RealtimeService;

interface TestUser {
  id: string;
  email: string;
  accessToken: string;
}

interface SupplierFixture {
  id: string;
  user: TestUser;
}

let buyer: TestUser;
let sales: TestUser;
let admin: TestUser;
let supMatched: SupplierFixture;
let supOther: SupplierFixture;
let categoryId: string;
let guestPhone: string;

function makeEmail(): string {
  return `${EMAIL_PREFIX}${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`;
}

async function createUser(roles: string[]): Promise<TestUser> {
  const email = makeEmail();
  const user = await prisma.user.create({
    data: { email, passwordHash: 'x', emailVerifiedAt: new Date(), status: 'ACTIVE' },
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
  return {
    id: user.id,
    email,
    accessToken: tokens.accessToken({ sub: user.id, email, sid: sessionId, role: roles[0] }),
  };
}

async function cleanup(): Promise<void> {
  const testUsers = await prisma.user.findMany({
    where: {
      OR: [{ email: { startsWith: EMAIL_PREFIX } }, { email: { endsWith: GUEST_DOMAIN } }],
    },
    select: { id: true },
  });
  const userIds = testUsers.map((user) => user.id);
  const suppliers = await prisma.supplier.findMany({
    where: { name: { startsWith: SUPPLIER_PREFIX } },
    select: { id: true },
  });
  const supplierIds = suppliers.map((supplier) => supplier.id);
  const requests = await prisma.sourcingRequest.findMany({
    where: { buyerId: { in: userIds } },
    select: { id: true },
  });
  const requestIds = requests.map((row) => row.id);

  await prisma.order.deleteMany({
    where: { OR: [{ buyerId: { in: userIds } }, { supplierId: { in: supplierIds } }] },
  });
  await prisma.dealRoom.deleteMany({ where: { sourcingRequestId: { in: requestIds } } });
  await prisma.sourcingRequest.deleteMany({ where: { buyerId: { in: userIds } } });
  await prisma.supplierProduct.deleteMany({ where: { supplierId: { in: supplierIds } } });
  await prisma.product.deleteMany({ where: { sku: { startsWith: SKU_PREFIX } } });
  await prisma.supplier.deleteMany({ where: { name: { startsWith: SUPPLIER_PREFIX } } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: CATEGORY_PREFIX } } });
  await prisma.user.deleteMany({
    where: {
      OR: [{ email: { startsWith: EMAIL_PREFIX } }, { email: { endsWith: GUEST_DOMAIN } }],
    },
  });
}

describeDb('CVC concierge (P4.11)', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
    realtime = app.get(RealtimeService);
    await cleanup();

    buyer = await createUser(['buyer']);
    sales = await createUser(['sales']);
    admin = await createUser(['admin']);
    guestPhone = `09${String(Date.now()).slice(-8)}`;

    const category = await prisma.category.create({
      data: { name: 'P4F Test Category', slug: `${CATEGORY_PREFIX}${Date.now()}` },
    });
    categoryId = category.id;
    const product = await prisma.product.create({
      data: {
        categoryId,
        sku: `${SKU_PREFIX}${Date.now()}`,
        name: 'P4F Sản phẩm mẫu',
        priceRef: 120_000,
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });

    const makeSupplier = async (suffix: string): Promise<SupplierFixture> => {
      const supplier = await prisma.supplier.create({
        data: { name: `${SUPPLIER_PREFIX}${suffix}` },
      });
      const user = await createUser(['supplier']);
      await prisma.supplierAccount.create({
        data: { userId: user.id, supplierId: supplier.id, isPrimary: true },
      });
      return { id: supplier.id, user };
    };
    supMatched = await makeSupplier('Matched');
    supOther = await makeSupplier('Other');
    // Only the matched supplier has an approved listing in the category.
    await prisma.supplierProduct.create({
      data: {
        supplierId: supMatched.id,
        productId: product.id,
        costPrice: 80_000,
        approvedAt: new Date(),
      },
    });
  }, 90_000);

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.accessToken}` });
  const api = () => request(app.getHttpServer());

  async function conciergeRequest(overrides: Record<string, unknown> = {}) {
    const created = await api()
      .post('/api/v1/admin/concierge/requests')
      .set(auth(sales))
      .send({
        buyerName: 'Khách DEMO',
        buyerPhone: guestPhone,
        title: 'P4F Kính theo yêu cầu',
        content: 'Pin 8 giờ, khắc logo riêng',
        quantity: 100,
        ...overrides,
      });
    expect(created.status).toBe(201);
    return created.body as {
      id: string;
      requestNo: string;
      status: string;
      workflow: string;
      targetPrice: unknown;
      quoteCount: number;
      dealRoomId: string | null;
      buyer: { id: string };
    };
  }

  it('RBAC: only CVC staff use concierge endpoints', async () => {
    expect(
      (
        await api()
          .post('/api/v1/admin/concierge/requests')
          .set(auth(buyer))
          .send({ buyerName: 'X', title: 'X', quantity: 1 })
      ).status,
    ).toBe(403);
    expect(
      (
        await api()
          .post('/api/v1/admin/concierge/rooms')
          .set(auth(supMatched.user))
          .send({ requestId: 'ckx0000000000000000000000' })
      ).status,
    ).toBe(403);
    expect((await api().post('/api/v1/admin/concierge/requests')).status).toBe(401);
  });

  it('accepts a guest request without budget, creates no order and reuses the phone', async () => {
    const created = await conciergeRequest();

    expect(created.workflow).toBe('CONCIERGE');
    expect(created.targetPrice).toBeNull();
    expect(created.quoteCount).toBe(0);
    expect(created.dealRoomId).toBeNull();
    expect(created.status).toBe('OPEN');

    // Guest buyer exists with the buyer role; contact data sits on the request.
    const guest = await prisma.user.findUnique({
      where: { id: created.buyer.id },
      select: { email: true, phone: true, userRoles: { select: { role: true } } },
    });
    expect(guest!.email.endsWith(GUEST_DOMAIN)).toBe(true);
    expect(guest!.phone).toBe(guestPhone);
    expect(guest!.userRoles.map((row) => row.role)).toContain('buyer');

    const detail = await api()
      .get(`/api/v1/admin/sourcing-requests/${created.id}`)
      .set(auth(sales));
    expect(detail.body.contactName).toBe('Khách DEMO');
    expect(detail.body.contactPhone).toBe(guestPhone);

    // No budget + no category ⇒ CVC keeps the request, opens no order.
    const room = await api()
      .post('/api/v1/admin/concierge/rooms')
      .set(auth(sales))
      .send({ requestId: created.id });
    expect(room.status).toBe(409);
    expect(room.body.code).toBe('NO_MATCHING_SUPPLIER');
    expect(await prisma.order.count({ where: { sourcingRequestId: created.id } })).toBe(0);
    expect((await prisma.sourcingRequest.findUnique({ where: { id: created.id } }))!.status).toBe(
      'OPEN',
    );

    // Same phone ⇒ same buyer, no duplicate guest.
    const second = await conciergeRequest({ title: 'P4F Yêu cầu thứ hai' });
    expect(second.buyer.id).toBe(created.buyer.id);
  });

  it('matches a supplier and opens one private room, idempotently, without role changes', async () => {
    const created = await conciergeRequest({
      categoryId,
      targetPrice: 150_000,
      startExperience: false,
    });

    // Unrelated legacy order must stay untouched by the concierge flow.
    const legacy = await prisma.order.create({
      data: {
        orderNo: `P4F-LEGACY-${Date.now()}`,
        buyerId: created.buyer.id,
        supplierId: supOther.id,
        status: 'PRODUCTION',
        stageIndex: 4,
        totalAmount: 777_000,
        currency: 'VND',
      },
    });

    const opened = await api()
      .post('/api/v1/admin/concierge/rooms')
      .set(auth(sales))
      .send({ requestId: created.id });
    expect(opened.status).toBe(200);
    expect(opened.body.order.status).toBe('NEGOTIATING');
    expect(opened.body.supplier.id).toBe(supMatched.id);
    expect(Number(opened.body.order.totalAmount)).toBe(150_000 * 100);
    expect(opened.body.dealRoomId).toBeTruthy();

    // P4.12: opening the room grants realtime membership to the buyer; an
    // unrelated supplier cannot join the room.
    const buyerJoin = await realtime.assertCanJoin(
      { sub: created.buyer.id, email: 'guest@concierge.local', sid: 'test', role: 'buyer' },
      `dealRoom:${opened.body.dealRoomId}`,
    );
    expect(buyerJoin).toEqual({ ok: true });
    const outsiderJoin = await realtime.assertCanJoin(
      { sub: supOther.user.id, email: supOther.user.email, sid: 'test', role: 'supplier' },
      `dealRoom:${opened.body.dealRoomId}`,
    );
    expect(outsiderJoin.ok).toBe(false);

    // Idempotent: same order, no second room/order.
    const again = await api()
      .post('/api/v1/admin/concierge/rooms')
      .set(auth(sales))
      .send({ requestId: created.id });
    expect(again.status).toBe(200);
    expect(again.body.idempotent).toBe(true);
    expect(again.body.order.id).toBe(opened.body.order.id);
    expect(await prisma.order.count({ where: { sourcingRequestId: created.id } })).toBe(1);

    // Intro message names the supplier inside the private room.
    const message = await prisma.message.findFirst({
      where: { roomId: opened.body.dealRoomId },
      orderBy: { createdAt: 'asc' },
    });
    expect(message!.body).toContain(`${SUPPLIER_PREFIX}Matched`);

    // Room members: buyer, sales actor, supplier account.
    const members = await prisma.dealRoomMember.findMany({
      where: { roomId: opened.body.dealRoomId },
      select: { userId: true, role: true },
    });
    const roles = new Map(members.map((member) => [member.userId, member.role]));
    expect(roles.get(created.buyer.id)).toBe('buyer');
    expect(roles.get(sales.id)).toBe('sales');
    expect(roles.get(supMatched.user.id)).toBe('supplier');

    // Supplier/buyer notifications never name the supplier.
    const supplierNote = await prisma.notification.findFirst({
      where: { userId: supMatched.user.id, event: 'sourcing.room_opened' },
      orderBy: { createdAt: 'desc' },
    });
    expect(supplierNote).toBeTruthy();
    expect(supplierNote!.body).not.toContain(SUPPLIER_PREFIX);
    const buyerNote = await prisma.notification.findFirst({
      where: { userId: created.buyer.id, event: 'sourcing.room_ready' },
      orderBy: { createdAt: 'desc' },
    });
    expect(buyerNote).toBeTruthy();
    expect(buyerNote!.body).not.toContain(SUPPLIER_PREFIX);

    // Operator role is untouched and the legacy order is unchanged.
    const salesRoles = await prisma.userRole.findMany({
      where: { userId: sales.id },
      select: { role: true },
    });
    expect(salesRoles.map((row) => row.role)).toEqual(['sales']);
    const legacyAfter = await prisma.order.findUnique({ where: { id: legacy.id } });
    expect(legacyAfter!.status).toBe('PRODUCTION');
    expect(legacyAfter!.totalAmount.toString()).toBe('777000');

    // Request is converted and the buyer view exposes the room, no source.
    const state = await prisma.sourcingRequest.findUnique({ where: { id: created.id } });
    expect(state!.status).toBe('CONVERTED');
  });

  it('connects the exact reviewed quote and keeps the buyer view source-free', async () => {
    const created = await api().post('/api/v1/admin/concierge/requests').set(auth(sales)).send({
      buyerId: buyer.id,
      title: 'P4F Yêu cầu có báo giá',
      quantity: 100,
      categoryId,
    });
    expect(created.status).toBe(201);
    const requestId = created.body.id as string;

    await api()
      .post(`/api/v1/admin/sourcing-requests/${requestId}/invite`)
      .set(auth(sales))
      .send({ supplierIds: [supOther.id] });
    const quoteMatched = await api()
      .post(`/api/v1/supplier/requests/${requestId}/quotes`)
      .set(auth(supMatched.user))
      .send({ unitPrice: 80_000, moq: 50, leadTimeDays: 20, deliveryTerms: 'FOB' });
    expect(quoteMatched.status).toBe(201);
    const quoteOther = await api()
      .post(`/api/v1/supplier/requests/${requestId}/quotes`)
      .set(auth(supOther.user))
      .send({ unitPrice: 90_000, moq: 50, leadTimeDays: 15, deliveryTerms: 'CIF' });
    expect(quoteOther.status).toBe(201);

    // Sales reviews and connects the exact quote (not the cheaper one).
    const opened = await api()
      .post('/api/v1/admin/concierge/rooms')
      .set(auth(admin))
      .send({ requestId, quoteId: quoteOther.body.id });
    expect(opened.status).toBe(200);
    expect(opened.body.supplier.id).toBe(supOther.id);
    expect(Number(opened.body.order.totalAmount)).toBe(90_000 * 100);

    const quotes = await prisma.quote.findMany({
      where: { requestId },
      select: { id: true, status: true },
    });
    expect(quotes.find((row) => row.id === quoteOther.body.id)!.status).toBe('SELECTED');
    expect(quotes.find((row) => row.id === quoteMatched.body.id)!.status).toBe('REJECTED');
    const selection = await prisma.quoteSelection.findUnique({ where: { requestId } });
    expect(selection!.quoteId).toBe(quoteOther.body.id);
    expect(selection!.decidedById).toBe(admin.id);

    // Buyer view: room link only, no supplier names, no internal notes.
    const buyerDetail = await api().get(`/api/v1/sourcing-requests/${requestId}`).set(auth(buyer));
    expect(buyerDetail.status).toBe(200);
    expect(buyerDetail.body.dealRoomId).toBe(opened.body.dealRoomId);
    expect(buyerDetail.body.workflow).toBe('CONCIERGE');
    const serialized = JSON.stringify(buyerDetail.body);
    expect(serialized).not.toContain(SUPPLIER_PREFIX);
    expect(serialized).not.toContain('90_000');
    expect(buyerDetail.body.internalNotes).toBeUndefined();
  });

  it('starts the guided experience for a buyer request in the same call (startSourcingExperience)', async () => {
    const created = await api().post('/api/v1/sourcing-requests').set(auth(buyer)).send({
      title: 'P4F Trải nghiệm tức thì',
      quantity: 50,
      categoryId,
      startExperience: true,
    });
    expect(created.status).toBe(201);
    expect(created.body.workflow).toBe('CONCIERGE');
    expect(created.body.dealRoomId).toBeTruthy();
    expect(created.body.order.status).toBe('NEGOTIATING');
    const requestId = created.body.id as string;

    const detail = await api().get(`/api/v1/sourcing-requests/${requestId}`).set(auth(buyer));
    expect(detail.body.dealRoomId).toBe(created.body.dealRoomId);
    expect(JSON.stringify(detail.body)).not.toContain(SUPPLIER_PREFIX);
    expect(await prisma.order.count({ where: { sourcingRequestId: requestId } })).toBe(1);

    // No match available ⇒ 409, but the request is kept for CVC.
    const orphan = await api()
      .post('/api/v1/sourcing-requests')
      .set(auth(buyer))
      .send({ title: 'P4F Không có nguồn', quantity: 10, startExperience: true });
    expect(orphan.status).toBe(409);
    expect(orphan.body.code).toBe('NO_MATCHING_SUPPLIER');
    const kept = await prisma.sourcingRequest.findFirst({
      where: { buyerId: buyer.id, title: 'P4F Không có nguồn' },
    });
    expect(kept).toBeTruthy();
    expect(kept!.status).toBe('OPEN');
    expect(await prisma.order.count({ where: { sourcingRequestId: kept!.id } })).toBe(0);
  });
});
