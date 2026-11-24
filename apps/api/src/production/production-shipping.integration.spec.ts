import { randomUUID } from 'node:crypto';

import { orderStageIndex, SHIPPING_STOP_CODES } from '@cvc/shared';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { OrderStatus } from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../app.module';
import { TokenService } from '../auth/token.service';
import { PrismaService } from '../prisma/prisma.service';
import { ShipmentsService } from '../shipments/shipments.service';

// P4.19 B/C/D integration — supplier production reports + auto QC move, and
// hand-entered shipment tracking with a buyer-visible timeline and receipt.
// RUN_DB_TESTS=1.
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

const EMAIL_PREFIX = 'p4s-test-';
const ORDER_PREFIX = 'P4S-';
const FILE_PREFIX = 'p4s/';

let app: INestApplication;
let prisma: PrismaService;
let tokens: TokenService;
let shipments: ShipmentsService;

interface TestUser {
  id: string;
  email: string;
  accessToken: string;
}

let buyer: TestUser;
let supplierUser: TestUser;
let sales: TestUser;
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
  await prisma.fileObject.deleteMany({ where: { s3Key: { startsWith: FILE_PREFIX } } });
  const suppliers = await prisma.supplier.findMany({
    where: { name: { startsWith: 'P4S Supplier ' } },
    select: { id: true },
  });
  await prisma.supplier.deleteMany({ where: { id: { in: suppliers.map((row) => row.id) } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
}

describeDb('Production reports and manual shipment tracking (P4.19 B/C/D)', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
    shipments = app.get(ShipmentsService);
    await cleanup();

    buyer = await createUser(['buyer']);
    supplierUser = await createUser(['supplier']);
    sales = await createUser(['sales']);
    outsider = await createUser(['buyer']);

    const supplier = await prisma.supplier.create({
      data: { name: `P4S Supplier ${Date.now()}`, status: 'ACTIVE' },
    });
    supplierId = supplier.id;
    await prisma.supplierAccount.create({
      data: { userId: supplierUser.id, supplierId, isPrimary: true },
    });
  }, 90_000);

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.accessToken}` });
  const api = () => request(app.getHttpServer());

  async function createOrder(status: OrderStatus): Promise<string> {
    const order = await prisma.order.create({
      data: {
        orderNo: `${ORDER_PREFIX}${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`,
        buyerId: buyer.id,
        supplierId,
        status,
        stageIndex: orderStageIndex(status as 'SHIPPING'),
        totalAmount: 2_000_000,
        depositAmount: 1_000_000,
        currency: 'VND',
      },
    });
    return order.id;
  }

  async function makeFile(ownerId: string): Promise<string> {
    const file = await prisma.fileObject.create({
      data: {
        ownerType: 'user',
        ownerId,
        bucket: 'p4s',
        s3Key: `${FILE_PREFIX}${randomUUID()}`,
        purpose: 'production_report',
        declaredMime: 'image/png',
        detectedMime: 'image/png',
        sizeBytes: 10,
        status: 'READY',
        scanStatus: 'CLEAN',
        sha256: `sha-${randomUUID()}`,
      },
    });
    return file.id;
  }

  it('stores supplier production reports and moves PRODUCTION → QC on ready', async () => {
    const orderId = await createOrder('PRODUCTION');
    const photo = await makeFile(supplierUser.id);

    const report = await api()
      .post(`/api/v1/orders/${orderId}/production-reports`)
      .set(auth(supplierUser))
      .send({ note: 'Đã dệt xong vải', fileObjectIds: [photo] });
    expect(report.status).toBe(201);
    expect(report.body).toMatchObject({ orderId, ready: false, viewerRole: 'supplier' });
    expect(report.body.media).toHaveLength(1);

    const buyerRead = await api()
      .get(`/api/v1/orders/${orderId}/production-reports`)
      .set(auth(buyer));
    expect(buyerRead.status).toBe(200);
    expect(buyerRead.body.items).toHaveLength(1);
    expect(buyerRead.body.items[0].viewerRole).toBe('buyer');

    const buyerWrite = await api()
      .post(`/api/v1/orders/${orderId}/production-reports`)
      .set(auth(buyer))
      .send({ fileObjectIds: [photo] });
    expect(buyerWrite.status).toBe(403);

    const ready = await api()
      .post(`/api/v1/orders/${orderId}/ready`)
      .set(auth(supplierUser))
      .send({ note: 'Hoàn tất sản xuất', fileObjectIds: [] });
    expect(ready.status).toBe(200);
    expect(ready.body.orderMovedTo).toBe('QC');
    expect(ready.body.report.ready).toBe(true);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('QC');
    const events = await prisma.orderEvent.findMany({
      where: { orderId, type: { in: ['production.reported', 'production.ready'] } },
    });
    expect(events).toHaveLength(2);

    // Reports are only accepted while the order is in production/QC.
    const early = await createOrder('NEGOTIATING');
    const tooEarly = await api()
      .post(`/api/v1/orders/${early}/ready`)
      .set(auth(supplierUser))
      .send({ fileObjectIds: [] });
    expect(tooEarly.status).toBe(409);
    expect(tooEarly.body.code).toBe('ORDER_NOT_IN_PRODUCTION');

    const outsiderRead = await api()
      .get(`/api/v1/orders/${early}/production-reports`)
      .set(auth(outsider));
    expect(outsiderRead.status).toBe(404);
  });

  it('builds a hand-entered timeline, restricts writers and confirms receipt', async () => {
    const orderId = await createOrder('SHIPPING');
    const proof = await makeFile(supplierUser.id);

    const buyerCreate = await api()
      .post(`/api/v1/orders/${orderId}/shipments`)
      .set(auth(buyer))
      .send({ carrier: 'SF Express', trackingNo: 'SF123' });
    expect(buyerCreate.status).toBe(403);

    const created = await api()
      .post(`/api/v1/orders/${orderId}/shipments`)
      .set(auth(supplierUser))
      .send({
        carrier: 'SF Express',
        trackingNo: 'SF123',
        trackingUrl: 'https://www.sf-express.com/track/SF123',
        expectedAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        proofFileObjectId: proof,
      });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      orderId,
      status: 'PREPARING',
      carrier: 'SF Express',
      trackingNo: 'SF123',
      viewerRole: 'supplier',
      canEdit: true,
    });
    expect(created.body.timeline).toEqual([]);
    const shipmentId = created.body.id as string;

    const factory = await api()
      .post(`/api/v1/shipments/${shipmentId}/stops`)
      .set(auth(supplierUser))
      .send({ type: 'LEFT_FACTORY', description: 'Hàng rời xưởng', location: 'Quảng Châu' });
    expect(factory.status).toBe(201);
    expect(factory.body.status).toBe('IN_TRANSIT');
    expect(factory.body.timeline).toHaveLength(1);

    const buyerStop = await api()
      .post(`/api/v1/shipments/${shipmentId}/stops`)
      .set(auth(buyer))
      .send({ type: 'CUSTOMS', description: 'Tự thêm mốc' });
    expect(buyerStop.status).toBe(403);

    const customs = await api()
      .post(`/api/v1/shipments/${shipmentId}/stops`)
      .set(auth(sales))
      .send({ type: 'CUSTOMS', description: 'Đang thông quan', location: 'Hà Nội' });
    expect(customs.status).toBe(201);
    expect(customs.body.viewerRole).toBe('staff');

    const updated = await api()
      .put(`/api/v1/shipments/${shipmentId}`)
      .set(auth(sales))
      .send({ expectedAt: new Date(Date.now() + 86_400_000).toISOString() });
    expect(updated.status).toBe(200);
    expect(updated.body.expectedAt).toBeTruthy();

    const buyerTimeline = await api().get(`/api/v1/orders/${orderId}/shipments`).set(auth(buyer));
    expect(buyerTimeline.status).toBe(200);
    expect(buyerTimeline.body.items[0].timeline).toHaveLength(2);
    expect(buyerTimeline.body.items[0].canEdit).toBe(false);
    expect(buyerTimeline.body.stopSuggestions.map((row: { code: string }) => row.code)).toEqual([
      ...SHIPPING_STOP_CODES,
    ]);

    // Receipt is impossible until a shipment is marked delivered.
    const tooSoon = await api()
      .post(`/api/v1/orders/${orderId}/confirm-receipt`)
      .set(auth(buyer))
      .send({});
    expect(tooSoon.status).toBe(409);
    expect(tooSoon.body.code).toBe('SHIPMENT_NOT_DELIVERED');

    const delivered = await api()
      .post(`/api/v1/shipments/${shipmentId}/stops`)
      .set(auth(sales))
      .send({ type: 'DELIVERED', description: 'Đã giao tới kho khách', location: 'Hồ Chí Minh' });
    expect(delivered.status).toBe(201);
    expect(delivered.body.status).toBe('DELIVERED');
    expect(delivered.body.deliveredAt).toBeTruthy();

    const supplierConfirm = await api()
      .post(`/api/v1/orders/${orderId}/confirm-receipt`)
      .set(auth(supplierUser))
      .send({});
    expect(supplierConfirm.status).toBe(403);

    const confirmed = await api()
      .post(`/api/v1/orders/${orderId}/confirm-receipt`)
      .set(auth(buyer))
      .send({ note: 'Nhận đủ hàng' });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe('RECEIVED');
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('RECEIVED');

    const closed = await api()
      .put(`/api/v1/shipments/${shipmentId}`)
      .set(auth(sales))
      .send({ carrier: 'Khác' });
    expect(closed.status).toBe(409);
    expect(closed.body.code).toBe('SHIPMENT_CLOSED');
  });

  it('reminds stale in-transit shipments once per day', async () => {
    const orderId = await createOrder('SHIPPING');
    const created = await api()
      .post(`/api/v1/orders/${orderId}/shipments`)
      .set(auth(supplierUser))
      .send({ carrier: 'Yun Express', trackingNo: `YT-${randomUUID()}` });
    const shipmentId = created.body.id as string;
    const stop = await api()
      .post(`/api/v1/shipments/${shipmentId}/stops`)
      .set(auth(supplierUser))
      .send({ type: 'INTERNATIONAL_TRANSIT', description: 'Đang bay' });
    expect(stop.status).toBe(201);

    // Pretend the last milestone happened 10 days ago.
    const old = new Date(Date.now() - 10 * 86_400_000);
    await prisma.shipmentStop.updateMany({ where: { shipmentId }, data: { occurredAt: old } });
    await prisma.shipment.update({ where: { id: shipmentId }, data: { updatedAt: old } });

    const first = await shipments.remindStale();
    expect(first.reminded).toBeGreaterThanOrEqual(1);
    const stored = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
    expect(stored.lastReminderAt).toBeTruthy();

    // The once-per-day guard keeps a second sweep from spamming the parties.
    const second = await shipments.remindStale();
    expect(second.reminded).toBe(0);
  });
});
