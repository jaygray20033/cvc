import { randomUUID } from 'node:crypto';

import { orderStageIndex } from '@cvc/shared';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type OrderStatus, Prisma } from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../app.module';
import { TokenService } from '../auth/token.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from './payments.service';

// P4.19 A integration — manual P2P payments: request, proof, admin approval
// (short/long/duplicate proof/expired), single ledger post and no automatic
// order transition. RUN_DB_TESTS=1.
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

const EMAIL_PREFIX = 'p4p-test-';
const ORDER_PREFIX = 'P4P-';
const FILE_PREFIX = 'p4p/';

let app: INestApplication;
let prisma: PrismaService;
let tokens: TokenService;
let payments: PaymentsService;

interface TestUser {
  id: string;
  email: string;
  accessToken: string;
}

let buyer: TestUser;
let supplierUser: TestUser;
let finance: TestUser;
let supplierId: string;
let receivingAccountId: string;
const fileIds: string[] = [];

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
  const rows = await prisma.payment.findMany({
    where: { purposeType: 'order', purposeId: { in: orderIds } },
    select: { id: true },
  });
  const paymentIds = rows.map((row) => row.id);
  const ledger = await prisma.ledgerTransaction.findMany({
    where: { refType: 'payment', refId: { in: paymentIds } },
    select: { id: true },
  });
  const transactionIds = ledger.map((row) => row.id);
  await withUnlock(async (tx) => {
    await tx.ledgerEntry.deleteMany({ where: { transactionId: { in: transactionIds } } });
    await tx.ledgerTransaction.deleteMany({ where: { id: { in: transactionIds } } });
  });
  await prisma.paymentProof.deleteMany({ where: { paymentId: { in: paymentIds } } });
  await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
  await prisma.order.deleteMany({ where: { orderNo: { startsWith: ORDER_PREFIX } } });
  await prisma.fileObject.deleteMany({ where: { s3Key: { startsWith: FILE_PREFIX } } });
  await prisma.receivingAccount.deleteMany({ where: { accountNoHash: { startsWith: 'p4p-' } } });
  const suppliers = await prisma.supplier.findMany({
    where: { name: { startsWith: 'P4P Supplier ' } },
    select: { id: true },
  });
  await prisma.supplier.deleteMany({ where: { id: { in: suppliers.map((row) => row.id) } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
}

describeDb('Manual P2P payments (P4.19 A)', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
    payments = app.get(PaymentsService);
    await cleanup();

    buyer = await createUser(['buyer']);
    supplierUser = await createUser(['supplier']);
    finance = await createUser(['admin', 'admin_finance']);

    const supplier = await prisma.supplier.create({
      data: { name: `P4P Supplier ${Date.now()}`, status: 'ACTIVE' },
    });
    supplierId = supplier.id;
    await prisma.supplierAccount.create({
      data: { userId: supplierUser.id, supplierId, isPrimary: true },
    });

    const receiving = await prisma.receivingAccount.create({
      data: {
        bankName: 'Vietcombank',
        holderName: 'CVC P4P',
        accountNoEnc: 'enc',
        accountNoLast4: '4242',
        accountNoHash: `p4p-${randomUUID()}`,
        isDefault: true,
        isActive: true,
      },
    });
    receivingAccountId = receiving.id;
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
        stageIndex: orderStageIndex(status as 'CONTRACT'),
        totalAmount: 2_000_000,
        depositAmount: 1_000_000,
        currency: 'VND',
      },
    });
    return order.id;
  }

  async function createPayment(orderId: string): Promise<{ id: string; [key: string]: unknown }> {
    const response = await api()
      .post(`/api/v1/orders/${orderId}/payments`)
      .set(auth(buyer))
      .send({ kind: 'DEPOSIT' });
    expect(response.status).toBe(201);
    return response.body;
  }

  async function makeFile(ownerId: string, sha256: string): Promise<string> {
    const file = await prisma.fileObject.create({
      data: {
        ownerType: 'user',
        ownerId,
        bucket: 'p4p',
        s3Key: `${FILE_PREFIX}${randomUUID()}`,
        purpose: 'payment_proof',
        declaredMime: 'image/png',
        detectedMime: 'image/png',
        sizeBytes: 10,
        status: 'READY',
        scanStatus: 'CLEAN',
        sha256,
      },
    });
    fileIds.push(file.id);
    return file.id;
  }

  async function submitProof(
    paymentId: string,
    fileObjectId: string,
    transactionRef: string,
    amount = 1_000_000,
  ) {
    return api().post(`/api/v1/payments/${paymentId}/proofs`).set(auth(buyer)).send({
      fileObjectId,
      amount,
      transferredAt: new Date().toISOString(),
      senderBank: 'Techcombank',
      transactionRef,
    });
  }

  it('creates an idempotent deposit request with a unique reference', async () => {
    const orderId = await createOrder('CONTRACT');
    const first = await createPayment(orderId);
    expect(first).toMatchObject({
      kind: 'DEPOSIT',
      status: 'AWAITING_PROOF',
      currency: 'VND',
      reused: false,
      viewerRole: 'buyer',
      canSubmitProof: true,
    });
    expect(Number(first.amount)).toBe(1_000_000);
    expect(Number(first.requestedAmount)).toBe(1_000_000);
    expect(first.referenceCode).toMatch(/^PAY[0-9A-F]{12}$/);
    expect(first.transferContent).toBe(first.referenceCode);
    expect(first.receivingAccount).toMatchObject({
      bankName: 'Vietcombank',
      holderName: 'CVC P4P',
      accountNoMasked: '****4242',
    });
    expect(first.dueAt).toBeTruthy();

    // Second create on the same order reuses the active request (no duplicate).
    const again = await createPayment(orderId);
    expect(again.reused).toBe(true);
    expect(again.id).toBe(first.id);

    // Only the buyer of the order can create requests.
    const supplier = await api()
      .post(`/api/v1/orders/${orderId}/payments`)
      .set(auth(supplierUser))
      .send({ kind: 'DEPOSIT' });
    expect(supplier.status).toBe(403);

    const supplierRead = await api()
      .get(`/api/v1/orders/${orderId}/payments`)
      .set(auth(supplierUser));
    expect(supplierRead.status).toBe(403);

    const list = await api().get(`/api/v1/orders/${orderId}/payments`).set(auth(buyer));
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
  });

  it('rejects reused images and reused transaction references', async () => {
    const orderA = await createOrder('CONTRACT');
    const paymentA = await createPayment(orderA);
    const sharedSha = `sha-${randomUUID()}`;
    const fileA = await makeFile(buyer.id, sharedSha);
    const submitted = await submitProof(paymentA.id, fileA, `TX-${randomUUID()}`);
    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe('PROOF_SUBMITTED');
    expect(submitted.body.proofs).toHaveLength(1);

    const orderB = await createOrder('CONTRACT');
    const paymentB = await createPayment(orderB);
    const fileB = await makeFile(buyer.id, sharedSha);
    const duplicateImage = await submitProof(paymentB.id, fileB, `TX-${randomUUID()}`);
    expect(duplicateImage.status).toBe(409);
    expect(duplicateImage.body.code).toBe('DUPLICATE_PROOF_IMAGE');

    const fileC = await makeFile(buyer.id, `sha-${randomUUID()}`);
    const duplicateRef = await submitProof(
      paymentB.id,
      fileC,
      submitted.body.proofs[0].transactionRef,
    );
    expect(duplicateRef.status).toBe(409);
    expect(duplicateRef.body.code).toBe('DUPLICATE_TRANSACTION_REF');

    // The rejected attempts left the request awaiting a proof.
    const detail = await api().get(`/api/v1/payments/${paymentB.id}`).set(auth(buyer));
    expect(detail.body.status).toBe('AWAITING_PROOF');
    expect(detail.body.proofs).toHaveLength(0);
  });

  it('partial approval posts the ledger once and creates a follow-up request', async () => {
    const orderId = await createOrder('CONTRACT');
    const payment = await createPayment(orderId);
    const fileId = await makeFile(buyer.id, `sha-${randomUUID()}`);
    const proof = await submitProof(payment.id, fileId, `TX-${randomUUID()}`);
    expect(proof.status).toBe(200);

    // Nothing moves before an admin decision.
    const before = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(before.status).toBe('CONTRACT');

    const approved = await api()
      .post(`/api/v1/admin/payments/${payment.id}/approve`)
      .set(auth(finance))
      .send({ receivedAmount: 400_000, note: 'Chuyển thiếu' });
    expect(approved.status).toBe(200);
    expect(approved.body.payment).toMatchObject({
      status: 'PARTIAL',
      approvedAmount: '400000',
    });
    expect(Number(approved.body.followUp.amount)).toBe(600_000);
    expect(approved.body.followUp.status).toBe('AWAITING_PROOF');
    expect(approved.body.ledgerTransactionId).toBeTruthy();

    // Ledger: one transaction, two balanced entries, posted exactly once.
    const transactionId = approved.body.ledgerTransactionId as string;
    const entries = await prisma.ledgerEntry.findMany({
      where: { transactionId },
      include: { account: { select: { code: true } } },
    });
    expect(entries).toHaveLength(2);
    const debit = entries
      .filter((entry) => entry.side === 'DEBIT')
      .reduce((sum, entry) => sum + Number(entry.amount), 0);
    const credit = entries
      .filter((entry) => entry.side === 'CREDIT')
      .reduce((sum, entry) => sum + Number(entry.amount), 0);
    expect(debit).toBe(400_000);
    expect(credit).toBe(400_000);
    expect(entries.find((entry) => entry.side === 'DEBIT')?.account.code).toBe('CVC-BANK');
    expect(entries.find((entry) => entry.side === 'CREDIT')?.account.code).toBe(`CUS-${buyer.id}`);

    const count = await prisma.ledgerTransaction.count({
      where: { refType: 'payment', refId: payment.id },
    });
    expect(count).toBe(1);

    // A second decision is refused: the ledger is never written twice.
    const again = await api()
      .post(`/api/v1/admin/payments/${payment.id}/approve`)
      .set(auth(finance))
      .send({ receivedAmount: 400_000 });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('INVALID_PAYMENT_STATE');

    const after = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(after.status).toBe('CONTRACT');
  });

  it('approves an overpayment and releases the next step only through the state machine', async () => {
    const orderId = await createOrder('DEPOSIT');
    const payment = await createPayment(orderId);
    const fileId = await makeFile(buyer.id, `sha-${randomUUID()}`);
    await submitProof(payment.id, fileId, `TX-${randomUUID()}`);

    const approved = await api()
      .post(`/api/v1/admin/payments/${payment.id}/approve`)
      .set(auth(finance))
      .send({ receivedAmount: 1_500_000, note: 'Chuyển thừa' });
    expect(approved.status).toBe(200);
    expect(approved.body.payment).toMatchObject({
      status: 'APPROVED',
      approvedAmount: '1500000',
    });
    expect(approved.body.followUp).toBeNull();

    const still = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(still.status).toBe('DEPOSIT');

    // Approved money now satisfies the P4.16 deposit guard; the admin must
    // still trigger the transition explicitly.
    const moved = await api()
      .post(`/api/v1/orders/${orderId}/transition`)
      .set(auth(finance))
      .send({ to: 'PRODUCTION' });
    expect(moved.status).toBe(200);
    expect(moved.body.status).toBe('PRODUCTION');

    const count = await prisma.ledgerTransaction.count({
      where: { refType: 'payment', refId: payment.id },
    });
    expect(count).toBe(1);
  });

  it('expires overdue requests and refuses late proofs', async () => {
    const orderId = await createOrder('CONTRACT');
    const payment = await createPayment(orderId);
    await prisma.payment.update({
      where: { id: payment.id },
      data: { dueAt: new Date(Date.now() - 60_000) },
    });

    const fileId = await makeFile(buyer.id, `sha-${randomUUID()}`);
    const late = await submitProof(payment.id, fileId, `TX-${randomUUID()}`);
    expect(late.status).toBe(409);
    expect(late.body.code).toBe('PAYMENT_EXPIRED');

    const detail = await api().get(`/api/v1/payments/${payment.id}`).set(auth(buyer));
    expect(detail.status).toBe(200);
    expect(detail.body.status).toBe('EXPIRED');

    // The cron sweep is idempotent for rows already expired.
    const swept = await payments.expireDue();
    expect(swept).toBeGreaterThanOrEqual(0);
    const stored = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(stored.status).toBe('EXPIRED');
    expect(stored.expiredAt).toBeTruthy();
  });

  it('rejects, requests more proof and enforces finance-only admin routes', async () => {
    const orderId = await createOrder('CONTRACT');
    const payment = await createPayment(orderId);
    const fileId = await makeFile(buyer.id, `sha-${randomUUID()}`);
    await submitProof(payment.id, fileId, `TX-${randomUUID()}`);

    const forbidden = await api()
      .post(`/api/v1/admin/payments/${payment.id}/approve`)
      .set(auth(buyer))
      .send({ receivedAmount: 1_000_000 });
    expect(forbidden.status).toBe(403);

    const nonFinanceAdmin = await createUser(['admin', 'admin_ops']);
    const noGroup = await api()
      .post(`/api/v1/admin/payments/${payment.id}/approve`)
      .set(auth(nonFinanceAdmin))
      .send({ receivedAmount: 1_000_000 });
    expect(noGroup.status).toBe(403);

    const more = await api()
      .post(`/api/v1/admin/payments/${payment.id}/request-more`)
      .set(auth(finance))
      .send({ reason: 'Ảnh mờ, cần chụp lại' });
    expect(more.status).toBe(200);
    expect(more.body.status).toBe('AWAITING_PROOF');

    const reFile = await makeFile(buyer.id, `sha-${randomUUID()}`);
    await submitProof(payment.id, reFile, `TX-${randomUUID()}`);
    const rejected = await api()
      .post(`/api/v1/admin/payments/${payment.id}/reject`)
      .set(auth(finance))
      .send({ reason: 'Không thấy giao dịch trên sao kê' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.status).toBe('REJECTED');

    const queue = await api().get('/api/v1/admin/payments?status=REJECTED').set(auth(finance));
    expect(queue.status).toBe(200);
    expect(queue.body.items.some((row: { id: string }) => row.id === payment.id)).toBe(true);
  });

  it('requires an active receiving account before creating a request', async () => {
    await prisma.receivingAccount.updateMany({
      where: { id: receivingAccountId },
      data: { isActive: false },
    });
    const orderId = await createOrder('CONTRACT');
    const response = await api()
      .post(`/api/v1/orders/${orderId}/payments`)
      .set(auth(buyer))
      .send({ kind: 'DEPOSIT' });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('NO_RECEIVING_ACCOUNT');
    await prisma.receivingAccount.update({
      where: { id: receivingAccountId },
      data: { isActive: true },
    });
  });
});
