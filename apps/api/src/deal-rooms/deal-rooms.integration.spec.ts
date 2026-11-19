import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../app.module';
import { TokenService } from '../auth/token.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RedisService } from '../redis/redis.service';

// Integration tests for P4.12 (Deal Room): private room reads and member
// invitations. Outsiders must get 404, not 403. RUN_DB_TESTS=1 required.
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

const EMAIL_PREFIX = 'p4g-test-';
const SUPPLIER_PREFIX = 'P4G Supplier ';
const ORDER_PREFIX = 'P4G-ORD-';

let app: INestApplication;
let prisma: PrismaService;
let tokens: TokenService;
let realtime: RealtimeService;
let redis: RedisService;

interface TestUser {
  id: string;
  email: string;
  accessToken: string;
}

let buyer: TestUser;
let outsiderBuyer: TestUser;
let supplierUser: TestUser;
let otherSupplierUser: TestUser;
let sales: TestUser;
let otherSales: TestUser;
let inspector: TestUser;
let admin: TestUser;

let orderId: string;
let roomId: string;
const roomIds: string[] = [];

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
  const rooms = await prisma.dealRoom.findMany({
    where: { order: { orderNo: { startsWith: ORDER_PREFIX } } },
    select: { id: true },
  });
  for (const room of rooms) await redis.del(`realtime:dealroom:${room.id}:members`);

  await prisma.dealRoom.deleteMany({ where: { id: { in: rooms.map((room) => room.id) } } });
  await prisma.order.deleteMany({ where: { orderNo: { startsWith: ORDER_PREFIX } } });
  await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

describeDb('Deal Room (P4.12)', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
    realtime = app.get(RealtimeService);
    redis = app.get(RedisService);
    await cleanup();

    buyer = await createUser(['buyer']);
    outsiderBuyer = await createUser(['buyer']);
    supplierUser = await createUser(['supplier']);
    otherSupplierUser = await createUser(['supplier']);
    sales = await createUser(['sales']);
    otherSales = await createUser(['sales']);
    inspector = await createUser(['inspector']);
    admin = await createUser(['admin']);

    const supplier = await prisma.supplier.create({
      data: { name: `${SUPPLIER_PREFIX}${Date.now()}`, status: 'ACTIVE' },
    });
    await prisma.supplierAccount.create({
      data: { userId: supplierUser.id, supplierId: supplier.id, isPrimary: true },
    });
    const otherSupplier = await prisma.supplier.create({
      data: { name: `${SUPPLIER_PREFIX}Other-${Date.now()}`, status: 'ACTIVE' },
    });
    await prisma.supplierAccount.create({
      data: { userId: otherSupplierUser.id, supplierId: otherSupplier.id, isPrimary: true },
    });

    const order = await prisma.order.create({
      data: {
        orderNo: `${ORDER_PREFIX}${Date.now()}`,
        buyerId: buyer.id,
        supplierId: supplier.id,
        status: 'NEGOTIATING',
        stageIndex: 0,
        totalAmount: 15_000_000,
        currency: 'VND',
      },
    });
    orderId = order.id;

    const room = await prisma.dealRoom.create({
      data: {
        orderId: order.id,
        title: 'P4G phòng thương lượng',
        members: {
          create: [
            { userId: buyer.id, role: 'buyer' },
            { userId: supplierUser.id, role: 'supplier' },
            { userId: sales.id, role: 'sales' },
          ],
        },
      },
    });
    roomId = room.id;
    roomIds.push(room.id);
    for (const member of [buyer, supplierUser, sales]) {
      await realtime.grantDealRoomAccess(room.id, member.id);
    }
  }, 90_000);

  afterAll(async () => {
    for (const id of roomIds) await redis.del(`realtime:dealroom:${id}:members`);
    await cleanup();
    await app.close();
  });

  const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.accessToken}` });
  const api = () => request(app.getHttpServer());

  it('returns room detail to members only; outsiders get 404', async () => {
    const buyerView = await api().get(`/api/v1/deal-rooms/${roomId}`).set(auth(buyer));
    expect(buyerView.status).toBe(200);
    expect(buyerView.body.id).toBe(roomId);
    expect(buyerView.body.viewerRole).toBe('buyer');
    expect(Number(buyerView.body.order.totalAmount)).toBe(15_000_000);
    expect(buyerView.body.order.supplier.name).toContain(SUPPLIER_PREFIX);
    expect(buyerView.body.memberCount).toBe(3);

    for (const member of [supplierUser, sales]) {
      expect((await api().get(`/api/v1/deal-rooms/${roomId}`).set(auth(member))).status).toBe(200);
    }

    // Outsiders: unrelated buyer and unrelated sales both get 404.
    for (const outsider of [outsiderBuyer, otherSales]) {
      const denied = await api().get(`/api/v1/deal-rooms/${roomId}`).set(auth(outsider));
      expect(denied.status).toBe(404);
      expect(denied.body.message).toBe('Phòng thương lượng không tồn tại.');
    }
    expect((await api().get(`/api/v1/deal-rooms/${roomId}`).set(auth(admin))).status).toBe(200);
    expect(
      (await api().get('/api/v1/deal-rooms/ckx0000000000000000000000').set(auth(buyer))).status,
    ).toBe(404);
    expect((await api().get(`/api/v1/deal-rooms/${roomId}`)).status).toBe(401);
  });

  it('lists members with roles but never exposes member emails', async () => {
    const listed = await api().get(`/api/v1/deal-rooms/${roomId}/members`).set(auth(buyer));
    expect(listed.status).toBe(200);
    const roles = new Map<string, string>(
      (listed.body.members as Array<{ userId: string; role: string }>).map((member) => [
        member.userId,
        member.role,
      ]),
    );
    expect(roles.get(buyer.id)).toBe('buyer');
    expect(roles.get(supplierUser.id)).toBe('supplier');
    expect(roles.get(sales.id)).toBe('sales');
    expect(JSON.stringify(listed.body)).not.toContain('@');

    expect(
      (await api().get(`/api/v1/deal-rooms/${roomId}/members`).set(auth(outsiderBuyer))).status,
    ).toBe(404);
  });

  it('lets the sales member invite colleagues, idempotently, and syncs realtime access', async () => {
    // Non-member sales cannot invite anyone.
    const denied = await api()
      .post(`/api/v1/deal-rooms/${roomId}/members`)
      .set(auth(otherSales))
      .send({ userId: inspector.id, role: 'inspector' });
    expect(denied.status).toBe(404);

    // Buyer/supplier lack the role for the route.
    expect(
      (
        await api()
          .post(`/api/v1/deal-rooms/${roomId}/members`)
          .set(auth(buyer))
          .send({ userId: inspector.id, role: 'inspector' })
      ).status,
    ).toBe(403);

    const added = await api()
      .post(`/api/v1/deal-rooms/${roomId}/members`)
      .set(auth(sales))
      .send({ userId: otherSales.id, role: 'sales' });
    expect(added.status).toBe(201);
    expect(added.body.created).toBe(true);
    expect(added.body.member.role).toBe('sales');

    // New member can read the room and join the realtime room.
    expect((await api().get(`/api/v1/deal-rooms/${roomId}`).set(auth(otherSales))).status).toBe(
      200,
    );
    const join = await realtime.assertCanJoin(
      { sub: otherSales.id, email: otherSales.email, sid: 'test', role: 'sales' },
      `dealRoom:${roomId}`,
    );
    expect(join).toEqual({ ok: true });

    // Repeating the invite is idempotent.
    const again = await api()
      .post(`/api/v1/deal-rooms/${roomId}/members`)
      .set(auth(sales))
      .send({ userId: otherSales.id, role: 'sales' });
    expect(again.status).toBe(201);
    expect(again.body.created).toBe(false);
    expect(await prisma.dealRoomMember.count({ where: { roomId, userId: otherSales.id } })).toBe(1);
    expect(await prisma.dealRoomMember.count({ where: { roomId } })).toBe(4);
  });

  it('rejects invites that do not fit the deal and lets admin add an inspector', async () => {
    // Supplier account from another supplier cannot be added as this room's supplier.
    const wrongSupplier = await api()
      .post(`/api/v1/deal-rooms/${roomId}/members`)
      .set(auth(sales))
      .send({ userId: otherSupplierUser.id, role: 'supplier' });
    expect(wrongSupplier.status).toBe(400);

    // The deal's own supplier account is fine.
    const ownSupplier = await api()
      .post(`/api/v1/deal-rooms/${roomId}/members`)
      .set(auth(sales))
      .send({ userId: supplierUser.id, role: 'supplier' });
    expect(ownSupplier.status).toBe(201);
    expect(ownSupplier.body.created).toBe(false); // already a member from the fixture

    // Unknown user id.
    const missing = await api()
      .post(`/api/v1/deal-rooms/${roomId}/members`)
      .set(auth(sales))
      .send({ userId: 'ckx0000000000000000000000', role: 'member' });
    expect(missing.status).toBe(400);

    // Admin (not a member) may invite an inspector.
    const invited = await api()
      .post(`/api/v1/deal-rooms/${roomId}/members`)
      .set(auth(admin))
      .send({ userId: inspector.id, role: 'inspector' });
    expect(invited.status).toBe(201);
    expect(invited.body.member.role).toBe('inspector');
    expect((await api().get(`/api/v1/deal-rooms/${roomId}`).set(auth(inspector))).status).toBe(200);
  });

  it('keeps the order total visible but the room hidden from non-members', async () => {
    // Sanity: the outsider cannot infer the order through the room route.
    const denied = await api().get(`/api/v1/deal-rooms/${roomId}`).set(auth(outsiderBuyer));
    expect(denied.status).toBe(404);
    expect(JSON.stringify(denied.body)).not.toContain(String(orderId));
  });
});
