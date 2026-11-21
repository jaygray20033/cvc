import { randomUUID } from 'node:crypto';

import { orderStageIndex, type OrderStatusCode } from '@cvc/shared';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type OrderStatus } from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../app.module';
import { TokenService } from '../auth/token.service';
import { PrismaService } from '../prisma/prisma.service';

// P4.16 integration — access by role, invalid edges, FORBIDDEN roles, every
// guard in the D7 table and the 10-status happy path. RUN_DB_TESTS=1 required.
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

const EMAIL_PREFIX = 'p4k-test-';
const SUPPLIER_PREFIX = 'P4K Supplier ';
const ORDER_PREFIX = 'P4K-';

let app: INestApplication;
let prisma: PrismaService;
let tokens: TokenService;

interface TestUser {
  id: string;
  email: string;
  accessToken: string;
}

let buyer: TestUser;
let supplierUser: TestUser;
let sales: TestUser;
let inspector: TestUser;
let admin: TestUser;
let outsider: TestUser;
let supplierId: string;
let templateId: string;
let receivingAccountId: string;

function makeEmail(): string {
  return `${EMAIL_PREFIX}${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`;
}

function makeOrderNo(): string {
  return `${ORDER_PREFIX}${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
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
  const orders = await prisma.order.findMany({
    where: { orderNo: { startsWith: ORDER_PREFIX } },
    select: { id: true },
  });
  const ids = orders.map((order) => order.id);
  if (ids.length > 0) {
    await prisma.claim.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.shipment.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.qcReport.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.payment.deleteMany({ where: { purposeType: 'order', purposeId: { in: ids } } });
    await prisma.contract.deleteMany({
      where: { ownerType: 'sourcing_order', ownerId: { in: ids } },
    });
  }
  await prisma.order.deleteMany({ where: { orderNo: { startsWith: ORDER_PREFIX } } });
  await prisma.contractTemplate.deleteMany({ where: { title: { startsWith: 'P4K' } } });
  await prisma.receivingAccount.deleteMany({ where: { bankCode: 'P4K' } });
  const suppliers = await prisma.supplier.findMany({
    where: { name: { startsWith: SUPPLIER_PREFIX } },
    select: { id: true },
  });
  await prisma.supplier.deleteMany({ where: { id: { in: suppliers.map((row) => row.id) } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
}

async function createOrder(status: OrderStatus) {
  return prisma.order.create({
    data: {
      orderNo: makeOrderNo(),
      buyerId: buyer.id,
      supplierId,
      status,
      stageIndex: status === 'CANCELLED' ? 0 : orderStageIndex(status as OrderStatusCode),
      totalAmount: 2_000_000,
      depositAmount: 1_000_000,
      currency: 'VND',
    },
  });
}

async function lockTerms(orderId: string, actorId = buyer.id) {
  return prisma.lockedTerms.create({
    data: { orderId, terms: { productName: 'P4K' }, currency: 'VND', lockedById: actorId },
  });
}

async function approvedSample(orderId: string) {
  return prisma.sample.create({
    data: {
      sampleNo: `CVC-SMP-P4K-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
      orderId,
      status: 'APPROVED',
      decidedAt: new Date(),
    },
  });
}

async function signedContract(orderId: string) {
  return prisma.contract.create({
    data: {
      ownerType: 'sourcing_order',
      ownerId: orderId,
      templateId,
      templateVersion: 1,
      status: 'SIGNED',
    },
  });
}

async function confirmedPayment(orderId: string, amount: number) {
  return prisma.payment.create({
    data: {
      paymentNo: `CVC-PAY-P4K-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
      userId: buyer.id,
      purposeType: 'order',
      purposeId: orderId,
      receivingAccountId,
      amount,
      currency: 'VND',
      status: 'CONFIRMED',
      confirmedById: admin.id,
      confirmedAt: new Date(),
    },
  });
}

async function productionReport(orderId: string) {
  return prisma.orderEvent.create({
    data: {
      orderId,
      type: 'production.reported',
      actorId: supplierUser.id,
      message: 'Sản xuất xong, có ảnh báo cáo.',
    },
  });
}

async function qcReport(orderId: string, passed: boolean) {
  return prisma.qcReport.create({
    data: {
      orderId,
      passed,
      checkedById: inspector.id,
      note: passed ? 'Đạt' : 'Không đạt',
    },
  });
}

async function deliveredShipment(orderId: string) {
  return prisma.shipment.create({
    data: {
      orderId,
      carrier: 'DHL',
      trackingNo: `P4K-${Date.now().toString(36)}`,
      status: 'DELIVERED',
      deliveredAt: new Date(),
    },
  });
}

describeDb('Order state machine (P4.16)', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
    await cleanup();

    buyer = await createUser(['buyer']);
    supplierUser = await createUser(['supplier']);
    sales = await createUser(['sales']);
    inspector = await createUser(['inspector']);
    admin = await createUser(['admin']);
    outsider = await createUser(['buyer']);

    const supplier = await prisma.supplier.create({
      data: { name: `${SUPPLIER_PREFIX}${Date.now()}`, status: 'ACTIVE' },
    });
    supplierId = supplier.id;
    await prisma.supplierAccount.create({
      data: { userId: supplierUser.id, supplierId, isPrimary: true },
    });

    const template = await prisma.contractTemplate.create({
      data: {
        type: 'SOURCING',
        version: 900_000 + Math.floor(Math.random() * 90_000),
        title: `P4K template ${Date.now()}`,
        content: 'P4K',
      },
    });
    templateId = template.id;

    const account = await prisma.receivingAccount.create({
      data: {
        bankName: 'P4K Bank',
        holderName: 'P4K',
        accountNoEnc: 'x',
        accountNoLast4: '0000',
        accountNoHash: randomUUID().replace(/-/g, ''),
        bankCode: 'P4K',
      },
    });
    receivingAccountId = account.id;
  }, 90_000);

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.accessToken}` });
  const api = () => request(app.getHttpServer());

  async function transition(orderId: string, user: TestUser, to: string, reason?: string) {
    return api()
      .post(`/api/v1/orders/${orderId}/transition`)
      .set(auth(user))
      .send({ to, ...(reason ? { reason } : {}) });
  }

  it('lists orders per role and hides detail from outsiders', async () => {
    const order = await createOrder('NEGOTIATING');

    const buyerList = await api().get('/api/v1/orders').set(auth(buyer));
    expect(buyerList.status).toBe(200);
    expect(buyerList.body.items.some((row: { id: string }) => row.id === order.id)).toBe(true);
    expect(buyerList.body.items[0].stepper).toHaveLength(8);

    const supplierList = await api().get('/api/v1/orders').set(auth(supplierUser));
    expect(supplierList.status).toBe(200);
    expect(supplierList.body.items.some((row: { id: string }) => row.id === order.id)).toBe(true);

    for (const staff of [sales, inspector, admin]) {
      const list = await api().get('/api/v1/orders').set(auth(staff));
      expect(list.status).toBe(200);
      expect(list.body.items.some((row: { id: string }) => row.id === order.id)).toBe(true);
    }
    const outsiderList = await api().get('/api/v1/orders').set(auth(outsider));
    expect(outsiderList.status).toBe(200);
    expect(outsiderList.body.items.some((row: { id: string }) => row.id === order.id)).toBe(false);

    const detail = await api().get(`/api/v1/orders/${order.id}`).set(auth(buyer));
    expect(detail.status).toBe(200);
    expect(detail.body.status).toBe('NEGOTIATING');
    expect(detail.body.displayStage.index).toBe(1);
    expect(detail.body.stepper).toHaveLength(8);
    expect(detail.body.allowedTransitions).toEqual(
      expect.arrayContaining(['SAMPLING', 'CANCELLED']),
    );
    expect((await api().get(`/api/v1/orders/${order.id}`).set(auth(outsider))).status).toBe(404);
    expect((await api().get('/api/v1/orders?status=NOPE').set(auth(buyer))).status).toBe(400);
  });

  it('rejects invalid edges, wrong roles, missing guards and outsider access', async () => {
    const order = await createOrder('NEGOTIATING');

    const invalid = await transition(order.id, buyer, 'COMPLETED');
    expect(invalid.status).toBe(409);
    expect(invalid.body.code).toBe('INVALID_TRANSITION');

    const noTerms = await transition(order.id, buyer, 'SAMPLING');
    expect(noTerms.status).toBe(409);
    expect(noTerms.body.code).toBe('LOCKED_TERMS_REQUIRED');

    expect((await transition(order.id, sales, 'SAMPLING')).status).toBe(403);
    expect((await transition(order.id, admin, 'SAMPLING')).status).toBe(403);
    expect((await transition(order.id, outsider, 'SAMPLING')).status).toBe(404);
    const forbidden = await transition(order.id, sales, 'SAMPLING');
    expect(forbidden.body.code).toBe('FORBIDDEN');

    await lockTerms(order.id);
    const moved = await transition(order.id, buyer, 'SAMPLING', 'Đủ điều kiện lấy mẫu.');
    expect(moved.status).toBe(200);
    expect(moved.body.status).toBe('SAMPLING');
    expect(moved.body.stageIndex).toBe(1);
    expect(moved.body.displayStage.index).toBe(2);
    expect(await prisma.orderStageLog.count({ where: { orderId: order.id } })).toBe(1);
    expect(
      await prisma.orderEvent.count({ where: { orderId: order.id, type: 'order.transition' } }),
    ).toBe(1);

    const noSample = await transition(order.id, buyer, 'CONTRACT');
    expect(noSample.status).toBe(409);
    expect(noSample.body.code).toBe('SAMPLE_NOT_APPROVED');

    await approvedSample(order.id);
    const contract = await transition(order.id, buyer, 'CONTRACT');
    expect(contract.status).toBe(200);
    expect(contract.body.status).toBe('CONTRACT');
    expect(contract.body.stageIndex).toBe(2);

    // A buyer cannot approve the deposit step; admin is required there.
    await signedContract(order.id);
    const deposit = await transition(order.id, buyer, 'DEPOSIT');
    expect(deposit.status).toBe(200);
    const wrongProduction = await transition(order.id, buyer, 'PRODUCTION');
    expect(wrongProduction.status).toBe(403);
    expect(wrongProduction.body.code).toBe('FORBIDDEN');
  });

  it('walks the 10 statuses with every guard satisfied', async () => {
    const order = await createOrder('NEGOTIATING');

    await lockTerms(order.id);
    expect((await transition(order.id, buyer, 'SAMPLING')).status).toBe(200);

    await approvedSample(order.id);
    expect((await transition(order.id, buyer, 'CONTRACT')).status).toBe(200);

    await signedContract(order.id);
    expect((await transition(order.id, buyer, 'DEPOSIT')).status).toBe(200);

    await confirmedPayment(order.id, 1_000_000);
    expect((await transition(order.id, admin, 'PRODUCTION')).status).toBe(200);

    await productionReport(order.id);
    expect((await transition(order.id, supplierUser, 'QC')).status).toBe(200);

    await qcReport(order.id, true);
    expect((await transition(order.id, inspector, 'FINAL_PAYMENT')).status).toBe(200);

    await confirmedPayment(order.id, 1_000_000);
    expect((await transition(order.id, admin, 'SHIPPING')).status).toBe(200);

    await deliveredShipment(order.id);
    expect((await transition(order.id, buyer, 'RECEIVED')).status).toBe(200);

    const completed = await transition(order.id, admin, 'COMPLETED');
    expect(completed.status).toBe(200);
    expect(completed.body.status).toBe('COMPLETED');
    expect(completed.body.stageIndex).toBe(9);
    expect(completed.body.displayStage.index).toBe(8);
    expect(completed.body.allowedTransitions).toEqual([]);
    expect(await prisma.orderStageLog.count({ where: { orderId: order.id } })).toBe(9);
    expect(
      await prisma.orderEvent.count({ where: { orderId: order.id, type: 'order.transition' } }),
    ).toBe(9);
  });

  it('enforces payment, production, QC, shipment and claim guards', async () => {
    const order = await createOrder('DEPOSIT');

    const noDeposit = await transition(order.id, admin, 'PRODUCTION');
    expect(noDeposit.status).toBe(409);
    expect(noDeposit.body.code).toBe('DEPOSIT_NOT_PAID');

    await confirmedPayment(order.id, 500_000);
    const partial = await transition(order.id, admin, 'PRODUCTION');
    expect(partial.status).toBe(409);
    expect(partial.body.code).toBe('DEPOSIT_NOT_PAID');

    await confirmedPayment(order.id, 500_000);
    expect((await transition(order.id, admin, 'PRODUCTION')).status).toBe(200);

    const noReport = await transition(order.id, supplierUser, 'QC');
    expect(noReport.status).toBe(409);
    expect(noReport.body.code).toBe('PRODUCTION_REPORT_REQUIRED');

    await productionReport(order.id);
    expect((await transition(order.id, supplierUser, 'QC')).status).toBe(200);

    await qcReport(order.id, false);
    const failedQc = await transition(order.id, inspector, 'FINAL_PAYMENT');
    expect(failedQc.status).toBe(409);
    expect(failedQc.body.code).toBe('QC_NOT_PASSED');

    // QC failure goes back to production for rework, then forward again.
    expect((await transition(order.id, inspector, 'PRODUCTION')).status).toBe(200);
    await productionReport(order.id);
    expect((await transition(order.id, supplierUser, 'QC')).status).toBe(200);
    await qcReport(order.id, true);
    expect((await transition(order.id, inspector, 'FINAL_PAYMENT')).status).toBe(200);

    const shortPayment = await transition(order.id, admin, 'SHIPPING');
    expect(shortPayment.status).toBe(409);
    expect(shortPayment.body.code).toBe('PAYMENT_NOT_COMPLETE');
    await confirmedPayment(order.id, 1_000_000);
    expect((await transition(order.id, admin, 'SHIPPING')).status).toBe(200);

    const noShipment = await transition(order.id, buyer, 'RECEIVED');
    expect(noShipment.status).toBe(409);
    expect(noShipment.body.code).toBe('SHIPMENT_NOT_DELIVERED');
    const transit = await prisma.shipment.create({
      data: { orderId: order.id, carrier: 'DHL', trackingNo: randomUUID(), status: 'IN_TRANSIT' },
    });
    expect((await transition(order.id, buyer, 'RECEIVED')).body.code).toBe(
      'SHIPMENT_NOT_DELIVERED',
    );
    await prisma.shipment.update({ where: { id: transit.id }, data: { status: 'DELIVERED' } });
    expect((await transition(order.id, buyer, 'RECEIVED')).status).toBe(200);

    const claim = await prisma.claim.create({
      data: {
        claimNo: `CVC-CLM-P4K-${Date.now().toString(36)}`,
        orderId: order.id,
        type: 'OTHER',
        reason: 'P4K',
        status: 'OPEN',
        filedById: buyer.id,
      },
    });
    const openClaim = await transition(order.id, admin, 'COMPLETED');
    expect(openClaim.status).toBe(409);
    expect(openClaim.body.code).toBe('OPEN_CLAIMS');
    await prisma.claim.update({ where: { id: claim.id }, data: { status: 'RESOLVED' } });
    expect((await transition(order.id, admin, 'COMPLETED')).status).toBe(200);
  });

  it('allows free cancellation before deposit, admin-only after', async () => {
    const early = await createOrder('NEGOTIATING');
    const cancelled = await transition(early.id, buyer, 'CANCELLED', 'Khách đổi ý.');
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('CANCELLED');

    const late = await createOrder('DEPOSIT');
    const buyerLate = await transition(late.id, buyer, 'CANCELLED');
    expect(buyerLate.status).toBe(403);
    expect(buyerLate.body.code).toBe('FORBIDDEN');

    const noTerms = await transition(late.id, admin, 'CANCELLED');
    expect(noTerms.status).toBe(409);
    expect(noTerms.body.code).toBe('TERMS_REQUIRED_FOR_CANCELLATION');

    await lockTerms(late.id);
    const adminLate = await transition(late.id, admin, 'CANCELLED', 'Theo điều khoản hợp đồng.');
    expect(adminLate.status).toBe(200);
    expect(adminLate.body.status).toBe('CANCELLED');
  });
});
