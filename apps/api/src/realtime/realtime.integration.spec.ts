import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';

import { AppModule } from '../app.module';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { RealtimeService } from './realtime.service';

// Integration tests for the Socket.IO gateway (P2.20) against the dev stack:
// JWT handshake auth, private user room, deal-room membership policy,
// notification.new push. RUN_DB_TESTS=1 required.
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

const PASSWORD = 'Sup3r-Secret-Pass!';
const EMAIL_PREFIX = 'p2-test-';

let app: INestApplication;
let prisma: PrismaService;
let redis: RedisService;
let notifications: NotificationsService;
let realtime: RealtimeService;
let baseUrl = '';

function makeEmail(): string {
  return `${EMAIL_PREFIX}${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`;
}

interface MailDetail {
  Subject: string;
  Text: string;
}

async function findMailTo(email: string, tries = 5): Promise<MailDetail> {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const list = (await fetch('http://mailpit:8025/api/v1/messages?limit=200').then((r) =>
      r.json(),
    )) as {
      messages?: Array<{ ID: string; To?: Array<{ Address?: string }> }>;
    };
    for (const message of list.messages ?? []) {
      const to = (message.To ?? []).map((item) => item.Address ?? '').join(',');
      if (to === email) {
        return (await fetch(`http://mailpit:8025/api/v1/message/${message.ID}`).then((r) =>
          r.json(),
        )) as MailDetail;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`No mail received for ${email}`);
}

function extractToken(mail: MailDetail): string {
  const match = /token=([a-f0-9]{64})/.exec(mail.Text);
  if (!match) throw new Error('No token found in email body');
  return match[1];
}

// Connects and waits for the connect ack (or first error/disconnect).
function connect(token?: string): Promise<{ socket: Socket; connected: boolean }> {
  return new Promise((resolve) => {
    const socket = io(baseUrl, {
      path: '/ws',
      transports: ['websocket'],
      auth: token ? { token } : {},
      reconnection: false,
      timeout: 3000,
    });
    const done = (connected: boolean): void => {
      resolve({ socket, connected });
    };
    socket.on('connect', () => done(true));
    socket.on('disconnect', () => done(false));
    socket.on('connect_error', () => done(false));
  });
}

// Server-side rejection closes the socket in the same tick as the connect
// ack, so a late 'disconnect' listener can miss it; poll the flag instead.
function waitDisconnected(socket: Socket, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const poll = (): void => {
      if (!socket.connected) resolve(true);
      else if (Date.now() - startedAt > timeoutMs) resolve(false);
      else setTimeout(poll, 100);
    };
    poll();
  });
}

// Emits room:join and resolves the server ack.
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

describeDb('Realtime gateway (integration: P2.20)', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    await app.init();
    await app.listen(0);
    baseUrl = await app.getUrl();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    notifications = app.get(NotificationsService);
    realtime = app.get(RealtimeService);
  });

  beforeEach(async () => {
    await redis.deleteByPattern('*}:hits');
    await redis.deleteByPattern('*}:blocked');
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
    await app.close();
  });

  async function registerAndLogin(email: string): Promise<{ token: string; userId: string }> {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD });
    const mail = await findMailTo(email);
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: extractToken(mail) });
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD });
    expect(login.status).toBe(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    return { token: login.body.accessToken as string, userId: user.id };
  }

  it('rejects a handshake without or with an invalid token', async () => {
    // Server rejects in the same tick as the connect ack, so the client's
    // disconnect event can fire before a late listener attaches — poll the
    // connected flag instead.
    const anon = await connect();
    expect(await waitDisconnected(anon.socket)).toBe(true);
    anon.socket.close();

    const bad = await connect('not-a-jwt');
    expect(await waitDisconnected(bad.socket)).toBe(true);
    bad.socket.close();
  }, 15000);

  it('auto-joins own user room; cannot join other users or unauthorized deal rooms', async () => {
    const emailA = makeEmail();
    const a = await registerAndLogin(emailA);
    const b = await registerAndLogin(makeEmail());

    const session = await connect(a.token);
    expect(session.connected).toBe(true);

    // Own room: ok (already auto-joined, joining again must still be allowed).
    expect(await joinRoom(session.socket, `user:${a.userId}`)).toMatchObject({ ok: true });
    // Other user's room: denied.
    expect(await joinRoom(session.socket, `user:${b.userId}`)).toMatchObject({ ok: false });
    // Deal room without membership: denied.
    expect(await joinRoom(session.socket, 'dealRoom:nope')).toMatchObject({ ok: false });
    // Unknown room shape: denied.
    expect(await joinRoom(session.socket, 'admin:everything')).toMatchObject({ ok: false });

    session.socket.close();
  }, 20000);

  it('granted deal-room membership allows joining the room', async () => {
    const a = await registerAndLogin(makeEmail());
    await realtime.grantDealRoomAccess('room-acc-test', a.userId);

    const session = await connect(a.token);
    expect(await joinRoom(session.socket, 'dealRoom:room-acc-test')).toMatchObject({ ok: true });
    session.socket.close();

    await realtime.revokeDealRoomAccess('room-acc-test', a.userId);
  }, 15000);

  it('notification emit pushes notification.new to the user room only', async () => {
    const a = await registerAndLogin(makeEmail());
    const b = await registerAndLogin(makeEmail());

    const sessionA = await connect(a.token);
    const sessionB = await connect(b.token);

    const receivedA: Array<{ id?: string; title?: string }> = [];
    const receivedB: Array<Record<string, unknown>> = [];
    sessionA.socket.on('notification.new', (payload: { id?: string; title?: string }) =>
      receivedA.push(payload),
    );
    sessionB.socket.on('notification.new', (payload: Record<string, unknown>) =>
      receivedB.push(payload),
    );

    await new Promise((resolve) => setTimeout(resolve, 300));
    await notifications.emit('kyc.status_changed', a.userId, {
      status: 'NEED_MORE',
      reason: 'Ảnh mờ',
    });

    for (let i = 0; i < 20 && receivedA.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(receivedA.length).toBe(1);
    expect(receivedA[0].title).toContain('bổ sung');
    // User B must not receive A's notification.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(receivedB.length).toBe(0);

    sessionA.socket.close();
    sessionB.socket.close();
  }, 20000);
});
