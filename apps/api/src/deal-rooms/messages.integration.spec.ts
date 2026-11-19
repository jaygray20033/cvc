import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';

import { AppModule } from '../app.module';
import { TokenService } from '../auth/token.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RedisService } from '../redis/redis.service';
import { DealRoomMessagesService } from './messages.service';

// Integration tests for P4.13 (Deal Room chat): cursor pagination, attachment
// permissions, XSS neutralisation, read receipts, send rate limiting and the
// message.new realtime push between two accounts. RUN_DB_TESTS=1 required.
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

const EMAIL_PREFIX = 'p4h-test-';
const SUPPLIER_PREFIX = 'P4H Supplier ';
const ORDER_PREFIX = 'P4H-';
const FILE_PREFIX = 'p4h/';

let app: INestApplication;
let prisma: PrismaService;
let tokens: TokenService;
let realtime: RealtimeService;
let redis: RedisService;
let messages: DealRoomMessagesService;
let baseUrl = '';

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

const roomIds: string[] = [];
const sockets: Socket[] = [];

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
  await redis.deleteByPattern('chat:send:*');

  await prisma.dealRoom.deleteMany({ where: { id: { in: rooms.map((room) => room.id) } } });
  await prisma.order.deleteMany({ where: { orderNo: { startsWith: ORDER_PREFIX } } });
  await prisma.fileObject.deleteMany({ where: { s3Key: { startsWith: FILE_PREFIX } } });
  const suppliers = await prisma.supplier.findMany({
    where: { name: { startsWith: SUPPLIER_PREFIX } },
    select: { id: true },
  });
  await prisma.supplier.deleteMany({ where: { id: { in: suppliers.map((row) => row.id) } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
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
      title: `P4H ${label}`,
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
  for (const member of [buyer, supplierUser, sales]) {
    await realtime.grantDealRoomAccess(room.id, member.id);
  }
  return room.id;
}

async function createFile(
  owner: TestUser,
  suffix: string,
  overrides: { status?: 'UPLOADING' | 'READY' | 'REJECTED'; scanStatus?: 'CLEAN' | 'PENDING' } = {},
): Promise<string> {
  const file = await prisma.fileObject.create({
    data: {
      ownerType: 'user',
      ownerId: owner.id,
      bucket: 'cvc-private',
      s3Key: `${FILE_PREFIX}${suffix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      declaredMime: 'image/png',
      sizeBytes: 2048,
      status: overrides.status ?? 'READY',
      scanStatus: overrides.scanStatus ?? 'CLEAN',
    },
  });
  return file.id;
}

function connect(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(baseUrl, {
      path: '/ws',
      transports: ['websocket'],
      auth: { token },
      reconnection: false,
      timeout: 3000,
    });
    sockets.push(socket);
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

function joinRoom(socket: Socket, room: string): Promise<{ ok: boolean; reason?: string }> {
  return new Promise((resolve) => {
    socket
      .timeout(3000)
      .emit('room:join', { room }, (err: unknown, ack: { ok: boolean; reason?: string }) => {
        if (err) resolve({ ok: false, reason: 'timeout' });
        else resolve(ack);
      });
  });
}

function onceEvent<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, (payload: T) => resolve(payload)));
}

describeDb('Deal Room chat (P4.13)', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    await app.init();
    await app.listen(0);
    baseUrl = await app.getUrl();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
    realtime = app.get(RealtimeService);
    redis = app.get(RedisService);
    messages = app.get(DealRoomMessagesService);
    await cleanup();

    buyer = await createUser(['buyer']);
    supplierUser = await createUser(['supplier']);
    sales = await createUser(['sales']);
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
    for (const socket of sockets) socket.close();
    await cleanup();
    await app.close();
  });

  const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.accessToken}` });
  const api = () => request(app.getHttpServer());

  it('sends sanitised text and hides the room from outsiders', async () => {
    const roomId = await createRoom('text');

    const sent = await api()
      .post(`/api/v1/deal-rooms/${roomId}/messages`)
      .set(auth(buyer))
      .send({ body: 'Xin chào <script>alert(1)</script><img src=x onerror=alert(1)>' });
    expect(sent.status).toBe(201);
    expect(sent.body.body).toContain('&lt;script&gt;');
    expect(sent.body.body).not.toContain('<script');
    expect(sent.body.body).not.toContain('<img');
    expect(sent.body.sender.id).toBe(buyer.id);
    expect(sent.body.readCount).toBe(1);
    expect(sent.body.readByMe).toBe(true);

    const listed = await api().get(`/api/v1/deal-rooms/${roomId}/messages`).set(auth(supplierUser));
    expect(listed.status).toBe(200);
    expect(listed.body.messages).toHaveLength(1);
    expect(listed.body.messages[0].readByMe).toBe(false);

    // Empty body is rejected by the DTO.
    expect(
      (
        await api()
          .post(`/api/v1/deal-rooms/${roomId}/messages`)
          .set(auth(buyer))
          .send({ body: '   ' })
      ).status,
    ).toBe(400);

    // Outsider cannot read or write.
    expect(
      (await api().get(`/api/v1/deal-rooms/${roomId}/messages`).set(auth(outsider))).status,
    ).toBe(404);
    expect(
      (
        await api()
          .post(`/api/v1/deal-rooms/${roomId}/messages`)
          .set(auth(outsider))
          .send({ body: 'let me in' })
      ).status,
    ).toBe(404);
  });

  it('attaches files with the right permissions and download gate', async () => {
    const roomId = await createRoom('files');
    const cleanFile = await createFile(buyer, 'clean');
    const pendingFile = await createFile(buyer, 'pending', { scanStatus: 'PENDING' });
    const foreignFile = await createFile(supplierUser, 'foreign');

    const withAttachment = await api()
      .post(`/api/v1/deal-rooms/${roomId}/messages`)
      .set(auth(buyer))
      .send({ body: 'Ảnh mẫu', attachmentIds: [cleanFile] });
    expect(withAttachment.status).toBe(201);
    expect(withAttachment.body.attachments).toHaveLength(1);
    const attachmentId = withAttachment.body.attachments[0].id as string;
    expect(withAttachment.body.attachments[0].fileId).toBe(cleanFile);
    expect(withAttachment.body.attachments[0].downloadUrl).toContain(
      `/deal-rooms/${roomId}/attachments/${attachmentId}/download`,
    );
    expect(JSON.stringify(withAttachment.body)).not.toContain('s3Key');

    // Room member (not the uploader) can list and download.
    const supplierList = await api()
      .get(`/api/v1/deal-rooms/${roomId}/messages`)
      .set(auth(supplierUser));
    expect(supplierList.body.messages[0].attachments[0].fileId).toBe(cleanFile);
    const download = await api()
      .get(`/api/v1/deal-rooms/${roomId}/attachments/${attachmentId}/download`)
      .set(auth(supplierUser));
    expect(download.status).toBe(200);
    expect(download.body.url).toBeTruthy();

    // Outsider gets 404 on the attachment route too.
    expect(
      (
        await api()
          .get(`/api/v1/deal-rooms/${roomId}/attachments/${attachmentId}/download`)
          .set(auth(outsider))
      ).status,
    ).toBe(404);

    // Unscanned file: message accepted, download blocked until CLEAN.
    const pending = await api()
      .post(`/api/v1/deal-rooms/${roomId}/messages`)
      .set(auth(buyer))
      .send({ body: 'Tệp đang quét', attachmentIds: [pendingFile] });
    expect(pending.status).toBe(201);
    expect(
      (
        await api()
          .get(
            `/api/v1/deal-rooms/${roomId}/attachments/${pending.body.attachments[0].id}/download`,
          )
          .set(auth(supplierUser))
      ).status,
    ).toBe(403);

    // Cannot attach someone else's file.
    const stolen = await api()
      .post(`/api/v1/deal-rooms/${roomId}/messages`)
      .set(auth(buyer))
      .send({ body: 'Tệp của người khác', attachmentIds: [foreignFile] });
    expect(stolen.status).toBe(403);
  });

  it('paginates messages with an opaque cursor and no duplicates', async () => {
    const roomId = await createRoom('cursor');
    const sentIds: string[] = [];
    for (let index = 1; index <= 7; index += 1) {
      const sent = await api()
        .post(`/api/v1/deal-rooms/${roomId}/messages`)
        .set(auth(buyer))
        .send({ body: `tin ${index}` });
      expect(sent.status).toBe(201);
      sentIds.push(sent.body.id as string);
    }

    const collected: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await api()
        .get(`/api/v1/deal-rooms/${roomId}/messages?limit=3${cursor ? `&cursor=${cursor}` : ''}`)
        .set(auth(supplierUser));
      expect(page.status).toBe(200);
      collected.push(...(page.body.messages as Array<{ id: string }>).map((row) => row.id));
      cursor = page.body.nextCursor as string | null;
      pages += 1;
      expect(pages).toBeLessThan(10);
    } while (cursor);

    expect(collected).toHaveLength(7);
    expect(new Set(collected).size).toBe(7);
    expect(new Set(collected)).toEqual(new Set(sentIds));

    // Unknown cursor is a 400.
    expect(
      (
        await api()
          .get(`/api/v1/deal-rooms/${roomId}/messages?cursor=ckx0000000000000000000000`)
          .set(auth(buyer))
      ).status,
    ).toBe(400);
  });

  it('tracks read receipts up to a message', async () => {
    const roomId = await createRoom('reads');
    const first = await api()
      .post(`/api/v1/deal-rooms/${roomId}/messages`)
      .set(auth(buyer))
      .send({ body: 'tin 1' });
    const second = await api()
      .post(`/api/v1/deal-rooms/${roomId}/messages`)
      .set(auth(buyer))
      .send({ body: 'tin 2' });

    const before = await api().get(`/api/v1/deal-rooms/${roomId}/messages`).set(auth(supplierUser));
    expect(before.body.messages.every((row: { readByMe: boolean }) => !row.readByMe)).toBe(true);

    const marked = await api()
      .post(`/api/v1/deal-rooms/${roomId}/read`)
      .set(auth(supplierUser))
      .send({ messageId: second.body.id });
    expect(marked.status).toBe(200);
    expect(marked.body.marked).toBe(2);

    const after = await api().get(`/api/v1/deal-rooms/${roomId}/messages`).set(auth(buyer));
    const byId = new Map<string, { readCount: number; readByMe: boolean }>(
      (after.body.messages as Array<{ id: string; readCount: number; readByMe: boolean }>).map(
        (row) => [row.id, row],
      ),
    );
    expect(byId.get(first.body.id)!.readCount).toBe(2);
    expect(byId.get(second.body.id)!.readCount).toBe(2);

    // Marking the same message again is a no-op.
    const repeat = await api()
      .post(`/api/v1/deal-rooms/${roomId}/read`)
      .set(auth(supplierUser))
      .send({ messageId: second.body.id });
    expect(repeat.body.marked).toBe(0);
  });

  it('shows status-change SYSTEM messages without a sender', async () => {
    const roomId = await createRoom('system');
    await messages.postSystemMessage(roomId, 'Đơn đã chuyển sang sản xuất');
    const listed = await api().get(`/api/v1/deal-rooms/${roomId}/messages`).set(auth(buyer));
    const system = (
      listed.body.messages as Array<{ type: string; sender: unknown; body: string }>
    ).find((row) => row.type === 'SYSTEM');
    expect(system).toBeTruthy();
    expect(system!.sender).toBeNull();
    expect(system!.body).toContain('sản xuất');
  });

  it('pushes message.new to the other account in realtime', async () => {
    const roomId = await createRoom('realtime');
    const buyerSocket = await connect(buyer.accessToken);
    const supplierSocket = await connect(supplierUser.accessToken);
    expect(await joinRoom(buyerSocket, `dealRoom:${roomId}`)).toMatchObject({ ok: true });
    expect(await joinRoom(supplierSocket, `dealRoom:${roomId}`)).toMatchObject({ ok: true });

    const received = onceEvent<{ body: string; sender: { id: string } }>(
      supplierSocket,
      'message.new',
    );
    const sent = await api()
      .post(`/api/v1/deal-rooms/${roomId}/messages`)
      .set(auth(buyer))
      .send({ body: 'ping realtime' });
    expect(sent.status).toBe(201);
    const pushed = await received;
    expect(pushed.body).toBe('ping realtime');
    expect(pushed.sender.id).toBe(buyer.id);
  }, 20_000);

  it('rate limits a member who floods the room', async () => {
    const roomId = await createRoom('rate');
    let limited: { status: number; body: { code?: string } } | null = null;
    for (let index = 1; index <= 21; index += 1) {
      const sent = await api()
        .post(`/api/v1/deal-rooms/${roomId}/messages`)
        .set(auth(supplierUser))
        .send({ body: `spam ${index}` });
      if (sent.status === 429) limited = sent;
    }
    expect(limited).not.toBeNull();
    expect(limited!.body.code).toBe('RATE_LIMITED');
  }, 30_000);
});
