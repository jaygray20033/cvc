import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../app.module';
import { TokenService } from '../auth/token.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { SystemSettingsService } from '../settings/system-settings.service';

// Integration tests for P4.14 (message translation): cache per message+lang,
// daily quota, room access and the automatic-translation label.
// RUN_DB_TESTS=1 required.
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

const EMAIL_PREFIX = 'p4i-test-';
const SUPPLIER_PREFIX = 'P4I Supplier ';
const ORDER_PREFIX = 'P4I-';

let app: INestApplication;
let prisma: PrismaService;
let tokens: TokenService;
let redis: RedisService;
let settings: SystemSettingsService;

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
  await prisma.dealRoom.deleteMany({ where: { id: { in: rooms.map((room) => room.id) } } });
  await prisma.order.deleteMany({ where: { orderNo: { startsWith: ORDER_PREFIX } } });
  const suppliers = await prisma.supplier.findMany({
    where: { name: { startsWith: SUPPLIER_PREFIX } },
    select: { id: true },
  });
  await prisma.supplier.deleteMany({ where: { id: { in: suppliers.map((row) => row.id) } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
  await redis.deleteByPattern('translate:quota:*');
}

async function createRoom(label: string): Promise<string> {
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
      title: `P4I ${label}`,
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
  return room.id;
}

async function createMessage(roomId: string, body: string, senderId = buyer.id): Promise<string> {
  const message = await prisma.message.create({
    data: { roomId, senderId, type: 'TEXT', body },
  });
  return message.id;
}

describeDb('Message translation (P4.14)', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
    redis = app.get(RedisService);
    settings = app.get(SystemSettingsService);
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
    await settings.set('translate.dailyLimit', 100, { sub: admin.id, role: 'admin' });
  }, 90_000);

  afterAll(async () => {
    await settings.set('translate.dailyLimit', 100, { sub: admin.id, role: 'admin' });
    await cleanup();
    await app.close();
  });

  const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.accessToken}` });
  const api = () => request(app.getHttpServer());
  const quotaKey = (user: TestUser) =>
    `translate:quota:${user.id}:${new Date().toISOString().slice(0, 10)}`;

  it('translates once, stores the row, then reuses the cache', async () => {
    const roomId = await createRoom('cache');
    const messageId = await createMessage(roomId, 'Xin chào, báo giá 100 cái');

    const first = await api()
      .post(`/api/v1/messages/${messageId}/translate?lang=vi`)
      .set(auth(buyer));
    expect(first.status).toBe(200);
    expect(first.body.messageId).toBe(messageId);
    expect(first.body.lang).toBe('vi');
    expect(first.body.originalText).toBe('Xin chào, báo giá 100 cái');
    expect(first.body.text).toBe('[vi] Xin chào, báo giá 100 cái');
    expect(first.body.provider).toBe('stub');
    expect(first.body.autoTranslated).toBe(true);
    expect(first.body.cached).toBe(false);

    expect(await prisma.translation.count({ where: { messageId } })).toBe(1);
    expect(Number((await redis.get(quotaKey(buyer))) ?? 0)).toBe(1);

    const second = await api()
      .post(`/api/v1/messages/${messageId}/translate?lang=VI`)
      .set(auth(buyer));
    expect(second.status).toBe(200);
    expect(second.body.lang).toBe('vi');
    expect(second.body.cached).toBe(true);
    expect(second.body.text).toBe(first.body.text);
    // Cache hit does not consume another quota unit; one row per pair.
    expect(Number((await redis.get(quotaKey(buyer))) ?? 0)).toBe(1);
    expect(await prisma.translation.count({ where: { messageId } })).toBe(1);
  });

  it('enforces room access and validates the language', async () => {
    const roomId = await createRoom('access');
    const messageId = await createMessage(roomId, 'Nội bộ');

    expect(
      (await api().post(`/api/v1/messages/${messageId}/translate?lang=en`).set(auth(outsider)))
        .status,
    ).toBe(404);
    expect(
      (
        await api()
          .post('/api/v1/messages/ckx0000000000000000000000/translate?lang=en')
          .set(auth(buyer))
      ).status,
    ).toBe(404);
    expect(
      (await api().post(`/api/v1/messages/${messageId}/translate?lang=english`).set(auth(buyer)))
        .status,
    ).toBe(400);
    expect((await api().post(`/api/v1/messages/${messageId}/translate?lang=en`)).status).toBe(401);
  });

  it('neutralises HTML in translated output', async () => {
    const roomId = await createRoom('xss');
    const messageId = await createMessage(roomId, '&lt;script&gt;alert(1)&lt;/script&gt; giá 50');
    const translated = await api()
      .post(`/api/v1/messages/${messageId}/translate?lang=en`)
      .set(auth(buyer));
    expect(translated.status).toBe(200);
    expect(translated.body.text).not.toContain('<script');
    expect(translated.body.text).toContain('&lt;script&gt;');
  });

  it('blocks new translations when the daily quota is exhausted, cached ones still work', async () => {
    await settings.set('translate.dailyLimit', 2, { sub: admin.id, role: 'admin' });
    const roomId = await createRoom('quota');
    const messageIds = [
      await createMessage(roomId, 'một'),
      await createMessage(roomId, 'hai'),
      await createMessage(roomId, 'ba'),
    ];

    for (const messageId of messageIds.slice(0, 2)) {
      const ok = await api()
        .post(`/api/v1/messages/${messageId}/translate?lang=en`)
        .set(auth(supplierUser));
      expect(ok.status).toBe(200);
      expect(ok.body.cached).toBe(false);
    }

    const blocked = await api()
      .post(`/api/v1/messages/${messageIds[2]}/translate?lang=en`)
      .set(auth(supplierUser));
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('TRANSLATION_QUOTA_EXCEEDED');
    expect(blocked.body.message).toContain('2');

    // The first translation is still served from cache, without quota.
    const cached = await api()
      .post(`/api/v1/messages/${messageIds[0]}/translate?lang=en`)
      .set(auth(supplierUser));
    expect(cached.status).toBe(200);
    expect(cached.body.cached).toBe(true);
  });
});
