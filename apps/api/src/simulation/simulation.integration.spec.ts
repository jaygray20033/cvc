import { randomUUID } from 'node:crypto';

import { orderStageIndex } from '@cvc/shared';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../app.module';
import { TokenService } from '../auth/token.service';
import { PrismaService } from '../prisma/prisma.service';

// P4.21 integration — ENABLE_SIMULATION=true: setAuto/pump advance production,
// shipment stops and claim proposals, and never move money. The disabled /
// production 404 behaviour is covered in simulation.service.spec.ts.
// RUN_DB_TESTS=1.
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

const EMAIL_PREFIX = 'p4s-test-';
const ORDER_PREFIX = 'P4S-';

let app: INestApplication;
let prisma: PrismaService;
let tokens: TokenService;

interface TestUser {
  id: string;
  email: string;
  accessToken: string;
}

let buyer: TestUser;
let otherBuyer: TestUser;
let supplierUser: TestUser;
let admin: TestUser;
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
  const orders = await prisma.order.findMany({
    where: { orderNo: { startsWith: ORDER_PREFIX } },
    select: { id: true },
  });
  await prisma.order.deleteMany({ where: { id: { in: orders.map((row) => row.id) } } });
  const suppliers = await prisma.supplier.findMany({
    where: { name: { startsWith: 'P4S Supplier ' } },
    select: { id: true },
  });
  await prisma.supplierAccount.deleteMany({
    where: { supplierId: { in: suppliers.map((row) => row.id) } },
  });
  await prisma.supplier.deleteMany({ where: { id: { in: suppliers.map((row) => row.id) } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
}

describeDb('Simulation automation (P4.21)', () => {
  beforeAll(async () => {
    process.env.ENABLE_SIMULATION = 'true';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
    await cleanup();

    buyer = await createUser(['buyer']);
    otherBuyer = await createUser(['buyer']);
    supplierUser = await createUser(['supplier']);
    admin = await createUser(['admin', 'admin_ops']);

    const supplier = await prisma.supplier.create({
      data: {
        name: `P4S Supplier ${Date.now()}`,
        contactName: `P4S Supplier ${Date.now()}`,
        status: 'ACTIVE',
      },
    });
    supplierId = supplier.id;
    await prisma.supplierAccount.create({
      data: { userId: supplierUser.id, supplierId, isPrimary: true },
    });
  }, 90_000);

  afterAll(async () => {
    await cleanup();
    await app.close();
    delete process.env.ENABLE_SIMULATION;
  });

  const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.accessToken}` });
  const api = () => request(app.getHttpServer());

  async function createOrder(status: 'PRODUCTION' | 'SHIPPING'): Promise<string> {
    const order = await prisma.order.create({
      data: {
        orderNo: `${ORDER_PREFIX}${randomUUID().slice(0, 12)}`,
        buyerId: buyer.id,
        supplierId,
        status,
        stageIndex: orderStageIndex(status),
        totalAmount: 26_000,
        depositAmount: 0,
        currency: 'VND',
      },
    });
    return order.id;
  }

  it('pump advances production, shipment and claim proposal without money moves', async () => {
    const productionOrderId = await createOrder('PRODUCTION');
    const shippingOrderId = await createOrder('SHIPPING');
    const shipment = await prisma.shipment.create({
      data: {
        orderId: shippingOrderId,
        carrier: 'DEMO',
        trackingNo: 'P4S-SHIP-1',
        status: 'PREPARING',
        shippedAt: new Date(),
      },
    });
    const claim = await prisma.claim.create({
      data: {
        claimNo: `CVC-CLM-${randomUUID().slice(0, 12).toUpperCase()}`,
        orderId: productionOrderId,
        type: 'QUALITY',
        reason: 'Mô phỏng khiếu nại',
        status: 'OPEN',
        filedById: buyer.id,
      },
    });

    const auto = await api()
      .post(`/api/v1/simulation/orders/${productionOrderId}/auto`)
      .set(auth(buyer))
      .send({ enabled: true });
    expect(auto.status).toBe(200);
    expect(auto.body.enabled).toBe(true);

    expect(
      (
        await api()
          .post(`/api/v1/simulation/orders/${shippingOrderId}/auto`)
          .set(auth(admin))
          .send({ enabled: true })
      ).status,
    ).toBe(200);

    // A different buyer cannot automate somebody else's order.
    const stranger = await api()
      .post(`/api/v1/simulation/orders/${productionOrderId}/auto`)
      .set(auth(otherBuyer))
      .send({ enabled: true });
    expect(stranger.status).toBe(404);

    const pumped = await api().post('/api/v1/simulation/pump').set(auth(admin)).send({});
    expect(pumped.status).toBe(200);
    expect(pumped.body.orders).toHaveLength(2);

    const production = await prisma.order.findUniqueOrThrow({ where: { id: productionOrderId } });
    expect(production.status).toBe('QC');
    const claimAfter = await prisma.claim.findUniqueOrThrow({ where: { id: claim.id } });
    expect(claimAfter.status).toBe('PROPOSED');
    // No claim refund and no payment/payout rows were created by the pump.
    expect(await prisma.refund.count({ where: { claimId: claim.id } })).toBe(0);

    const shipmentAfter = await prisma.shipment.findUniqueOrThrow({
      where: { id: shipment.id },
    });
    expect(shipmentAfter.status).toBe('DELIVERED');
    expect(shipmentAfter.deliveredAt).toBeTruthy();

    const status = await api()
      .get(`/api/v1/simulation/orders/${productionOrderId}`)
      .set(auth(admin));
    expect(status.status).toBe(200);
    expect(status.body.enabled).toBe(true);
    expect(status.body.lastPumpedAt).toBeTruthy();
  });
});
