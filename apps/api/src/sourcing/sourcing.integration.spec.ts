import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../app.module';
import { TokenService } from '../auth/token.service';
import { PrismaService } from '../prisma/prisma.service';
import { SourcingRequestsService } from './sourcing-requests.service';

// Integration tests for P4.7 (buyer RFQ) and P4.8 (sales intake, assignment,
// internal notes, SLA reminders). RUN_DB_TESTS=1 required.
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

const EMAIL_PREFIX = 'p4d-test-';

let app: INestApplication;
let prisma: PrismaService;
let tokens: TokenService;
let requestsService: SourcingRequestsService;

interface TestUser {
  id: string;
  email: string;
  accessToken: string;
}

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

describeDb('Sourcing requests (P4.7/P4.8)', () => {
  let buyer: TestUser;
  let buyer2: TestUser;
  let sales: TestUser;
  let admin: TestUser;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
    requestsService = app.get(SourcingRequestsService);
    await cleanup();
    buyer = await createUser(['buyer']);
    buyer2 = await createUser(['buyer']);
    sales = await createUser(['sales']);
    admin = await createUser(['admin']);
  }, 60_000);

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  async function cleanup(): Promise<void> {
    const testUsers = await prisma.user.findMany({
      where: { email: { startsWith: EMAIL_PREFIX } },
      select: { id: true },
    });
    const ids = testUsers.map((user) => user.id);
    await prisma.sourcingRequest.deleteMany({ where: { buyerId: { in: ids } } });
    await prisma.fileObject.deleteMany({ where: { ownerId: 'p4d-file-test' } });
    await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
  }

  const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.accessToken}` });

  async function createReadyFile(): Promise<string> {
    const file = await prisma.fileObject.create({
      data: {
        ownerType: 'sourcing_request',
        ownerId: 'p4d-file-test',
        bucket: 'files',
        s3Key: `p4d/rfq-${Date.now()}-${Math.floor(Math.random() * 1e9)}.png`,
        declaredMime: 'image/png',
        sizeBytes: 512,
        status: 'READY',
        scanStatus: 'CLEAN',
      },
    });
    return file.id;
  }

  function validPayload(overrides: Record<string, unknown> = {}) {
    return {
      title: 'Tìm nguồn bình giữ nhiệt in logo',
      content: 'In 1 màu, dung tích 500ml',
      quantity: 500,
      market: 'Việt Nam',
      targetPrice: 45_000,
      currency: 'VND',
      ...overrides,
    };
  }

  it('RBAC: only buyers create RFQs; only admin/sales use the intake API', async () => {
    const asSales = await request(app.getHttpServer())
      .post('/api/v1/sourcing-requests')
      .set(auth(sales))
      .send(validPayload());
    expect(asSales.status).toBe(403);

    const asBuyerAdmin = await request(app.getHttpServer())
      .get('/api/v1/admin/sourcing-requests')
      .set(auth(buyer));
    expect(asBuyerAdmin.status).toBe(403);

    expect((await request(app.getHttpServer()).get('/api/v1/sourcing-requests')).status).toBe(401);
  });

  it('validation: quantity > 0, valid attachments, future deadline', async () => {
    const zero = await request(app.getHttpServer())
      .post('/api/v1/sourcing-requests')
      .set(auth(buyer))
      .send(validPayload({ quantity: 0 }));
    expect(zero.status).toBe(400);

    const uploading = await prisma.fileObject.create({
      data: {
        ownerType: 'sourcing_request',
        ownerId: 'p4d-file-test',
        bucket: 'files',
        s3Key: `p4d/rfq-uploading-${Date.now()}.png`,
        declaredMime: 'image/png',
        sizeBytes: 512,
        status: 'UPLOADING',
      },
    });
    const badFile = await request(app.getHttpServer())
      .post('/api/v1/sourcing-requests')
      .set(auth(buyer))
      .send(validPayload({ fileObjectIds: [uploading.id] }));
    expect(badFile.status).toBe(400);

    const pastDeadline = await request(app.getHttpServer())
      .post('/api/v1/sourcing-requests')
      .set(auth(buyer))
      .send(validPayload({ expiresAt: new Date(Date.now() - 86_400_000).toISOString() }));
    expect(pastDeadline.status).toBe(400);
  });

  it('buyer creates an RFQ with images; other buyers cannot see or cancel it (DoD)', async () => {
    const fileId = await createReadyFile();
    const created = await request(app.getHttpServer())
      .post('/api/v1/sourcing-requests')
      .set(auth(buyer))
      .send(validPayload({ fileObjectIds: [fileId] }));
    expect(created.status).toBe(201);
    expect(created.body.requestNo).toMatch(/^CVC-RFQ-/);
    expect(created.body.status).toBe('OPEN');
    expect(created.body.attachments).toHaveLength(1);
    expect(created.body.attachments[0].s3Key).toBeTruthy();
    const id = created.body.id as string;

    const mine = await request(app.getHttpServer())
      .get('/api/v1/sourcing-requests')
      .set(auth(buyer));
    expect(mine.status).toBe(200);
    expect(mine.body.items.map((item: { id: string }) => item.id)).toContain(id);

    const otherList = await request(app.getHttpServer())
      .get('/api/v1/sourcing-requests')
      .set(auth(buyer2));
    expect(otherList.body.items.map((item: { id: string }) => item.id)).not.toContain(id);

    expect(
      (await request(app.getHttpServer()).get(`/api/v1/sourcing-requests/${id}`).set(auth(buyer2)))
        .status,
    ).toBe(404);
    expect(
      (
        await request(app.getHttpServer())
          .post(`/api/v1/sourcing-requests/${id}/cancel`)
          .set(auth(buyer2))
      ).status,
    ).toBe(404);

    // Sales were notified about the new request (P4.7).
    const notification = await prisma.notification.findFirst({
      where: { userId: sales.id, event: 'sourcing.request_created' },
      orderBy: { createdAt: 'desc' },
    });
    expect(notification).toBeTruthy();
    expect(notification!.body).toContain(created.body.requestNo);
  });

  it('buyer can cancel before selection, but not twice', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/sourcing-requests')
      .set(auth(buyer))
      .send(validPayload({ title: 'Đơn hủy thử' }));
    const id = created.body.id as string;

    const cancelled = await request(app.getHttpServer())
      .post(`/api/v1/sourcing-requests/${id}/cancel`)
      .set(auth(buyer));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('CANCELLED');

    const again = await request(app.getHttpServer())
      .post(`/api/v1/sourcing-requests/${id}/cancel`)
      .set(auth(buyer));
    expect(again.status).toBe(409);
  });

  it('expired requests flip to EXPIRED and reject cancel/quote selection', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/sourcing-requests')
      .set(auth(buyer))
      .send(validPayload({ expiresAt: new Date(Date.now() + 86_400_000).toISOString() }));
    const id = created.body.id as string;

    // Simulate time passing (cron would also do this via expireDue).
    await prisma.sourcingRequest.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/sourcing-requests/${id}`)
      .set(auth(buyer));
    expect(detail.status).toBe(200);
    expect(detail.body.status).toBe('EXPIRED');

    const cancel = await request(app.getHttpServer())
      .post(`/api/v1/sourcing-requests/${id}/cancel`)
      .set(auth(buyer));
    expect(cancel.status).toBe(409);

    // Quote module guard: no new quotes after expiry.
    await expect(requestsService.assertAcceptingQuotes(id)).rejects.toMatchObject({ status: 409 });
  });

  it('sales intake: list/filter, assign with SLA, notes stay internal (DoD)', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/sourcing-requests')
      .set(auth(buyer))
      .send(validPayload({ title: 'Túi vải canvas' }));
    const id = created.body.id as string;

    const list = await request(app.getHttpServer())
      .get('/api/v1/admin/sourcing-requests?status=OPEN')
      .set(auth(sales));
    expect(list.status).toBe(200);
    expect(list.body.items.map((item: { id: string }) => item.id)).toContain(id);

    const assigned = await request(app.getHttpServer())
      .post(`/api/v1/admin/sourcing-requests/${id}/assign`)
      .set(auth(admin))
      .send({ assigneeId: sales.id, slaDueAt: new Date(Date.now() + 3_600_000).toISOString() });
    expect(assigned.status).toBe(200);
    expect(assigned.body.assignedTo.id).toBe(sales.id);
    expect(assigned.body.slaDueAt).toBeTruthy();

    const badAssignee = await request(app.getHttpServer())
      .post(`/api/v1/admin/sourcing-requests/${id}/assign`)
      .set(auth(admin))
      .send({ assigneeId: buyer.id });
    expect(badAssignee.status).toBe(400);

    const byAssignee = await request(app.getHttpServer())
      .get(`/api/v1/admin/sourcing-requests?assignee=${sales.id}`)
      .set(auth(sales));
    expect(byAssignee.body.items.map((item: { id: string }) => item.id)).toContain(id);

    const noteText = 'Khách khó tính, báo giá tốt nhất trước thứ 6';
    const note = await request(app.getHttpServer())
      .post(`/api/v1/admin/sourcing-requests/${id}/notes`)
      .set(auth(sales))
      .send({ body: noteText });
    expect(note.status).toBe(201);

    const adminDetail = await request(app.getHttpServer())
      .get(`/api/v1/admin/sourcing-requests/${id}`)
      .set(auth(admin));
    expect(adminDetail.body.internalNotes.map((row: { body: string }) => row.body)).toContain(
      noteText,
    );

    // DoD: the internal note never leaks to the buyer's API.
    const buyerDetail = await request(app.getHttpServer())
      .get(`/api/v1/sourcing-requests/${id}`)
      .set(auth(buyer));
    expect(buyerDetail.status).toBe(200);
    expect(JSON.stringify(buyerDetail.body)).not.toContain(noteText);
    expect(buyerDetail.body.internalNotes).toBeUndefined();
    expect(buyerDetail.body.assignedTo).toBeUndefined();
    expect(buyerDetail.body.slaDueAt).toBeUndefined();
  });

  it('SLA sweep pings the assignee once per assignment', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/sourcing-requests')
      .set(auth(buyer))
      .send(validPayload({ title: 'SLA quá hạn' }));
    const id = created.body.id as string;

    await request(app.getHttpServer())
      .post(`/api/v1/admin/sourcing-requests/${id}/assign`)
      .set(auth(sales))
      .send({ assigneeId: sales.id, slaDueAt: new Date(Date.now() - 60_000).toISOString() });

    const first = await requestsService.remindOverdueSla();
    expect(first.reminded).toBeGreaterThanOrEqual(1);
    const overdueNote = await prisma.notification.findFirst({
      where: { userId: sales.id, event: 'sourcing.sla_overdue' },
      orderBy: { createdAt: 'desc' },
    });
    expect(overdueNote).toBeTruthy();

    const second = await requestsService.remindOverdueSla();
    expect(second.reminded).toBe(0);

    // Re-assigning re-arms the reminder.
    await request(app.getHttpServer())
      .post(`/api/v1/admin/sourcing-requests/${id}/assign`)
      .set(auth(sales))
      .send({ assigneeId: sales.id, slaDueAt: new Date(Date.now() - 30_000).toISOString() });
    const third = await requestsService.remindOverdueSla();
    expect(third.reminded).toBeGreaterThanOrEqual(1);
  });
});
