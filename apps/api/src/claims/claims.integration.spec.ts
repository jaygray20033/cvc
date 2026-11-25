import { randomUUID } from 'node:crypto';

import { orderStageIndex } from '@cvc/shared';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../app.module';
import { TokenService } from '../auth/token.service';
import { PrismaService } from '../prisma/prisma.service';

// P4.22 integration — ports the claim branches of payment-cases-tests.mjs:
// missing → top-up, missing → refund, quality → return+refund, refund cap,
// evidence/window validation, withdraw/reject and the signed-contract view.
// RUN_DB_TESTS=1.
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

const EMAIL_PREFIX = 'p4c-test-';
const ORDER_PREFIX = 'P4C-';
const REQUEST_PREFIX = 'P4C-RFQ-';
const FILE_PREFIX = 'p4c/';
const ACCOUNT_PREFIX = 'p4c-';
const TEMPLATE_PREFIX = 'P4C Template ';

let app: INestApplication;
let prisma: PrismaService;
let tokens: TokenService;

interface TestUser {
  id: string;
  email: string;
  accessToken: string;
}

let buyer: TestUser;
let stranger: TestUser;
let supplierUser: TestUser;
let admin: TestUser;
let finance: TestUser;
let opsAdmin: TestUser;
let supplierId: string;
let receivingAccountId: string;
let templateId: string;

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

async function withUnlock<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET @cvc_ledger_unlocked = 1`;
    const result = await fn(tx);
    await tx.$executeRaw`SET @cvc_ledger_unlocked = NULL`;
    return result;
  });
}

async function cleanup(): Promise<void> {
  const orders = await prisma.order.findMany({
    where: { orderNo: { startsWith: ORDER_PREFIX } },
    select: { id: true },
  });
  const orderIds = orders.map((order) => order.id);
  const refunds = await prisma.refund.findMany({
    where: { orderId: { in: orderIds } },
    select: { id: true },
  });
  const refundIds = refunds.map((row) => row.id);
  const ledger = await prisma.ledgerTransaction.findMany({
    where: { refType: 'refund', refId: { in: refundIds } },
    select: { id: true },
  });
  const transactionIds = ledger.map((row) => row.id);
  await withUnlock(async (tx) => {
    await tx.ledgerEntry.deleteMany({ where: { transactionId: { in: transactionIds } } });
    await tx.ledgerTransaction.deleteMany({ where: { id: { in: transactionIds } } });
    await tx.refund.deleteMany({ where: { id: { in: refundIds } } });
  });
  await prisma.contract.deleteMany({
    where: { ownerType: 'sourcing_order', ownerId: { in: orderIds } },
  });
  await prisma.payment.deleteMany({ where: { purposeType: 'order', purposeId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.sourcingRequest.deleteMany({ where: { requestNo: { startsWith: REQUEST_PREFIX } } });
  await prisma.fileObject.deleteMany({ where: { s3Key: { startsWith: FILE_PREFIX } } });
  await prisma.contractTemplate.deleteMany({ where: { title: { startsWith: TEMPLATE_PREFIX } } });
  await prisma.receivingAccount.deleteMany({
    where: { accountNoHash: { startsWith: ACCOUNT_PREFIX } },
  });
  const suppliers = await prisma.supplier.findMany({
    where: { name: { startsWith: 'P4C Supplier ' } },
    select: { id: true },
  });
  await prisma.supplierAccount.deleteMany({
    where: { supplierId: { in: suppliers.map((row) => row.id) } },
  });
  await prisma.supplier.deleteMany({ where: { id: { in: suppliers.map((row) => row.id) } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
}

describeDb('Claims (P4.22)', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
    await cleanup();

    buyer = await createUser(['buyer']);
    stranger = await createUser(['buyer']);
    supplierUser = await createUser(['supplier']);
    admin = await createUser(['admin', 'admin_ops']);
    finance = await createUser(['admin', 'admin_finance']);
    opsAdmin = await createUser(['admin', 'admin_ops']);

    const supplier = await prisma.supplier.create({
      data: {
        name: `P4C Supplier ${Date.now()}`,
        contactName: `P4C Supplier ${Date.now()}`,
        status: 'ACTIVE',
      },
    });
    supplierId = supplier.id;
    await prisma.supplierAccount.create({
      data: { userId: supplierUser.id, supplierId, isPrimary: true },
    });

    const account = await prisma.receivingAccount.create({
      data: {
        bankName: 'Vietcombank',
        holderName: 'CVC',
        accountNoEnc: 'enc',
        accountNoLast4: '9999',
        accountNoHash: `${ACCOUNT_PREFIX}${randomUUID()}`,
        isDefault: true,
        isActive: true,
      },
    });
    receivingAccountId = account.id;

    const template = await prisma.contractTemplate.create({
      data: {
        type: 'SOURCING',
        version: Math.floor(Date.now() / 1000),
        title: `${TEMPLATE_PREFIX}${Date.now()}`,
        content: 'Hợp đồng mẫu P4C',
      },
    });
    templateId = template.id;
  }, 90_000);

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.accessToken}` });
  const api = () => request(app.getHttpServer());

  async function makeFile(
    ownerId: string,
    options: { status?: 'READY' | 'UPLOADING'; mime?: string } = {},
  ): Promise<string> {
    const file = await prisma.fileObject.create({
      data: {
        ownerType: 'user',
        ownerId,
        bucket: 'p4c',
        s3Key: `${FILE_PREFIX}${randomUUID()}`,
        purpose: 'claim_evidence',
        declaredMime: options.mime ?? 'image/png',
        detectedMime: options.mime ?? 'image/png',
        sizeBytes: 10,
        status: options.status ?? 'READY',
        scanStatus: 'CLEAN',
        sha256: `sha-${randomUUID()}`,
      },
    });
    return file.id;
  }

  async function createOrder(
    options: {
      status?: 'RECEIVED' | 'SHIPPING' | 'PRODUCTION';
      total?: number;
      paid?: number;
      quantity?: number;
      deliveredAt?: Date | null;
      withShipment?: boolean;
      withDocs?: boolean;
    } = {},
  ): Promise<{ orderId: string; requestId: string }> {
    const total = options.total ?? 26_000;
    const quantity = options.quantity ?? 1_000;
    const status = options.status ?? 'RECEIVED';
    const request = await prisma.sourcingRequest.create({
      data: {
        requestNo: `${REQUEST_PREFIX}${randomUUID().slice(0, 12)}`,
        buyerId: buyer.id,
        title: 'P4C RFQ',
        quantity,
        currency: 'VND',
        status: 'OPEN',
      },
    });
    const order = await prisma.order.create({
      data: {
        orderNo: `${ORDER_PREFIX}${randomUUID().slice(0, 12)}`,
        buyerId: buyer.id,
        supplierId,
        sourcingRequestId: request.id,
        status,
        stageIndex: orderStageIndex(status),
        totalAmount: total,
        depositAmount: 0,
        currency: 'VND',
      },
    });
    if (options.withShipment !== false) {
      const deliveredAt = options.deliveredAt === undefined ? new Date() : options.deliveredAt;
      await prisma.shipment.create({
        data: {
          orderId: order.id,
          carrier: 'DEMO Logistics',
          trackingNo: `P4C-${randomUUID().slice(0, 8)}`,
          status: deliveredAt ? 'DELIVERED' : 'IN_TRANSIT',
          shippedAt: new Date(Date.now() - 2 * 86_400_000),
          deliveredAt,
        },
      });
    }
    const paid = options.paid ?? total;
    if (paid > 0) {
      await prisma.payment.create({
        data: {
          paymentNo: `CVC-PAY-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`,
          userId: buyer.id,
          purposeType: 'order',
          purposeId: order.id,
          receivingAccountId,
          amount: paid,
          requestedAmount: paid,
          approvedAmount: paid,
          kind: 'FINAL',
          referenceCode: `PAY${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`,
          currency: 'VND',
          status: 'APPROVED',
          confirmedById: finance.id,
          confirmedAt: new Date(),
        },
      });
    }
    if (options.withDocs !== false) {
      await prisma.lockedTerms.create({
        data: {
          orderId: order.id,
          terms: { product: 'P4C', quantity, unitPrice: total / quantity },
          currency: 'VND',
          lockedById: admin.id,
        },
      });
      await prisma.contract.create({
        data: {
          ownerType: 'sourcing_order',
          ownerId: order.id,
          templateId,
          templateVersion: 1,
          status: 'SIGNED',
          fileHash: `hash-${randomUUID()}`,
        },
      });
    }
    return { orderId: order.id, requestId: request.id };
  }

  async function issue(orderId: string, body: Record<string, unknown>, user: TestUser = buyer) {
    return api().post(`/api/v1/orders/${orderId}/claims`).set(auth(user)).send(body);
  }

  function missingBody(fileObjectId: string, missingQuantity = 20) {
    return {
      kind: 'missing',
      missingQuantity,
      notes: `Thiếu ${missingQuantity} chiếc`,
      evidenceFileObjectIds: [fileObjectId],
    };
  }

  function qualityBody(fileObjectId: string) {
    return {
      kind: 'quality',
      notes: 'Sai chất liệu so với hợp đồng',
      evidenceFileObjectIds: [fileObjectId],
    };
  }

  it('missing → dated proposal → top-up → buyer confirms → CVC closes', async () => {
    const { orderId } = await createOrder();
    const fileId = await makeFile(buyer.id);
    const created = await issue(orderId, missingBody(fileId));
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('OPEN');
    expect(created.body.claimNo).toMatch(/^CVC-CLM-/);
    expect(String(created.body.amount)).toBe('520');
    expect(created.body.evidences).toHaveLength(1);
    const claimId = created.body.id as string;

    // A second open claim is blocked.
    const duplicate = await issue(orderId, missingBody(fileId));
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('CLAIM_ALREADY_OPEN');

    const proposed = await api()
      .post(`/api/v1/claims/${claimId}/proposals`)
      .set(auth(admin))
      .send({ kind: 'REPLACE', note: 'Gửi bù 20 sản phẩm' });
    expect(proposed.status).toBe(200);
    expect(proposed.body.status).toBe('PROPOSED');
    expect(proposed.body.proposedAt).toBeTruthy();

    // A quality-only choice is rejected for a missing claim.
    const wrongChoice = await api()
      .post(`/api/v1/claims/${claimId}/choose-resolution`)
      .set(auth(buyer))
      .send({ choice: 'RETURN_REFUND' });
    expect(wrongChoice.status).toBe(409);
    expect(wrongChoice.body.code).toBe('RESOLUTION_NOT_ALLOWED');

    const chosen = await api()
      .post(`/api/v1/claims/${claimId}/choose-resolution`)
      .set(auth(buyer))
      .send({ choice: 'TOPUP' });
    expect(chosen.status).toBe(200);
    expect(chosen.body.status).toBe('TOPUP_PENDING');

    // The order cannot complete while the claim is still open.
    const blocked = await api()
      .post(`/api/v1/orders/${orderId}/transition`)
      .set(auth(admin))
      .send({ to: 'COMPLETED' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('OPEN_CLAIMS');

    const earlyConfirm = await api()
      .post(`/api/v1/claims/${claimId}/topup/confirm`)
      .set(auth(buyer))
      .send({});
    expect(earlyConfirm.status).toBe(409);
    expect(earlyConfirm.body.code).toBe('TOPUP_NOT_DELIVERED');

    for (let stage = 1; stage <= 3; stage += 1) {
      const moved = await api()
        .post(`/api/v1/claims/${claimId}/topup`)
        .set(auth(supplierUser))
        .send({ note: `Bước ${stage}` });
      expect(moved.status).toBe(200);
      expect(moved.body.topupStage).toBe(stage);
    }
    const overMove = await api()
      .post(`/api/v1/claims/${claimId}/topup`)
      .set(auth(supplierUser))
      .send({});
    expect(overMove.status).toBe(409);

    const confirmed = await api()
      .post(`/api/v1/claims/${claimId}/topup/confirm`)
      .set(auth(buyer))
      .send({});
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe('TOPUP_CONFIRMED');
    expect(confirmed.body.refunds).toHaveLength(0);

    const closed = await api()
      .post(`/api/v1/admin/claims/${claimId}/resolve`)
      .set(auth(admin))
      .send({ decision: 'ACCEPT', note: 'Đã nhận đủ hàng bù' });
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe('CLOSED');
    expect(closed.body.resolution.decision).toBe('REPLACE');

    const done = await api()
      .post(`/api/v1/orders/${orderId}/transition`)
      .set(auth(admin))
      .send({ to: 'COMPLETED' });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('COMPLETED');
  });

  it('missing → refund posts the ledger once and cannot exceed the claim/paid amount', async () => {
    const { orderId } = await createOrder();
    const fileId = await makeFile(buyer.id);
    const created = await issue(orderId, missingBody(fileId));
    expect(created.status).toBe(201);
    const claimId = created.body.id as string;

    await api()
      .post(`/api/v1/claims/${claimId}/proposals`)
      .set(auth(supplierUser))
      .send({ kind: 'REFUND', amount: 520 });
    const chosen = await api()
      .post(`/api/v1/claims/${claimId}/choose-resolution`)
      .set(auth(buyer))
      .send({ choice: 'REFUND' });
    expect(chosen.body.status).toBe('RESOLUTION_CHOSEN');

    // Ops admin cannot move money; finance can.
    const wrongGroup = await api()
      .post(`/api/v1/admin/claims/${claimId}/execute-refund`)
      .set(auth(opsAdmin))
      .send({ amount: 520 });
    expect(wrongGroup.status).toBe(403);
    const buyerTry = await api()
      .post(`/api/v1/admin/claims/${claimId}/execute-refund`)
      .set(auth(buyer))
      .send({ amount: 520 });
    expect(buyerTry.status).toBe(403);

    const overClaim = await api()
      .post(`/api/v1/admin/claims/${claimId}/execute-refund`)
      .set(auth(finance))
      .send({ amount: 1_000 });
    expect(overClaim.status).toBe(409);
    expect(overClaim.body.code).toBe('REFUND_EXCEEDS_CLAIM');

    const refunded = await api()
      .post(`/api/v1/admin/claims/${claimId}/execute-refund`)
      .set(auth(finance))
      .send({ amount: 520, method: 'BANK_TRANSFER', paymentRef: 'FT-P4C-1' });
    expect(refunded.status).toBe(200);
    expect(refunded.body.claim.status).toBe('REFUND_EXECUTED');
    expect(String(refunded.body.refund.amount)).toBe('520');
    expect(refunded.body.ledgerTransactionId).toBeTruthy();

    // Ledger balanced and only one transaction for the refund.
    const ledger = await prisma.ledgerTransaction.findUniqueOrThrow({
      where: { id: refunded.body.ledgerTransactionId as string },
      include: { entries: true },
    });
    expect(ledger.entries).toHaveLength(2);
    const debit = ledger.entries
      .filter((row) => row.side === 'DEBIT')
      .reduce((sum, row) => sum.add(row.amount), new Prisma.Decimal(0));
    const credit = ledger.entries
      .filter((row) => row.side === 'CREDIT')
      .reduce((sum, row) => sum.add(row.amount), new Prisma.Decimal(0));
    expect(debit.equals(credit)).toBe(true);

    const again = await api()
      .post(`/api/v1/admin/claims/${claimId}/execute-refund`)
      .set(auth(finance))
      .send({ amount: 520 });
    expect(again.status).toBe(409);

    const confirmed = await api()
      .post(`/api/v1/claims/${claimId}/confirm-refund`)
      .set(auth(buyer))
      .send({ received: true, match: true });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe('REFUND_CONFIRMED');

    const closed = await api()
      .post(`/api/v1/admin/claims/${claimId}/resolve`)
      .set(auth(admin))
      .send({ decision: 'ACCEPT' });
    expect(closed.body.status).toBe('CLOSED');
    expect(closed.body.resolution.decision).toBe('REFUND');
  });

  it('refund is capped by the money actually collected', async () => {
    const { orderId } = await createOrder({ total: 26_000, paid: 10_000 });
    const fileId = await makeFile(buyer.id);
    const created = await issue(orderId, missingBody(fileId, 1_000));
    expect(String(created.body.amount)).toBe('26000');
    const claimId = created.body.id as string;
    await api()
      .post(`/api/v1/claims/${claimId}/proposals`)
      .set(auth(admin))
      .send({ kind: 'REFUND' });
    const chosen = await api()
      .post(`/api/v1/claims/${claimId}/choose-resolution`)
      .set(auth(buyer))
      .send({ choice: 'REFUND' });
    expect(chosen.body.status).toBe('RESOLUTION_CHOSEN');

    const overPaid = await api()
      .post(`/api/v1/admin/claims/${claimId}/execute-refund`)
      .set(auth(finance))
      .send({ amount: 26_000 });
    expect(overPaid.status).toBe(409);
    expect(overPaid.body.code).toBe('REFUND_EXCEEDS_PAID');

    const partial = await api()
      .post(`/api/v1/admin/claims/${claimId}/execute-refund`)
      .set(auth(finance))
      .send({ amount: 10_000 });
    expect(partial.status).toBe(200);
    expect(String(partial.body.refund.amount)).toBe('10000');
  });

  it('quality → return all → CVC receives → full refund closes the claim', async () => {
    const { orderId } = await createOrder({ total: 26_000, paid: 26_000 });
    const fileId = await makeFile(buyer.id);
    const created = await issue(orderId, qualityBody(fileId));
    expect(created.status).toBe(201);
    expect(String(created.body.amount)).toBe('26000');
    expect(created.body.orderedQuantity).toBe(1_000);
    const claimId = created.body.id as string;

    await api()
      .post(`/api/v1/claims/${claimId}/proposals`)
      .set(auth(admin))
      .send({ kind: 'RETURN' });

    const earlyRefund = await api()
      .post(`/api/v1/admin/claims/${claimId}/execute-refund`)
      .set(auth(finance))
      .send({});
    expect(earlyRefund.status).toBe(409);

    const chosen = await api()
      .post(`/api/v1/claims/${claimId}/choose-resolution`)
      .set(auth(buyer))
      .send({ choice: 'RETURN_REFUND' });
    expect(chosen.body.status).toBe('RESOLUTION_CHOSEN');

    const wrongChoice = await api()
      .post(`/api/v1/claims/${claimId}/choose-resolution`)
      .set(auth(buyer))
      .send({ choice: 'TOPUP' });
    expect(wrongChoice.status).toBe(409);

    const noConsent = await api()
      .post(`/api/v1/claims/${claimId}/return/ship`)
      .set(auth(buyer))
      .send({ carrier: 'DEMO', trackingNo: 'RETURN-P4C-1' });
    expect(noConsent.status).toBe(400);

    const shipped = await api()
      .post(`/api/v1/claims/${claimId}/return/ship`)
      .set(auth(buyer))
      .send({ carrier: 'DEMO', trackingNo: 'RETURN-P4C-1', consent: true });
    expect(shipped.status).toBe(200);
    expect(shipped.body.status).toBe('RETURN_SENT');
    expect(shipped.body.returns[0]).toMatchObject({
      direction: 'RETURN_TO_SUPPLIER',
      trackingNo: 'RETURN-P4C-1',
    });

    const refundBeforeReceipt = await api()
      .post(`/api/v1/admin/claims/${claimId}/execute-refund`)
      .set(auth(finance))
      .send({});
    expect(refundBeforeReceipt.status).toBe(409);

    const buyerReceive = await api()
      .post(`/api/v1/claims/${claimId}/return/receive`)
      .set(auth(buyer))
      .send({});
    expect(buyerReceive.status).toBe(403);

    // Supplier payouts wait for open claims.
    const payoutBlocked = await api()
      .post(`/api/v1/admin/orders/${orderId}/supplier-payouts`)
      .set(auth(finance))
      .send({ amount: 1_000, reason: 'Chi thử' });
    expect(payoutBlocked.status).toBe(409);
    expect(payoutBlocked.body.code).toBe('OPEN_CLAIMS');

    const received = await api()
      .post(`/api/v1/claims/${claimId}/return/receive`)
      .set(auth(admin))
      .send({});
    expect(received.status).toBe(200);
    expect(received.body.status).toBe('RETURN_RECEIVED');
    expect(received.body.returns[0].status).toBe('DELIVERED');

    const refunded = await api()
      .post(`/api/v1/admin/claims/${claimId}/execute-refund`)
      .set(auth(finance))
      .send({});
    expect(refunded.status).toBe(200);
    expect(String(refunded.body.refund.amount)).toBe('26000');

    const confirmed = await api()
      .post(`/api/v1/claims/${claimId}/confirm-refund`)
      .set(auth(buyer))
      .send({ received: true });
    expect(confirmed.body.status).toBe('REFUND_CONFIRMED');

    const closed = await api()
      .post(`/api/v1/admin/claims/${claimId}/resolve`)
      .set(auth(admin))
      .send({ decision: 'ACCEPT' });
    expect(closed.body.status).toBe('CLOSED');
    expect(closed.body.resolution.decision).toBe('REFUND');
  });

  it('validation blocks bad quantities, missing/foreign evidence and late claims', async () => {
    const orderA = await createOrder();
    const fileId = await makeFile(buyer.id);
    const foreignFile = await makeFile(stranger.id);
    const pendingFile = await makeFile(buyer.id, { status: 'UPLOADING' });

    for (const missing of [0, 1.5, 1001, -1]) {
      const res = await issue(orderA.orderId, missingBody(fileId, missing));
      expect([400, 409]).toContain(res.status);
    }
    const noEvidence = await issue(orderA.orderId, {
      kind: 'quality',
      notes: 'Không có ảnh',
      evidenceFileObjectIds: [],
    });
    expect(noEvidence.status).toBe(400);
    const missingNotes = await issue(orderA.orderId, {
      kind: 'quality',
      notes: '',
      evidenceFileObjectIds: [fileId],
    });
    expect(missingNotes.status).toBe(400);
    const foreign = await issue(orderA.orderId, qualityBody(foreignFile));
    expect(foreign.status).toBe(403);
    const pending = await issue(orderA.orderId, qualityBody(pendingFile));
    expect(pending.status).toBe(409);
    expect(pending.body.code).toBe('FILE_NOT_READY');

    const notDelivered = await createOrder({ status: 'SHIPPING', withShipment: false });
    const tooEarly = await issue(notDelivered.orderId, qualityBody(fileId));
    expect(tooEarly.status).toBe(409);
    expect(tooEarly.body.code).toBe('DELIVERY_NOT_RECORDED');

    const production = await createOrder({ status: 'PRODUCTION' });
    const beforeShipment = await issue(production.orderId, qualityBody(fileId));
    expect(beforeShipment.status).toBe(409);
    expect(beforeShipment.body.code).toBe('ORDER_NOT_DELIVERED');

    const old = await createOrder({
      deliveredAt: new Date(Date.now() - 30 * 86_400_000),
    });
    const late = await issue(old.orderId, qualityBody(fileId));
    expect(late.status).toBe(409);
    expect(late.body.code).toBe('CLAIM_WINDOW_EXPIRED');

    const supplierTry = await issue(orderA.orderId, qualityBody(fileId), supplierUser);
    expect(supplierTry.status).toBe(403);
  });

  it('buyer can withdraw, CVC can reject; closed claims reject further money moves', async () => {
    const first = await createOrder();
    const fileId = await makeFile(buyer.id);
    const created = await issue(first.orderId, missingBody(fileId));
    const claimId = created.body.id as string;
    const withdrawn = await api()
      .post(`/api/v1/claims/${claimId}/withdraw`)
      .set(auth(buyer))
      .send({ reason: 'Đã thoả thuận với nhà cung cấp' });
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.status).toBe('WITHDRAWN');

    const second = await createOrder();
    const secondFile = await makeFile(buyer.id);
    const rejectedClaim = await issue(second.orderId, qualityBody(secondFile));
    const rejectedId = rejectedClaim.body.id as string;
    await api()
      .post(`/api/v1/claims/${rejectedId}/proposals`)
      .set(auth(admin))
      .send({ kind: 'RETURN' });
    const rejected = await api()
      .post(`/api/v1/admin/claims/${rejectedId}/resolve`)
      .set(auth(admin))
      .send({ decision: 'REJECT', note: 'Hàng đúng thông số hợp đồng' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.status).toBe('REJECTED');
    expect(rejected.body.resolution.decision).toBe('REJECT');

    const chooseAfterReject = await api()
      .post(`/api/v1/claims/${rejectedId}/choose-resolution`)
      .set(auth(buyer))
      .send({ choice: 'RETURN_REFUND' });
    expect(chooseAfterReject.status).toBe(409);
  });

  it('detail exposes mandatory evidence plus LockedTerms and the signed contract', async () => {
    const { orderId } = await createOrder({ withDocs: true });
    const fileId = await makeFile(buyer.id);
    const created = await issue(orderId, qualityBody(fileId));
    const claimId = created.body.id as string;

    const view = await api().get(`/api/v1/claims/${claimId}`).set(auth(admin));
    expect(view.status).toBe(200);
    expect(view.body.evidences).toHaveLength(1);
    expect(view.body.evidences[0].fileObjectId).toBe(fileId);
    expect(view.body.lockedTerms.id).toBeTruthy();
    expect(view.body.contract.id).toBeTruthy();
    expect(view.body.contract.status).toBe('SIGNED');
    expect(view.body.canExecuteRefund).toBe(false);
    expect(view.body.canReject).toBe(true);

    const supplierView = await api().get(`/api/v1/claims/${claimId}`).set(auth(supplierUser));
    expect(supplierView.status).toBe(200);
    expect(supplierView.body.lockedTerms).toBeTruthy();

    const outsider = await api().get(`/api/v1/claims/${claimId}`).set(auth(stranger));
    expect(outsider.status).toBe(404);

    const adminList = await api().get(`/api/v1/admin/claims?orderId=${orderId}`).set(auth(admin));
    expect(adminList.status).toBe(200);
    expect(adminList.body.total).toBe(1);
    expect(adminList.body.items[0].id).toBe(claimId);
  });
});
