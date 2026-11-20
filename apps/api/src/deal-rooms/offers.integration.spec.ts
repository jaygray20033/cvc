import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../app.module';
import { TokenService } from '../auth/token.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

// Integration tests for P4.15 (offers + locked terms): offer/counter/accept
// chain, stale-offer rejection, two-sided term confirmation, immutable
// LockedTerms snapshot and post-lock guards. RUN_DB_TESTS=1 required.
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

const EMAIL_PREFIX = 'p4j-test-';
const SUPPLIER_PREFIX = 'P4J Supplier ';
const ORDER_PREFIX = 'P4J-';
const TERMS_PREFIX = 'p4j';

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
let outsider: TestUser;
let admin: TestUser;
let supplierId: string;
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
  const rooms = await prisma.dealRoom.findMany({
    where: { order: { orderNo: { startsWith: ORDER_PREFIX } } },
    select: { id: true },
  });
  for (const room of rooms) await redis.del(`realtime:dealroom:${room.id}:members`);
  await prisma.dealRoom.deleteMany({ where: { id: { in: rooms.map((room) => room.id) } } });
  await prisma.order.deleteMany({ where: { orderNo: { startsWith: ORDER_PREFIX } } });
  const suppliers = await prisma.supplier.findMany({
    where: { name: { startsWith: SUPPLIER_PREFIX } },
    select: { id: true },
  });
  await prisma.supplier.deleteMany({ where: { id: { in: suppliers.map((row) => row.id) } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
}

async function createRoom(label: string): Promise<{ roomId: string; orderId: string }> {
  const order = await prisma.order.create({
    data: {
      orderNo: `${ORDER_PREFIX}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
      buyerId: buyer.id,
      supplierId,
      status: 'NEGOTIATING',
      stageIndex: 0,
      totalAmount: 1_000_000,
      currency: 'VND',
    },
  });
  const room = await prisma.dealRoom.create({
    data: {
      orderId: order.id,
      title: `P4J ${label}`,
      members: {
        create: [
          { userId: buyer.id, role: 'buyer' },
          { userId: supplierUser.id, role: 'supplier' },
          { userId: sales.id, role: 'sales' },
        ],
      },
    },
  });
  roomIds.push(room.id);
  return { roomId: room.id, orderId: order.id };
}

describeDb('Offers and locked terms (P4.15)', () => {
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
    outsider = await createUser(['buyer']);
    admin = await createUser(['admin']);

    const supplier = await prisma.supplier.create({
      data: { name: `${SUPPLIER_PREFIX}${Date.now()}`, status: 'ACTIVE' },
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

  async function createOffer(roomId: string, user: TestUser, unitPrice: number, quantity: number) {
    return api()
      .post(`/api/v1/deal-rooms/${roomId}/offers`)
      .set(auth(user))
      .send({ unitPrice, quantity });
  }

  async function acceptOffer(offerId: string, user: TestUser) {
    return api().post(`/api/v1/offers/${offerId}/accept`).set(auth(user));
  }

  async function saveTerms(roomId: string, user: TestUser, terms: Record<string, unknown>) {
    return api().put(`/api/v1/deal-rooms/${roomId}/terms`).set(auth(user)).send({ terms });
  }

  async function lockTerms(roomId: string, user: TestUser) {
    return api().post(`/api/v1/deal-rooms/${roomId}/terms/lock`).set(auth(user));
  }

  it('runs the offer -> counter -> accept chain and rejects the countered offer', async () => {
    const { roomId, orderId } = await createRoom('chain');

    const first = await createOffer(roomId, buyer, 120_000, 10);
    expect(first.status).toBe(201);
    expect(first.body.status).toBe('PENDING');
    expect(first.body.side).toBe('buyer');
    expect(Number(first.body.totalAmount)).toBe(1_200_000);

    const counter = await api()
      .post(`/api/v1/offers/${first.body.id}/counter`)
      .set(auth(supplierUser))
      .send({ unitPrice: 130_000, quantity: 10, conditions: 'Giao trong 20 ngày' });
    expect(counter.status).toBe(201);
    expect(counter.body.status).toBe('PENDING');
    expect(counter.body.side).toBe('supplier');
    expect(counter.body.conditions).toBe('Giao trong 20 ngày');

    const original = await prisma.offer.findUniqueOrThrow({ where: { id: first.body.id } });
    expect(original.status).toBe('COUNTERED');

    // DoD: the old (countered) offer can no longer be accepted.
    const stale = await acceptOffer(first.body.id, supplierUser);
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('OFFER_NOT_PENDING');

    // The creator cannot accept their own offer.
    expect((await acceptOffer(counter.body.id, supplierUser)).status).toBe(403);

    const accepted = await acceptOffer(counter.body.id, buyer);
    expect(accepted.status).toBe(200);
    expect(accepted.body.status).toBe('ACCEPTED');
    expect(Number(accepted.body.totalAmount)).toBe(1_300_000);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(Number(order.totalAmount)).toBe(1_300_000);
    const event = await prisma.orderEvent.findFirst({ where: { orderId, type: 'offer.accepted' } });
    expect(event).not.toBeNull();

    // Offer traffic is visible as OFFER messages in the room timeline.
    const timeline = await api().get(`/api/v1/deal-rooms/${roomId}/messages`).set(auth(sales));
    expect(timeline.status).toBe(200);
    const offerMessages = (timeline.body.messages as Array<{ type: string }>).filter(
      (row) => row.type === 'OFFER',
    );
    expect(offerMessages).toHaveLength(3);
  });

  it('cannot accept a still-pending but superseded offer', async () => {
    const { roomId } = await createRoom('superseded');

    const buyerOffer = await createOffer(roomId, buyer, 100_000, 5);
    expect(buyerOffer.status).toBe(201);
    const supplierOffer = await createOffer(roomId, supplierUser, 110_000, 5);
    expect(supplierOffer.status).toBe(201);

    const stale = await acceptOffer(buyerOffer.body.id, supplierUser);
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('OFFER_SUPERSEDED');

    const accepted = await acceptOffer(supplierOffer.body.id, buyer);
    expect(accepted.status).toBe(200);
    expect(Number(accepted.body.totalAmount)).toBe(550_000);
    // Accepting one offer rejects the other pending one.
    const other = await prisma.offer.findUniqueOrThrow({ where: { id: buyerOffer.body.id } });
    expect(other.status).toBe('REJECTED');
  });

  it('restricts offers to the two parties and hides the room from outsiders', async () => {
    const { roomId } = await createRoom('access');

    expect((await createOffer(roomId, outsider, 1, 1)).status).toBe(404);
    expect((await createOffer(roomId, sales, 1, 1)).status).toBe(403);
    expect((await createOffer(roomId, admin, 1, 1)).status).toBe(403);
    expect(
      (await api().get(`/api/v1/deal-rooms/${roomId}/offers`).set(auth(outsider))).status,
    ).toBe(404);
    expect((await api().get(`/api/v1/deal-rooms/${roomId}/offers`).set(auth(buyer))).status).toBe(
      200,
    );

    // Invalid money/quantity surfaces as a validation error.
    const badPrice = await api()
      .post(`/api/v1/deal-rooms/${roomId}/offers`)
      .set(auth(buyer))
      .send({ unitPrice: 1.234, quantity: 2 });
    expect(badPrice.status).toBe(400);
    const badQuantity = await api()
      .post(`/api/v1/deal-rooms/${roomId}/offers`)
      .set(auth(buyer))
      .send({ unitPrice: 10, quantity: 0 });
    expect(badQuantity.status).toBe(400);
  });

  it('requires both sides to confirm the same terms version, then freezes the snapshot', async () => {
    const { roomId, orderId } = await createRoom('lock');

    // No draft yet.
    expect((await lockTerms(roomId, buyer)).status).toBe(409);
    expect((await lockTerms(roomId, buyer)).body.code).toBe('TERMS_NOT_SAVED');

    const saved = await saveTerms(roomId, buyer, {
      productName: 'Hộp quà Tết',
      spec: 'Giấy mỹ thuật 300gsm',
      quantity: 10,
      customSpecs: [{ name: 'Kích thước', value: '20x20cm' }],
    });
    expect(saved.status).toBe(200);
    expect(saved.body.version).toBe(1);
    expect(saved.body.awaiting).toEqual(['buyer', 'supplier']);

    // First side confirms: no snapshot yet.
    const first = await lockTerms(roomId, buyer);
    expect(first.status).toBe(200);
    expect(first.body.locked).toBe(false);
    expect(first.body.confirmedSides).toEqual(['buyer']);
    expect(first.body.awaiting).toEqual(['supplier']);
    expect(await prisma.lockedTerms.count({ where: { orderId } })).toBe(0);

    // Price not agreed yet: the second confirmation cannot lock.
    const noPrice = await lockTerms(roomId, supplierUser);
    expect(noPrice.status).toBe(409);
    expect(noPrice.body.code).toBe('PRICE_NOT_AGREED');

    // Agree a price, then confirm again.
    const offer = await createOffer(roomId, supplierUser, 95_000, 10);
    expect(offer.status).toBe(201);
    expect((await acceptOffer(offer.body.id, buyer)).status).toBe(200);

    const locked = await lockTerms(roomId, supplierUser);
    expect(locked.status).toBe(200);
    expect(locked.body.locked).toBe(true);
    expect(locked.body.version).toBe(1);
    expect(locked.body.awaiting).toEqual([]);

    const room = await prisma.dealRoom.findUniqueOrThrow({ where: { id: roomId } });
    expect(room.status).toBe('LOCKED');
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('SAMPLING');
    expect(order.stageIndex).toBe(1);
    expect(Number(order.totalAmount)).toBe(950_000);

    expect(await prisma.orderStageLog.count({ where: { orderId, stageIndex: 1 } })).toBe(1);
    expect(await prisma.orderEvent.count({ where: { orderId, type: 'terms.locked' } })).toBe(1);

    const snapshot = await prisma.lockedTerms.findUniqueOrThrow({ where: { orderId } });
    expect(snapshot.version).toBe(1);
    expect(snapshot.lockedById).toBe(supplierUser.id);
    const terms = snapshot.terms as Record<string, unknown> & {
      price: { unitPrice: string; quantity: number; offerId: string };
    };
    expect(terms.productName).toBe('Hộp quà Tết');
    expect(terms.price.unitPrice).toBe('95000');
    expect(terms.price.quantity).toBe(10);
    expect(terms.price.offerId).toBe(offer.body.id);

    // Snapshot is DB-immutable: a direct UPDATE is rejected by the trigger
    // and the stored row does not change.
    await expect(
      prisma.lockedTerms.update({ where: { id: snapshot.id }, data: { version: 2 } }),
    ).rejects.toThrow(/LOCKED_TERMS_IMMUTABLE|45000/i);
    const unchanged = await prisma.lockedTerms.findUniqueOrThrow({ where: { orderId } });
    expect(unchanged.version).toBe(1);
    expect(unchanged.terms).toEqual(snapshot.terms);

    // Post-lock edits are blocked until the separate reopen process.
    const editAfterLock = await saveTerms(roomId, buyer, { productName: 'Đổi sau khóa' });
    expect(editAfterLock.status).toBe(409);
    expect(editAfterLock.body.code).toBe('ROOM_LOCKED');
    const offerAfterLock = await createOffer(roomId, buyer, 1, 1);
    expect(offerAfterLock.status).toBe(409);
    expect(offerAfterLock.body.code).toBe('ROOM_LOCKED');

    // Locked state is visible through the read APIs.
    const view = await api().get(`/api/v1/deal-rooms/${roomId}/terms`).set(auth(buyer));
    expect(view.status).toBe(200);
    expect(view.body.locked).toBe(true);
    expect(view.body.snapshot.version).toBe(1);
  });

  it('invalidates confirmations when the terms text changes', async () => {
    const { roomId } = await createRoom('revision');
    await saveTerms(roomId, buyer, { productName: `${TERMS_PREFIX} A` });
    const offer = await createOffer(roomId, supplierUser, 50_000, 2);
    expect((await acceptOffer(offer.body.id, buyer)).status).toBe(200);

    const confirmedByBuyer = await lockTerms(roomId, buyer);
    expect(confirmedByBuyer.body.confirmedSides).toEqual(['buyer']);

    const revised = await saveTerms(roomId, buyer, { productName: `${TERMS_PREFIX} B` });
    expect(revised.status).toBe(200);
    expect(revised.body.version).toBe(2);
    expect(revised.body.confirmedSides).toEqual([]);
    expect(revised.body.awaiting).toEqual(['buyer', 'supplier']);

    // Saving identical content does not bump the version again.
    const same = await saveTerms(roomId, buyer, { productName: `${TERMS_PREFIX} B` });
    expect(same.body.version).toBe(2);

    // Only the supplier's confirmation for v2 counted; buyer must reconfirm.
    const supplierOnly = await lockTerms(roomId, supplierUser);
    expect(supplierOnly.body.locked).toBe(false);
    expect(supplierOnly.body.confirmedSides).toEqual(['supplier']);
    expect(supplierOnly.body.awaiting).toEqual(['buyer']);

    const done = await lockTerms(roomId, buyer);
    expect(done.body.locked).toBe(true);
    expect(done.body.version).toBe(2);
  }, 20_000);

  it('lets staff read offers but not confirm terms', async () => {
    const { roomId } = await createRoom('staff');
    await createOffer(roomId, buyer, 10_000, 1);
    await saveTerms(roomId, buyer, { productName: 'Staff view' });

    expect((await api().get(`/api/v1/deal-rooms/${roomId}/offers`).set(auth(sales))).status).toBe(
      200,
    );
    expect((await api().get(`/api/v1/deal-rooms/${roomId}/terms`).set(auth(admin))).status).toBe(
      200,
    );
    expect((await lockTerms(roomId, sales)).status).toBe(403);
    expect((await saveTerms(roomId, admin, { a: 'b' })).status).toBe(403);
    expect((await lockTerms(roomId, outsider)).status).toBe(404);
  });
});
