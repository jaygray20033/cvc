import { randomUUID } from 'node:crypto';

import { orderStageIndex } from '@cvc/shared';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../app.module';
import { TokenService } from '../auth/token.service';
import { PrismaService } from '../prisma/prisma.service';
import { PayoutsService } from './payouts.service';

// P4.20 integration — manual supplier payouts: verified receiving account,
// two-layer approval above the threshold, single ledger post on mark-paid,
// supplier confirmation/auto-confirm and immutable transfer proof.
// RUN_DB_TESTS=1.
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

const EMAIL_PREFIX = 'p4x-test-';
const ORDER_PREFIX = 'P4X-';
const FILE_PREFIX = 'p4x/';

let app: INestApplication;
let prisma: PrismaService;
let tokens: TokenService;
let payouts: PayoutsService;

interface TestUser {
  id: string;
  email: string;
  accessToken: string;
}

let buyer: TestUser;
let supplierUser: TestUser;
let finance1: TestUser;
let finance2: TestUser;
let opsAdmin: TestUser;
let supplierId: string;
let supplierBankId: string;
let wrongHolderBankId: string;
let buyerBankId: string;

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
  const rows = await prisma.payout.findMany({
    where: { purposeType: 'order', purposeId: { in: orderIds } },
    select: { id: true },
  });
  const payoutIds = rows.map((row) => row.id);
  const ledger = await prisma.ledgerTransaction.findMany({
    where: { refType: 'payout', refId: { in: payoutIds } },
    select: { id: true },
  });
  const transactionIds = ledger.map((row) => row.id);
  await withUnlock(async (tx) => {
    await tx.ledgerEntry.deleteMany({ where: { transactionId: { in: transactionIds } } });
    await tx.ledgerTransaction.deleteMany({ where: { id: { in: transactionIds } } });
    await tx.payoutProof.deleteMany({ where: { payoutId: { in: payoutIds } } });
  });
  await prisma.payout.deleteMany({ where: { id: { in: payoutIds } } });
  await prisma.order.deleteMany({ where: { orderNo: { startsWith: ORDER_PREFIX } } });
  await prisma.fileObject.deleteMany({ where: { s3Key: { startsWith: FILE_PREFIX } } });
  await prisma.bankAccount.deleteMany({ where: { accountNoHash: { startsWith: 'p4x-' } } });
  const suppliers = await prisma.supplier.findMany({
    where: { name: { startsWith: 'P4X Supplier ' } },
    select: { id: true },
  });
  await prisma.supplier.deleteMany({ where: { id: { in: suppliers.map((row) => row.id) } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
}

describeDb('Manual supplier payouts (P4.20)', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
    payouts = app.get(PayoutsService);
    await cleanup();

    buyer = await createUser(['buyer']);
    supplierUser = await createUser(['supplier']);
    finance1 = await createUser(['admin', 'admin_finance']);
    finance2 = await createUser(['admin', 'admin_finance']);
    opsAdmin = await createUser(['admin', 'admin_ops']);

    const supplier = await prisma.supplier.create({
      data: {
        name: `P4X Supplier ${Date.now()}`,
        contactName: `P4X Supplier ${Date.now()}`,
        status: 'ACTIVE',
      },
    });
    supplierId = supplier.id;
    await prisma.supplierAccount.create({
      data: { userId: supplierUser.id, supplierId, isPrimary: true },
    });

    const supplierBank = await prisma.bankAccount.create({
      data: {
        userId: supplierUser.id,
        bankName: 'VietinBank',
        holderName: supplier.name,
        accountNoEnc: 'enc',
        accountNoLast4: '8888',
        accountNoHash: `p4x-${randomUUID()}`,
        isDefault: true,
      },
    });
    supplierBankId = supplierBank.id;

    const wrongHolder = await prisma.bankAccount.create({
      data: {
        userId: supplierUser.id,
        bankName: 'VietinBank',
        holderName: 'Người Không Khớp',
        accountNoEnc: 'enc',
        accountNoLast4: '7777',
        accountNoHash: `p4x-${randomUUID()}`,
      },
    });
    wrongHolderBankId = wrongHolder.id;

    const buyerBank = await prisma.bankAccount.create({
      data: {
        userId: buyer.id,
        bankName: 'Techcombank',
        holderName: 'Khách Hàng',
        accountNoEnc: 'enc',
        accountNoLast4: '6666',
        accountNoHash: `p4x-${randomUUID()}`,
      },
    });
    buyerBankId = buyerBank.id;
  }, 90_000);

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.accessToken}` });
  const api = () => request(app.getHttpServer());

  async function createOrder(totalAmount = 100_000_000): Promise<string> {
    const order = await prisma.order.create({
      data: {
        orderNo: `${ORDER_PREFIX}${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`,
        buyerId: buyer.id,
        supplierId,
        status: 'RECEIVED',
        stageIndex: orderStageIndex('RECEIVED'),
        totalAmount,
        depositAmount: 0,
        currency: 'VND',
      },
    });
    return order.id;
  }

  async function createPayout(orderId: string, amount: number, bankAccountId = supplierBankId) {
    return api().post(`/api/v1/admin/orders/${orderId}/supplier-payouts`).set(auth(finance1)).send({
      amount,
      bankAccountId,
      reason: 'Thanh toán lô hàng theo đơn',
    });
  }

  async function makeFile(ownerId: string): Promise<string> {
    const file = await prisma.fileObject.create({
      data: {
        ownerType: 'user',
        ownerId,
        bucket: 'p4x',
        s3Key: `${FILE_PREFIX}${randomUUID()}`,
        purpose: 'payout_proof',
        declaredMime: 'image/png',
        detectedMime: 'image/png',
        sizeBytes: 10,
        status: 'READY',
        scanStatus: 'CLEAN',
        sha256: `sha-${randomUUID()}`,
      },
    });
    return file.id;
  }

  function approve(payoutId: string, user: TestUser) {
    return api()
      .post(`/api/v1/admin/payouts/${payoutId}/approve`)
      .set(auth(user))
      .send({ note: 'Duyệt chi' });
  }

  function markPaid(payoutId: string, fileObjectId: string, transactionRef: string) {
    return api()
      .post(`/api/v1/admin/payouts/${payoutId}/mark-paid`)
      .set(auth(finance1))
      .send({ fileObjectId, transactionRef });
  }

  it('validates the verified receiving account and order ceiling', async () => {
    const orderId = await createOrder();

    const missing = await api()
      .post(`/api/v1/admin/orders/${orderId}/supplier-payouts`)
      .set(auth(finance1))
      .send({ amount: 1_000_000, reason: 'Chi thử' });
    expect(missing.status).toBe(409);
    expect(missing.body.code).toBe('PAYOUT_BANK_ACCOUNT_REQUIRED');

    const wrongHolder = await createPayout(orderId, 1_000_000, wrongHolderBankId);
    expect(wrongHolder.status).toBe(400);
    expect(wrongHolder.body.code).toBe('PAYOUT_HOLDER_MISMATCH');

    const buyerAccount = await createPayout(orderId, 1_000_000, buyerBankId);
    expect(buyerAccount.status).toBe(400);
    expect(buyerAccount.body.code).toBe('PAYOUT_BANK_ACCOUNT_NOT_VERIFIED');

    const overOrder = await createPayout(orderId, 200_000_000);
    expect(overOrder.status).toBe(409);
    expect(overOrder.body.code).toBe('PAYOUT_EXCEEDS_ORDER');

    const nonFinance = await api()
      .post(`/api/v1/admin/orders/${orderId}/supplier-payouts`)
      .set(auth(opsAdmin))
      .send({ amount: 1_000_000, bankAccountId: supplierBankId, reason: 'Chi thử' });
    expect(nonFinance.status).toBe(403);

    const created = await createPayout(orderId, 1_000_000);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      status: 'PENDING',
      payeeType: 'supplier',
      payeeId: supplierId,
      approvalCount: 0,
      requiresSecondApproval: false,
    });
    expect(String(created.body.amount)).toBe('1000000');
    expect(created.body.referenceCode).toMatch(/^PO[0-9A-F]{12}$/);
    expect(created.body.bankAccount).toMatchObject({ accountNoMasked: '****8888' });
    expect(created.body.supplierName).toMatch(/^P4X Supplier /);

    // Supplier sees its own payout; buyers never do.
    const supplierView = await api()
      .get(`/api/v1/payouts/${created.body.id}`)
      .set(auth(supplierUser));
    expect(supplierView.status).toBe(200);
    // Buyer role is not allowed on payout routes at all.
    expect((await api().get(`/api/v1/payouts/${created.body.id}`).set(auth(buyer))).status).toBe(
      403,
    );
    expect((await api().get(`/api/v1/payouts/${created.body.id}`).set(auth(finance1))).status).toBe(
      200,
    );
  });

  it('requires two different approvers above the threshold and posts the ledger once', async () => {
    const orderId = await createOrder(100_000_000);
    const created = await createPayout(orderId, 60_000_000);
    expect(created.status).toBe(201);
    const payoutId = created.body.id as string;

    const first = await approve(payoutId, finance1);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('PENDING');
    expect(first.body.approvalCount).toBe(1);
    expect(first.body.requiresSecondApproval).toBe(true);

    const samePerson = await approve(payoutId, finance1);
    expect(samePerson.status).toBe(409);
    expect(samePerson.body.code).toBe('PAYOUT_SECOND_APPROVER_REQUIRED');

    const second = await approve(payoutId, finance2);
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('APPROVED');
    expect(second.body.approvalCount).toBe(2);
    expect(second.body.approvedById).toBe(finance2.id);

    // Paying needs a proof file owned by the admin who transferred it.
    const foreignFile = await makeFile(supplierUser.id);
    const foreignProof = await markPaid(payoutId, foreignFile, `PO-TX-${randomUUID()}`);
    expect(foreignProof.status).toBe(403);

    const fileId = await makeFile(finance1.id);
    const transactionRef = `PO-TX-${randomUUID()}`;
    const paid = await markPaid(payoutId, fileId, transactionRef);
    expect(paid.status).toBe(200);
    expect(paid.body.status).toBe('COMPLETED');
    expect(paid.body.transactionRef).toBe(transactionRef);
    expect(paid.body.proofs).toHaveLength(1);
    expect(paid.body.ledgerTransactionId).toBeTruthy();

    // Ledger: exactly one transaction, two balanced entries.
    const transactionId = paid.body.ledgerTransactionId as string;
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
    expect(debit).toBe(60_000_000);
    expect(credit).toBe(60_000_000);
    expect(entries.find((entry) => entry.side === 'DEBIT')?.account.code).toBe(`SUP-${supplierId}`);
    expect(entries.find((entry) => entry.side === 'CREDIT')?.account.code).toBe('CVC-BANK');
    expect(
      await prisma.ledgerTransaction.count({ where: { refType: 'payout', refId: payoutId } }),
    ).toBe(1);

    // Double mark-paid is refused; the ledger is never posted twice.
    const again = await markPaid(payoutId, fileId, transactionRef);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('INVALID_PAYOUT_STATE');

    // Proof of transfer is immutable at the DB level.
    const proof = await prisma.payoutProof.findFirstOrThrow({ where: { payoutId } });
    await expect(
      prisma.payoutProof.update({ where: { id: proof.id }, data: { note: 'sửa' } }),
    ).rejects.toThrow();

    // Supplier confirms the money arrived; a second call is idempotent.
    const confirmed = await api()
      .post(`/api/v1/payouts/${payoutId}/confirm-received`)
      .set(auth(supplierUser))
      .send({ note: 'Đã nhận đủ' });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.confirmedAt).toBeTruthy();
    expect(confirmed.body.alreadyConfirmed).toBe(false);

    const confirmedAgain = await api()
      .post(`/api/v1/payouts/${payoutId}/confirm-received`)
      .set(auth(supplierUser))
      .send({});
    expect(confirmedAgain.status).toBe(200);
    expect(confirmedAgain.body.alreadyConfirmed).toBe(true);
  });

  it('approves small payouts in one layer and blocks duplicate proofs/refs', async () => {
    const orderId = await createOrder(10_000_000);
    const first = await createPayout(orderId, 1_000_000);
    const firstId = first.body.id as string;
    const single = await approve(firstId, finance1);
    expect(single.status).toBe(200);
    expect(single.body.status).toBe('APPROVED');
    expect(single.body.approvalCount).toBe(1);
    expect(single.body.requiresSecondApproval).toBe(false);

    const fileId = await makeFile(finance1.id);
    const transactionRef = `PO-TX-${randomUUID()}`;
    const paid = await markPaid(firstId, fileId, transactionRef);
    expect(paid.status).toBe(200);
    expect(paid.body.status).toBe('COMPLETED');

    const second = await createPayout(orderId, 1_000_000);
    const secondId = second.body.id as string;
    await approve(secondId, finance1);

    const duplicateImage = await markPaid(secondId, fileId, `PO-TX-${randomUUID()}`);
    expect(duplicateImage.status).toBe(409);
    expect(duplicateImage.body.code).toBe('DUPLICATE_PROOF_IMAGE');

    const otherFile = await makeFile(finance1.id);
    const duplicateRef = await markPaid(secondId, otherFile, transactionRef);
    expect(duplicateRef.status).toBe(409);
    expect(duplicateRef.body.code).toBe('DUPLICATE_TRANSACTION_REF');

    const third = await createPayout(orderId, 1_000_000);
    const thirdId = third.body.id as string;
    const rejected = await api()
      .post(`/api/v1/admin/payouts/${thirdId}/reject`)
      .set(auth(finance1))
      .send({ reason: 'Sai số tiền' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.status).toBe('REJECTED');

    const approveRejected = await approve(thirdId, finance1);
    expect(approveRejected.status).toBe(409);
    expect(approveRejected.body.code).toBe('INVALID_PAYOUT_STATE');

    // The refused duplicate attempts did not create a second transfer row.
    const stored = await prisma.payout.findUniqueOrThrow({ where: { id: secondId } });
    expect(stored.status).toBe('APPROVED');
    expect(stored.transactionRef).toBeNull();
  });

  it('auto-confirms a completed payout after the configured days', async () => {
    const orderId = await createOrder(10_000_000);
    const created = await createPayout(orderId, 2_000_000);
    const payoutId = created.body.id as string;
    await approve(payoutId, finance1);
    const fileId = await makeFile(finance1.id);
    const paid = await markPaid(payoutId, fileId, `PO-TX-${randomUUID()}`);
    expect(paid.status).toBe(200);

    // Fresh transfer: not eligible yet.
    expect((await payouts.autoConfirm()).confirmed).toBe(0);

    await prisma.payout.update({
      where: { id: payoutId },
      data: { paidAt: new Date(Date.now() - 10 * 86_400_000), confirmedAt: null },
    });

    const swept = await payouts.autoConfirm();
    expect(swept.confirmed).toBeGreaterThanOrEqual(1);
    const stored = await prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
    expect(stored.confirmedAt).toBeTruthy();
    expect(stored.confirmedById).toBe('SYSTEM');
  });
});
