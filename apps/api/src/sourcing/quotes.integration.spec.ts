import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../app.module';
import { TokenService } from '../auth/token.service';
import { PrismaService } from '../prisma/prisma.service';

// Integration tests for P4.9 (supplier quoting) and P4.10 (buyer compares and
// selects a quote → order + deal room). RUN_DB_TESTS=1 required.
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

const EMAIL_PREFIX = 'p4e-test-';
const SUPPLIER_PREFIX = 'P4E Supplier ';
const CATEGORY_PREFIX = 'p4e-cat-';
const SKU_PREFIX = 'P4E-';

let app: INestApplication;
let prisma: PrismaService;
let tokens: TokenService;

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
let supA: SupplierFixture;
let supB: SupplierFixture;
let supC: SupplierFixture;
let categoryId: string;

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
    where: { email: { startsWith: EMAIL_PREFIX } },
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
  await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
}

describeDb('Supplier quotes + quote selection (P4.9/P4.10)', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
    await cleanup();

    buyer = await createUser(['buyer']);
    sales = await createUser(['sales']);
    admin = await createUser(['admin']);

    const category = await prisma.category.create({
      data: {
        name: 'P4E Test Category',
        slug: `${CATEGORY_PREFIX}${Date.now()}`,
      },
    });
    categoryId = category.id;

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
    supA = await makeSupplier('A');
    supB = await makeSupplier('B');
    supC = await makeSupplier('C');

    // B has an approved listing in the RFQ category → sees matching RFQs.
    const product = await prisma.product.create({
      data: {
        categoryId,
        sku: `${SKU_PREFIX}${Date.now()}`,
        name: 'P4E Bình giữ nhiệt',
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });
    await prisma.supplierProduct.create({
      data: {
        supplierId: supB.id,
        productId: product.id,
        costPrice: 30_000,
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

  async function createRequest(overrides: Record<string, unknown> = {}) {
    const created = await api()
      .post('/api/v1/sourcing-requests')
      .set(auth(buyer))
      .send({
        title: 'P4E Tìm nguồn túi vải',
        content: 'In 2 màu, 300 cái',
        quantity: 300,
        ...overrides,
      });
    expect(created.status).toBe(201);
    return created.body as { id: string; requestNo: string; status: string };
  }

  function quotePayload(overrides: Record<string, unknown> = {}) {
    return {
      unitPrice: 55_500,
      currency: 'VND',
      moq: 100,
      leadTimeDays: 20,
      deliveryTerms: 'FOB Thâm Quyến',
      note: 'Giá đã gồm in 2 màu',
      ...overrides,
    };
  }

  it('RBAC: suppliers quote, buyers compare; roles never overlap', async () => {
    const requestId = (await createRequest()).id;

    // Suppliers cannot create RFQs or use the sales intake API.
    expect(
      (
        await api()
          .post('/api/v1/sourcing-requests')
          .set(auth(supA.user))
          .send({ title: 'P4E Không được tạo', quantity: 10 })
      ).status,
    ).toBe(403);
    expect((await api().get('/api/v1/admin/sourcing-requests').set(auth(supA.user))).status).toBe(
      403,
    );
    // Buyers cannot use the supplier portal.
    expect((await api().get('/api/v1/supplier/requests').set(auth(buyer))).status).toBe(403);
    expect((await api().get('/api/v1/supplier/requests')).status).toBe(401);
    // Buyers cannot use the sales intake API either.
    expect((await api().get('/api/v1/admin/sourcing-requests').set(auth(buyer))).status).toBe(403);
    // Suppliers can list their requests.
    expect((await api().get('/api/v1/supplier/requests').set(auth(supA.user))).status).toBe(200);
    expect(requestId).toBeTruthy();
  });

  it('invited supplier sees the RFQ; an uninvited, non-matching supplier does not (DoD)', async () => {
    const requestId = (await createRequest()).id;

    const beforeInvite = await api().get('/api/v1/supplier/requests').set(auth(supA.user));
    expect(beforeInvite.status).toBe(200);
    expect(beforeInvite.body.items.map((item: { id: string }) => item.id)).not.toContain(requestId);

    const invited = await api()
      .post(`/api/v1/admin/sourcing-requests/${requestId}/invite`)
      .set(auth(sales))
      .send({ supplierIds: [supA.id] });
    expect(invited.status).toBe(200);

    const afterInvite = await api().get('/api/v1/supplier/requests').set(auth(supA.user));
    const row = afterInvite.body.items.find((item: { id: string }) => item.id === requestId);
    expect(row).toBeTruthy();
    expect(row.invited).toBe(true);
    expect(row.myQuote).toBeNull();

    // B is not invited and this RFQ has no category → invisible + unquotable.
    const bList = await api().get('/api/v1/supplier/requests').set(auth(supB.user));
    expect(bList.body.items.map((item: { id: string }) => item.id)).not.toContain(requestId);
    expect(
      (
        await api()
          .post(`/api/v1/supplier/requests/${requestId}/quotes`)
          .set(auth(supB.user))
          .send(quotePayload())
      ).status,
    ).toBe(404);
  });

  it('category matching lets a supplier see RFQs without an invite', async () => {
    const requestId = (await createRequest({ categoryId })).id;

    const listB = await api().get('/api/v1/supplier/requests').set(auth(supB.user));
    const row = listB.body.items.find((item: { id: string }) => item.id === requestId);
    expect(row).toBeTruthy();
    expect(row.invited).toBe(false);
    expect(row.category.id).toBe(categoryId);

    // C has no approved listing in that category → still invisible.
    const listC = await api().get('/api/v1/supplier/requests').set(auth(supC.user));
    expect(listC.body.items.map((item: { id: string }) => item.id)).not.toContain(requestId);
  });

  it('validates quotes, updates once per supplier, withdraws and re-quotes', async () => {
    const requestId = (await createRequest()).id;
    await api()
      .post(`/api/v1/admin/sourcing-requests/${requestId}/invite`)
      .set(auth(sales))
      .send({ supplierIds: [supA.id] });

    const invalid = [
      quotePayload({ moq: 301 }), // MOQ above requested quantity
      quotePayload({ unitPrice: 0 }),
      quotePayload({ moq: 1.5 }),
      quotePayload({ leadTimeDays: -1 }),
      quotePayload({ validUntil: new Date(Date.now() - 86_400_000).toISOString() }),
    ];
    for (const payload of invalid) {
      const res = await api()
        .post(`/api/v1/supplier/requests/${requestId}/quotes`)
        .set(auth(supA.user))
        .send(payload);
      expect(res.status).toBe(400);
    }

    const created = await api()
      .post(`/api/v1/supplier/requests/${requestId}/quotes`)
      .set(auth(supA.user))
      .send(quotePayload({ unitPrice: 55_000 }));
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('SUBMITTED');
    expect(created.body.moq).toBe(100);
    const quoteId = created.body.id as string;

    // One quote per supplier: posting again updates the same row.
    const again = await api()
      .post(`/api/v1/supplier/requests/${requestId}/quotes`)
      .set(auth(supA.user))
      .send(quotePayload({ unitPrice: 54_000 }));
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(quoteId);
    expect(Number(again.body.unitPrice)).toBe(54_000);
    expect(await prisma.quote.count({ where: { requestId, supplierId: supA.id } })).toBe(1);

    const listed = await api().get('/api/v1/supplier/requests').set(auth(supA.user));
    const row = listed.body.items.find((item: { id: string }) => item.id === requestId);
    expect(row.myQuote.id).toBe(quoteId);
    // Supplier payload never exposes other suppliers' quotes.
    expect(row).not.toHaveProperty('quoteCount');

    // Another supplier cannot touch this quote (404, no ownership leak).
    const cross = await api()
      .put(`/api/v1/supplier/quotes/${quoteId}`)
      .set(auth(supB.user))
      .send({ unitPrice: 1 });
    expect(cross.status).toBe(404);

    const updated = await api()
      .put(`/api/v1/supplier/quotes/${quoteId}`)
      .set(auth(supA.user))
      .send({ unitPrice: 53_000, leadTimeDays: 18 });
    expect(updated.status).toBe(200);
    expect(Number(updated.body.unitPrice)).toBe(53_000);
    expect(updated.body.leadTimeDays).toBe(18);

    // Quote → RFQ becomes QUOTED; withdrawing the last quote reopens it.
    const detail = await api().get(`/api/v1/sourcing-requests/${requestId}`).set(auth(buyer));
    expect(detail.body.status).toBe('QUOTED');

    const withdrawn = await api()
      .post(`/api/v1/supplier/quotes/${quoteId}/withdraw`)
      .set(auth(supA.user));
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.status).toBe('WITHDRAWN');
    const reopened = await api().get(`/api/v1/sourcing-requests/${requestId}`).set(auth(buyer));
    expect(reopened.body.status).toBe('OPEN');

    const requoted = await api()
      .post(`/api/v1/supplier/requests/${requestId}/quotes`)
      .set(auth(supA.user))
      .send(quotePayload({ unitPrice: 52_000 }));
    expect(requoted.status).toBe(201);
    expect(requoted.body.id).toBe(quoteId);
    expect(requoted.body.status).toBe('SUBMITTED');
    expect(await prisma.quote.count({ where: { requestId, supplierId: supA.id } })).toBe(1);
  });

  it('expired RFQ accepts no quotes and cannot be selected (DoD)', async () => {
    const requestId = (
      await createRequest({
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        categoryId,
      })
    ).id;
    await api()
      .post(`/api/v1/admin/sourcing-requests/${requestId}/invite`)
      .set(auth(sales))
      .send({ supplierIds: [supA.id] });

    const quote = await api()
      .post(`/api/v1/supplier/requests/${requestId}/quotes`)
      .set(auth(supA.user))
      .send(quotePayload());
    expect(quote.status).toBe(201);
    const quoteId = quote.body.id as string;

    await prisma.sourcingRequest.update({
      where: { id: requestId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const newQuote = await api()
      .post(`/api/v1/supplier/requests/${requestId}/quotes`)
      .set(auth(supB.user))
      .send(quotePayload());
    expect(newQuote.status).toBe(409);

    const edited = await api()
      .put(`/api/v1/supplier/quotes/${quoteId}`)
      .set(auth(supA.user))
      .send({ unitPrice: 40_000 });
    expect(edited.status).toBe(409);

    const supplierList = await api().get('/api/v1/supplier/requests').set(auth(supA.user));
    expect(supplierList.body.items.map((item: { id: string }) => item.id)).not.toContain(requestId);

    const select = await api()
      .post(`/api/v1/sourcing-requests/${requestId}/select-quote`)
      .set(auth(buyer))
      .send({ quoteId });
    expect(select.status).toBe(409);
    expect(await prisma.order.count({ where: { sourcingRequestId: requestId } })).toBe(0);
  });

  it('buyer compares quotes and selects one → one order + deal room (DoD idempotent)', async () => {
    const requestId = (await createRequest({ categoryId })).id;
    await api()
      .post(`/api/v1/admin/sourcing-requests/${requestId}/invite`)
      .set(auth(sales))
      .send({ supplierIds: [supA.id] });
    await api()
      .post(`/api/v1/admin/sourcing-requests/${requestId}/assign`)
      .set(auth(admin))
      .send({ assigneeId: sales.id, slaDueAt: new Date(Date.now() + 3_600_000).toISOString() });

    const quoteA = await api()
      .post(`/api/v1/supplier/requests/${requestId}/quotes`)
      .set(auth(supA.user))
      .send(quotePayload({ unitPrice: 58_000, moq: 150 }));
    expect(quoteA.status).toBe(201);
    const quoteB = await api()
      .post(`/api/v1/supplier/requests/${requestId}/quotes`)
      .set(auth(supB.user))
      .send(quotePayload({ unitPrice: 45_500, moq: 100, leadTimeDays: 12 }));
    expect(quoteB.status).toBe(201);

    const compare = await api()
      .get(`/api/v1/sourcing-requests/${requestId}/quotes`)
      .set(auth(buyer));
    expect(compare.status).toBe(200);
    expect(compare.body.quotes).toHaveLength(2);
    // Sorted by unit price; comparison columns are all present.
    expect(compare.body.quotes[0].id).toBe(quoteB.body.id);
    expect(compare.body.quotes[0].moq).toBe(100);
    expect(compare.body.quotes[0].leadTimeDays).toBe(12);
    expect(compare.body.quotes[0].validUntil).toBeNull();
    expect(compare.body.quotes[0].deliveryTerms).toBe('FOB Thâm Quyến');

    const selected = await api()
      .post(`/api/v1/sourcing-requests/${requestId}/select-quote`)
      .set(auth(buyer))
      .send({ quoteId: quoteB.body.id, note: 'Chốt nhà máy B' });
    expect(selected.status).toBe(200);
    expect(selected.body.idempotent).toBe(false);
    expect(selected.body.order.status).toBe('NEGOTIATING');
    expect(Number(selected.body.order.totalAmount)).toBe(45_500 * 300);
    expect(selected.body.dealRoomId).toBeTruthy();
    const orderId = selected.body.order.id as string;

    // Selecting twice creates no second order.
    const again = await api()
      .post(`/api/v1/sourcing-requests/${requestId}/select-quote`)
      .set(auth(buyer))
      .send({ quoteId: quoteB.body.id });
    expect(again.status).toBe(200);
    expect(again.body.idempotent).toBe(true);
    expect(again.body.order.id).toBe(orderId);
    expect(await prisma.order.count({ where: { sourcingRequestId: requestId } })).toBe(1);

    // Other quote cannot be selected afterwards; no more quotes accepted.
    const other = await api()
      .post(`/api/v1/sourcing-requests/${requestId}/select-quote`)
      .set(auth(buyer))
      .send({ quoteId: quoteA.body.id });
    expect(other.status).toBe(409);
    expect(
      (
        await api()
          .post(`/api/v1/supplier/requests/${requestId}/quotes`)
          .set(auth(supA.user))
          .send(quotePayload())
      ).status,
    ).toBe(409);

    const state = await prisma.sourcingRequest.findUnique({ where: { id: requestId } });
    expect(state!.status).toBe('CONVERTED');
    const statuses = await prisma.quote.findMany({
      where: { requestId },
      select: { id: true, status: true },
    });
    expect(statuses.find((row) => row.id === quoteB.body.id)!.status).toBe('SELECTED');
    expect(statuses.find((row) => row.id === quoteA.body.id)!.status).toBe('REJECTED');

    // Deal room members: buyer, assigned sales, winning supplier account.
    const roomMembers = await prisma.dealRoomMember.findMany({
      where: { roomId: selected.body.dealRoomId },
      select: { userId: true, role: true },
    });
    const roles = new Map(roomMembers.map((member) => [member.userId, member.role]));
    expect(roles.get(buyer.id)).toBe('buyer');
    expect(roles.get(sales.id)).toBe('sales');
    expect(roles.get(supB.user.id)).toBe('supplier');

    // Winner and losers are notified.
    expect(
      await prisma.notification.findFirst({
        where: { userId: supB.user.id, event: 'sourcing.quote_selected' },
      }),
    ).toBeTruthy();
    expect(
      await prisma.notification.findFirst({
        where: { userId: supA.user.id, event: 'sourcing.quote_rejected' },
      }),
    ).toBeTruthy();
    // Buyer was told about the incoming quote.
    expect(
      await prisma.notification.findFirst({
        where: { userId: buyer.id, event: 'sourcing.quote_received' },
      }),
    ).toBeTruthy();
  });

  it('reuses an existing deal room and preserves pre-existing buyer orders', async () => {
    const requestId = (await createRequest({ categoryId })).id;
    const room = await prisma.dealRoom.create({
      data: { sourcingRequestId: requestId, title: 'Phòng tư vấn trước đó' },
    });
    await prisma.dealRoomMember.create({
      data: { roomId: room.id, userId: buyer.id, role: 'buyer' },
    });
    const quote = await api()
      .post(`/api/v1/supplier/requests/${requestId}/quotes`)
      .set(auth(supB.user))
      .send(quotePayload({ unitPrice: 42_000 }));
    expect(quote.status).toBe(201);

    // Legacy order created before selection must stay untouched.
    const legacy = await prisma.order.create({
      data: {
        orderNo: `P4E-ORD-${Date.now()}`,
        buyerId: buyer.id,
        supplierId: supA.id,
        status: 'PRODUCTION',
        stageIndex: 4,
        totalAmount: 1_234_567,
        currency: 'VND',
        note: 'Đơn cũ giữ nguyên',
      },
    });
    const before = await prisma.order.findUnique({ where: { id: legacy.id } });

    const selected = await api()
      .post(`/api/v1/sourcing-requests/${requestId}/select-quote`)
      .set(auth(buyer))
      .send({ quoteId: quote.body.id });
    expect(selected.status).toBe(200);
    expect(selected.body.dealRoomId).toBe(room.id);

    const after = await prisma.order.findUnique({ where: { id: legacy.id } });
    expect(after!.note).toBe(before!.note);
    expect(after!.status).toBe(before!.status);
    expect(after!.stageIndex).toBe(before!.stageIndex);
    expect(after!.totalAmount.toString()).toBe(before!.totalAmount.toString());
    expect(after!.updatedAt).toEqual(before!.updatedAt);

    const linkedRoom = await prisma.dealRoom.findUnique({ where: { id: room.id } });
    expect(linkedRoom!.orderId).toBe(selected.body.order.id);
    expect(await prisma.dealRoom.count({ where: { sourcingRequestId: requestId } })).toBe(1);
    // Pre-existing member plus the winning supplier.
    const memberIds = await prisma.dealRoomMember.findMany({
      where: { roomId: room.id },
      select: { userId: true },
    });
    expect(memberIds.map((member) => member.userId)).toEqual(
      expect.arrayContaining([buyer.id, supB.user.id]),
    );
  });
});
