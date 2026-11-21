import { randomUUID } from 'node:crypto';

import { orderStageIndex, type OrderStatusCode } from '@cvc/shared';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type OrderStatus } from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../app.module';
import { TokenService } from '../auth/token.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

// P4.17 integration — the full sample loop, wrong-status transitions, role
// separation, the revision cap setting and the "approved is terminal" DoD.
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

const EMAIL_PREFIX = 'p4l-test-';
const SUPPLIER_PREFIX = 'P4L Supplier ';
const ORDER_PREFIX = 'P4L-';
const SETTING_KEY = 'samples.maxRevisionRounds';

let app: INestApplication;
let prisma: PrismaService;
let tokens: TokenService;
let redis: RedisService;

interface TestUser {
  id: string;
  email: string;
  accessToken: string;
}

let buyer: TestUser;
let supplierUser: TestUser;
let sales: TestUser;
let admin: TestUser;
let outsider: TestUser;
let supplierId: string;

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
  await prisma.order.deleteMany({ where: { orderNo: { startsWith: ORDER_PREFIX } } });
  const suppliers = await prisma.supplier.findMany({
    where: { name: { startsWith: SUPPLIER_PREFIX } },
    select: { id: true },
  });
  await prisma.supplier.deleteMany({ where: { id: { in: suppliers.map((row) => row.id) } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
}

describeDb('Production samples (P4.17)', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
    redis = app.get(RedisService);
    await cleanup();

    buyer = await createUser(['buyer']);
    supplierUser = await createUser(['supplier']);
    sales = await createUser(['sales']);
    admin = await createUser(['admin']);
    outsider = await createUser(['buyer']);

    const supplier = await prisma.supplier.create({
      data: { name: `${SUPPLIER_PREFIX}${Date.now()}`, status: 'ACTIVE' },
    });
    supplierId = supplier.id;
    await prisma.supplierAccount.create({
      data: { userId: supplierUser.id, supplierId, isPrimary: true },
    });
  }, 90_000);

  afterAll(async () => {
    await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEY } });
    await redis.del(`setting:${SETTING_KEY}`).catch(() => undefined);
    await cleanup();
    await app.close();
  });

  const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.accessToken}` });
  const api = () => request(app.getHttpServer());

  async function createOrder(status: OrderStatus = 'SAMPLING') {
    return prisma.order.create({
      data: {
        orderNo: `${ORDER_PREFIX}${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`,
        buyerId: buyer.id,
        supplierId,
        status,
        stageIndex: orderStageIndex(status as OrderStatusCode),
        totalAmount: 2_000_000,
        depositAmount: 1_000_000,
        currency: 'VND',
      },
    });
  }

  function requestSample(orderId: string, user: TestUser, body: Record<string, unknown> = {}) {
    return api().post(`/api/v1/orders/${orderId}/samples`).set(auth(user)).send(body);
  }

  function act(
    sampleId: string,
    action: string,
    user: TestUser,
    body: Record<string, unknown> = {},
  ) {
    return api().post(`/api/v1/samples/${sampleId}/${action}`).set(auth(user)).send(body);
  }

  it('runs requested → uploaded → sent → in_transit → delivered → revision → approved', async () => {
    const order = await createOrder();
    const created = await requestSample(order.id, buyer, {
      note: 'Mẫu hộp quà',
      feeAmount: 50_000,
    });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('REQUESTED');
    expect(Number(created.body.feeAmount)).toBe(50_000);
    expect(created.body.round).toBe(1);
    const sampleId = created.body.id as string;

    expect((await api().get(`/api/v1/samples/${sampleId}`).set(auth(outsider))).status).toBe(404);
    expect((await api().get(`/api/v1/samples/${sampleId}`).set(auth(buyer))).status).toBe(200);

    const uploaded = await act(sampleId, 'upload', supplierUser, { note: 'Ảnh mẫu vòng 1' });
    expect(uploaded.status).toBe(200);
    expect(uploaded.body.status).toBe('UPLOADED');

    const shipped = await act(sampleId, 'ship', supplierUser, {
      carrier: 'DHL',
      trackingNo: 'SMP-001',
      trackingUrl: 'https://track.example.com/SMP-001',
    });
    expect(shipped.status).toBe(200);
    expect(shipped.body.status).toBe('SENT');
    expect(shipped.body.stops).toHaveLength(1);

    const moving = await act(sampleId, 'stops', supplierUser, {
      type: 'IN_TRANSIT',
      description: 'Đã lên máy bay',
      location: 'Sân bay Tân Sơn Nhất',
    });
    expect(moving.status).toBe(201);
    expect(moving.body.status).toBe('IN_TRANSIT');

    const customs = await act(sampleId, 'stops', sales, {
      type: 'CUSTOMS',
      description: 'Thông quan',
    });
    expect(customs.status).toBe(201);
    expect(customs.body.status).toBe('IN_TRANSIT');
    expect(customs.body.stops).toHaveLength(3);
    expect((customs.body.stops as Array<{ enteredById: string }>)[2].enteredById).toBe(sales.id);

    const received = await act(sampleId, 'receive', buyer, { note: 'Đã nhận mẫu' });
    expect(received.status).toBe(200);
    expect(received.body.status).toBe('DELIVERED');

    const revised = await act(sampleId, 'revise', buyer, { note: 'Đổi màu nắp hộp' });
    expect(revised.status).toBe(200);
    expect(revised.body.status).toBe('REVISION_REQUESTED');
    expect(revised.body.revisionCount).toBe(1);
    expect(revised.body.round).toBe(2);

    expect((await act(sampleId, 'upload', supplierUser, {})).body.status).toBe('UPLOADED');
    expect(
      (await act(sampleId, 'ship', supplierUser, { carrier: 'FedEx', trackingNo: 'SMP-002' })).body
        .status,
    ).toBe('SENT');
    const delivered = await act(sampleId, 'stops', supplierUser, {
      type: 'DELIVERED',
      description: 'Giao tại kho khách',
    });
    expect(delivered.body.status).toBe('DELIVERED');

    const approved = await act(sampleId, 'approve', buyer, { note: 'Mẫu đạt' });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('APPROVED');
    expect(approved.body.orderMovedTo).toBe('CONTRACT');

    const storedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(storedOrder.status).toBe('CONTRACT');
    expect(storedOrder.stageIndex).toBe(2);
    expect(
      await prisma.orderStageLog.count({ where: { orderId: order.id, status: 'CONTRACT' } }),
    ).toBe(1);
    expect(
      await prisma.orderEvent.count({ where: { orderId: order.id, type: 'order.transition' } }),
    ).toBe(1);

    // Approved is terminal: no second approval and no revision afterwards.
    const again = await act(sampleId, 'approve', buyer, {});
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('INVALID_TRANSITION');
    const reviseAfter = await act(sampleId, 'revise', buyer, { note: 'Sửa nữa' });
    expect(reviseAfter.status).toBe(409);
    expect(reviseAfter.body.code).toBe('SAMPLE_APPROVED');

    const orderDetail = await api().get(`/api/v1/orders/${order.id}`).set(auth(buyer));
    expect(orderDetail.status).toBe(200);
    expect(orderDetail.body.status).toBe('CONTRACT');
    expect(orderDetail.body.samples[0].status).toBe('APPROVED');
  }, 30_000);

  it('rejects wrong-status transitions and cross-role actions', async () => {
    const order = await createOrder();
    const created = await requestSample(order.id, buyer);
    expect(created.status).toBe(201);
    const sampleId = created.body.id as string;

    const shipEarly = await act(sampleId, 'ship', supplierUser, {
      carrier: 'DHL',
      trackingNo: 'X',
    });
    expect(shipEarly.status).toBe(409);
    expect(shipEarly.body.code).toBe('INVALID_TRANSITION');

    expect((await act(sampleId, 'receive', buyer, {})).status).toBe(409);
    expect((await act(sampleId, 'approve', buyer, {})).status).toBe(409);
    expect((await act(sampleId, 'revise', buyer, { note: 'x' })).status).toBe(409);

    // Role separation.
    expect((await act(sampleId, 'upload', buyer, {})).status).toBe(403);
    expect((await act(sampleId, 'upload', sales, {})).status).toBe(403);
    expect((await act(sampleId, 'stops', buyer, { description: 'x' })).status).toBe(403);
    expect((await act(sampleId, 'upload', outsider, {})).status).toBe(404);
    expect((await requestSample(order.id, supplierUser)).status).toBe(403);
    expect((await requestSample(order.id, outsider)).status).toBe(404);
    expect((await requestSample(order.id, buyer)).status).toBe(409);
    expect((await requestSample(order.id, buyer)).body.code).toBe('SAMPLE_ALREADY_ACTIVE');

    // A sample can only be requested once the order is sampling.
    const negotiating = await createOrder('NEGOTIATING');
    const tooEarly = await requestSample(negotiating.id, buyer);
    expect(tooEarly.status).toBe(409);
    expect(tooEarly.body.code).toBe('ORDER_NOT_SAMPLING');

    // Fee currency must match the order currency.
    const sampling = await createOrder();
    const badFee = await requestSample(sampling.id, buyer, {
      feeAmount: 10_000,
      feeCurrency: 'CNY',
    });
    expect(badFee.status).toBe(400);

    // Supplier cannot approve, even after the buyer receives.
    await act(sampleId, 'upload', supplierUser, {});
    await act(sampleId, 'ship', supplierUser, { carrier: 'DHL', trackingNo: 'Y' });
    await act(sampleId, 'receive', buyer, {});
    const supplierApprove = await act(sampleId, 'approve', supplierUser, {});
    expect(supplierApprove.status).toBe(403);
    expect(supplierApprove.body.code).toBe('FORBIDDEN');
    expect((await act(sampleId, 'approve', admin, {})).status).toBe(403);
    expect((await act(sampleId, 'approve', buyer, {})).status).toBe(200);
  }, 30_000);

  it('stops revisions at the configured round limit', async () => {
    await prisma.systemSetting.upsert({
      where: { key: SETTING_KEY },
      create: { key: SETTING_KEY, value: 1, updatedById: admin.id },
      update: { value: 1, updatedById: admin.id, version: { increment: 1 } },
    });
    await redis.del(`setting:${SETTING_KEY}`);

    try {
      const order = await createOrder();
      const created = await requestSample(order.id, buyer);
      const sampleId = created.body.id as string;

      await act(sampleId, 'upload', supplierUser, {});
      await act(sampleId, 'ship', supplierUser, { carrier: 'DHL', trackingNo: 'R1' });
      await act(sampleId, 'receive', buyer, {});
      const first = await act(sampleId, 'revise', buyer, { note: 'Vòng 1' });
      expect(first.status).toBe(200);
      expect(first.body.revisionCount).toBe(1);

      await act(sampleId, 'upload', supplierUser, {});
      await act(sampleId, 'ship', supplierUser, { carrier: 'DHL', trackingNo: 'R2' });
      await act(sampleId, 'receive', buyer, {});
      const second = await act(sampleId, 'revise', buyer, { note: 'Vòng 2' });
      expect(second.status).toBe(409);
      expect(second.body.code).toBe('SAMPLE_REVISION_LIMIT');
    } finally {
      await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEY } });
      await redis.del(`setting:${SETTING_KEY}`);
    }
  }, 30_000);
});
