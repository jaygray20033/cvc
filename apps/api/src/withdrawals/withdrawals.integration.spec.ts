import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../app.module';
import { TokenService } from '../auth/token.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';

// P4.26 integration — user withdrawals: KYC/bank gate, min + daily limits,
// hold on request, one/two-layer approval, reject/cancel release, manual
// mark-paid with proof and a single ledger post, and idempotent replays.
// RUN_DB_TESTS=1.
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

const EMAIL_PREFIX = 'p4w-test-';
const FILE_PREFIX = 'p4w/';
const BANK_PREFIX = 'p4w-';

let app: INestApplication;
let prisma: PrismaService;
let tokens: TokenService;
let wallet: WalletService;

interface TestUser {
  id: string;
  email: string;
  accessToken: string;
}

let user1: TestUser;
let user2: TestUser;
let noKyc: TestUser;
let kycNoBank: TestUser;
let finance1: TestUser;
let finance2: TestUser;
let opsAdmin: TestUser;
let user1BankId: string;
let user2BankId: string;

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

async function approveKyc(userId: string): Promise<void> {
  await prisma.kycSubmission.create({
    data: { userId, status: 'APPROVED', reviewedAt: new Date() },
  });
}

async function createBank(userId: string, last4: string): Promise<string> {
  const account = await prisma.bankAccount.create({
    data: {
      userId,
      bankName: 'Vietcombank',
      holderName: 'Người Dùng Thử',
      accountNoEnc: 'enc',
      accountNoLast4: last4,
      accountNoHash: `${BANK_PREFIX}${randomUUID()}`,
      isDefault: true,
    },
  });
  return account.id;
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
  const users = await prisma.user.findMany({
    where: { email: { startsWith: EMAIL_PREFIX } },
    select: { id: true },
  });
  const userIds = users.map((row) => row.id);
  const wallets = await prisma.wallet.findMany({
    where: { userId: { in: userIds } },
    select: { id: true },
  });
  const walletIds = wallets.map((row) => row.id);
  const withdrawals = await prisma.withdrawal.findMany({
    where: { walletId: { in: walletIds } },
    select: { id: true },
  });
  const withdrawalIds = withdrawals.map((row) => row.id);

  const transactions = await prisma.ledgerTransaction.findMany({
    where: {
      OR: [
        { refType: 'withdrawal', refId: { in: withdrawalIds } },
        { refType: 'test_deposit', refId: { startsWith: 'p4w-' } },
      ],
    },
    select: { id: true },
  });
  const transactionIds = transactions.map((row) => row.id);
  await withUnlock(async (tx) => {
    await tx.ledgerEntry.deleteMany({ where: { transactionId: { in: transactionIds } } });
    await tx.ledgerTransaction.deleteMany({ where: { id: { in: transactionIds } } });
  });

  await prisma.withdrawal.deleteMany({ where: { id: { in: withdrawalIds } } });
  await prisma.wallet.deleteMany({ where: { id: { in: walletIds } } });
  await prisma.fileObject.deleteMany({ where: { s3Key: { startsWith: FILE_PREFIX } } });
  await prisma.bankAccount.deleteMany({ where: { accountNoHash: { startsWith: BANK_PREFIX } } });
  await prisma.kycSubmission.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.moneyConservationRun.deleteMany({ where: { source: { startsWith: 'withdrawal' } } });
}

describeDb('User withdrawals (P4.26)', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
    wallet = app.get(WalletService);

    await cleanup();
    // A stale MISMATCH run from an earlier spec would block every request.
    await prisma.moneyConservationRun.deleteMany({});

    user1 = await createUser(['buyer']);
    user2 = await createUser(['buyer']);
    noKyc = await createUser(['buyer']);
    kycNoBank = await createUser(['buyer']);
    finance1 = await createUser(['admin', 'admin_finance']);
    finance2 = await createUser(['admin', 'admin_finance']);
    opsAdmin = await createUser(['admin', 'admin_ops']);

    await approveKyc(user1.id);
    await approveKyc(user2.id);
    await approveKyc(kycNoBank.id);
    user1BankId = await createBank(user1.id, '1111');
    user2BankId = await createBank(user2.id, '2222');

    await fund(user1.id, 100_000_000);
    await fund(user2.id, 70_000_000);
  }, 120_000);

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.accessToken}` });
  const api = () => request(app.getHttpServer());

  async function fund(userId: string, amount: number): Promise<void> {
    await prisma.$transaction((tx) =>
      wallet.credit(tx, {
        userId,
        amount,
        createdById: userId,
        refType: 'test_deposit',
        refId: `p4w-${randomUUID()}`,
        note: 'P4.26 test funding',
      }),
    );
  }

  async function walletState(userId: string) {
    const row = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    return {
      balance: Number(row.balance),
      held: Number(row.heldBalance),
      available: Number(row.balance) - Number(row.heldBalance),
    };
  }

  function createWithdrawal(user: TestUser, amount: number, bankAccountId: string = user1BankId) {
    return api()
      .post('/api/v1/me/withdrawals')
      .set(auth(user))
      .send({ amount, bankAccountId, note: 'Rút tiền thử' });
  }

  function approve(withdrawalId: string, user: TestUser) {
    return api()
      .post(`/api/v1/admin/withdrawals/${withdrawalId}/approve`)
      .set(auth(user))
      .send({ note: 'Duyệt rút' });
  }

  function reject(withdrawalId: string, user: TestUser, reason: string) {
    return api()
      .post(`/api/v1/admin/withdrawals/${withdrawalId}/reject`)
      .set(auth(user))
      .send({ reason });
  }

  async function makeFile(ownerId: string): Promise<string> {
    const file = await prisma.fileObject.create({
      data: {
        ownerType: 'user',
        ownerId,
        bucket: 'p4w',
        s3Key: `${FILE_PREFIX}${randomUUID()}`,
        purpose: 'withdrawal_proof',
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

  function markPaid(
    withdrawalId: string,
    user: TestUser,
    fileObjectId: string,
    transactionRef: string,
  ) {
    return api()
      .post(`/api/v1/admin/withdrawals/${withdrawalId}/mark-paid`)
      .set(auth(user))
      .send({ fileObjectId, transactionRef });
  }

  it('requires KYC FULL, an owned bank account, and enforces the minimum', async () => {
    const blockedKyc = await createWithdrawal(noKyc, 1_000_000);
    expect(blockedKyc.status).toBe(403);
    expect(blockedKyc.body.code).toBe('KYC_REQUIRED');

    const blockedBank = await createWithdrawal(kycNoBank, 1_000_000);
    expect(blockedBank.status).toBe(403);
    expect(blockedBank.body.code).toBe('KYC_REQUIRED');

    const belowMin = await createWithdrawal(user1, 10_000);
    expect(belowMin.status).toBe(409);
    expect(belowMin.body.code).toBe('WITHDRAWAL_BELOW_MINIMUM');

    const foreignBank = await createWithdrawal(user1, 1_000_000, user2BankId);
    expect(foreignBank.status).toBe(403);
    expect(foreignBank.body.code).toBe('WITHDRAWAL_BANK_ACCOUNT_NOT_OWNED');

    const missingBank = await createWithdrawal(user1, 1_000_000, 'ck00000000000000000000000');
    expect(missingBank.status).toBe(409);
    expect(missingBank.body.code).toBe('WITHDRAWAL_BANK_ACCOUNT_REQUIRED');

    const before = await walletState(user1.id);
    const created = await createWithdrawal(user1, 1_000_000);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      status: 'PENDING',
      userId: user1.id,
      approvalCount: 0,
      requiresSecondApproval: false,
      bankAccount: { accountNoMasked: '****1111' },
    });
    expect(String(created.body.amount)).toBe('1000000');
    expect(created.body.withdrawalNo).toMatch(/^CVC-WD-[0-9A-F]{12}$/);
    expect(created.body.referenceCode).toMatch(/^WD[0-9A-F]{12}$/);

    const after = await walletState(user1.id);
    expect(after.balance).toBe(before.balance);
    expect(after.held).toBe(before.held + 1_000_000);
    expect(after.available).toBe(before.available - 1_000_000);

    const mine = await api().get('/api/v1/me/withdrawals').set(auth(user1));
    expect(mine.status).toBe(200);
    expect(mine.body.items.some((item: { id: string }) => item.id === created.body.id)).toBe(true);

    // Ownership: another user cannot read or cancel it.
    expect(
      (await api().get(`/api/v1/me/withdrawals/${created.body.id}`).set(auth(user2))).status,
    ).toBe(404);
    expect(
      (
        await api()
          .post(`/api/v1/me/withdrawals/${created.body.id}/cancel`)
          .set(auth(user2))
          .send({})
      ).status,
    ).toBe(404);

    // Only finance admins reach the admin queue.
    expect((await api().get('/api/v1/admin/withdrawals').set(auth(finance1))).status).toBe(200);
    expect((await api().get('/api/v1/admin/withdrawals').set(auth(opsAdmin))).status).toBe(403);

    // The user can cancel a pending request; the hold is released.
    const cancelled = await api()
      .post(`/api/v1/me/withdrawals/${created.body.id}/cancel`)
      .set(auth(user1))
      .send({ reason: 'Đổi ý' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect(cancelled.body.cancelReason).toBe('Đổi ý');
    const released = await walletState(user1.id);
    expect(released.balance).toBe(before.balance);
    expect(released.held).toBe(before.held);
  });

  it('rejects a request and releases the hold without a ledger entry', async () => {
    const before = await walletState(user1.id);
    const created = await createWithdrawal(user1, 1_000_000);
    expect(created.status).toBe(201);
    expect((await walletState(user1.id)).held).toBe(before.held + 1_000_000);

    const rejected = await reject(created.body.id, finance1, 'Thông tin ngân hàng chưa khớp');
    expect(rejected.status).toBe(200);
    expect(rejected.body.status).toBe('REJECTED');
    expect(rejected.body.rejectionReason).toBe('Thông tin ngân hàng chưa khớp');

    const after = await walletState(user1.id);
    expect(after.balance).toBe(before.balance);
    expect(after.held).toBe(before.held);
    expect(
      await prisma.ledgerTransaction.count({
        where: { refType: 'withdrawal', refId: created.body.id },
      }),
    ).toBe(0);

    // A rejected request cannot be cancelled or approved again.
    const cancel = await api()
      .post(`/api/v1/me/withdrawals/${created.body.id}/cancel`)
      .set(auth(user1))
      .send({});
    expect(cancel.status).toBe(409);
    expect(cancel.body.code).toBe('WITHDRAWAL_INVALID_STATE');
    const approveAgain = await approve(created.body.id, finance1);
    expect(approveAgain.status).toBe(409);
    expect(approveAgain.body.code).toBe('WITHDRAWAL_INVALID_STATE');
  });

  it('pays once with proof, exposes it to the owner, and is idempotent', async () => {
    const created = await createWithdrawal(user1, 1_000_000);
    expect(created.status).toBe(201);
    const withdrawalId = created.body.id as string;
    const before = await walletState(user1.id);

    const approved = await approve(withdrawalId, finance1);
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('APPROVED');
    expect(approved.body.approvalCount).toBe(1);
    expect(approved.body.requiresSecondApproval).toBe(false);

    const fileId = await makeFile(finance1.id);
    const transactionRef = `WD-TX-${randomUUID()}`;
    const paid = await markPaid(withdrawalId, finance1, fileId, transactionRef);
    expect(paid.status).toBe(200);
    expect(paid.body.status).toBe('COMPLETED');
    expect(paid.body.transactionRef).toBe(transactionRef);
    expect(paid.body.alreadyPaid).toBe(false);
    expect(paid.body.ledgerTransactionId).toBeTruthy();
    expect(paid.body.proof).toMatchObject({ fileObjectId: fileId, available: true });

    const after = await walletState(user1.id);
    expect(after.balance).toBe(before.balance - 1_000_000);
    expect(after.held).toBe(before.held - 1_000_000);

    const transactionId = paid.body.ledgerTransactionId as string;
    const entries = await prisma.ledgerEntry.findMany({
      where: { transactionId },
      include: { account: { select: { code: true } } },
    });
    expect(entries).toHaveLength(2);
    expect(entries.find((entry) => entry.side === 'DEBIT')?.account.code).toBe(`CUS-${user1.id}`);
    expect(entries.find((entry) => entry.side === 'CREDIT')?.account.code).toBe('CVC-BANK');
    expect(Number(entries.find((entry) => entry.side === 'DEBIT')?.amount)).toBe(1_000_000);
    expect(
      await prisma.ledgerTransaction.count({
        where: { refType: 'withdrawal', refId: withdrawalId },
      }),
    ).toBe(1);

    // The user can view the proof, but only for their own withdrawal.
    const proof = await api().get(`/api/v1/me/withdrawals/${withdrawalId}/proof`).set(auth(user1));
    expect(proof.status).toBe(200);
    expect(proof.body.url).toMatch(/^https?:\/\//);
    expect(proof.body.expiresIn).toBe(300);
    expect(
      (await api().get(`/api/v1/me/withdrawals/${withdrawalId}/proof`).set(auth(user2))).status,
    ).toBe(404);

    // Same reference replays the stored result; a different one is refused.
    const replay = await markPaid(withdrawalId, finance1, fileId, transactionRef);
    expect(replay.status).toBe(200);
    expect(replay.body.alreadyPaid).toBe(true);
    expect(replay.body.status).toBe('COMPLETED');
    expect(replay.body.ledgerTransactionId).toBe(transactionId);
    const different = await markPaid(withdrawalId, finance1, fileId, `WD-TX-${randomUUID()}`);
    expect(different.status).toBe(409);
    expect(different.body.code).toBe('WITHDRAWAL_ALREADY_PAID');
    expect(
      await prisma.ledgerTransaction.count({
        where: { refType: 'withdrawal', refId: withdrawalId },
      }),
    ).toBe(1);

    // Duplicate proof image and duplicate transfer reference are rejected.
    const second = await createWithdrawal(user1, 1_000_000);
    await approve(second.body.id, finance1);
    const duplicateImage = await markPaid(
      second.body.id,
      finance1,
      fileId,
      `WD-TX-${randomUUID()}`,
    );
    expect(duplicateImage.status).toBe(409);
    expect(duplicateImage.body.code).toBe('DUPLICATE_PROOF_IMAGE');

    const third = await createWithdrawal(user1, 1_000_000);
    await approve(third.body.id, finance1);
    const otherFile = await makeFile(finance1.id);
    const duplicateRef = await markPaid(third.body.id, finance1, otherFile, transactionRef);
    expect(duplicateRef.status).toBe(409);
    expect(duplicateRef.body.code).toBe('DUPLICATE_TRANSACTION_REF');

    // DB trigger: a paid withdrawal cannot lose its proof.
    await expect(
      prisma.withdrawal.update({ where: { id: withdrawalId }, data: { proofFileObjectId: null } }),
    ).rejects.toThrow();
  });

  it('requires two different approvers above the threshold and enforces the daily limit', async () => {
    const before = await walletState(user2.id);
    const created = await createWithdrawal(user2, 30_000_000, user2BankId);
    expect(created.status).toBe(201);
    const withdrawalId = created.body.id as string;

    // A second request on the same day exceeds the 50M daily limit.
    const overLimit = await createWithdrawal(user2, 30_000_000, user2BankId);
    expect(overLimit.status).toBe(409);
    expect(overLimit.body.code).toBe('WITHDRAWAL_DAILY_LIMIT');

    const first = await approve(withdrawalId, finance1);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('PENDING');
    expect(first.body.approvalCount).toBe(1);
    expect(first.body.requiresSecondApproval).toBe(true);

    const samePerson = await approve(withdrawalId, finance1);
    expect(samePerson.status).toBe(409);
    expect(samePerson.body.code).toBe('WITHDRAWAL_SECOND_APPROVER_REQUIRED');

    const second = await approve(withdrawalId, finance2);
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('APPROVED');
    expect(second.body.approvalCount).toBe(2);
    expect(second.body.approvedById).toBe(finance2.id);

    const fileId = await makeFile(finance1.id);
    const paid = await markPaid(withdrawalId, finance1, fileId, `WD-TX-${randomUUID()}`);
    expect(paid.status).toBe(200);
    expect(paid.body.status).toBe('COMPLETED');

    const after = await walletState(user2.id);
    expect(after.balance).toBe(before.balance - 30_000_000);
    expect(after.held).toBe(before.held);

    // The paid amount still counts against today's limit.
    const overLimitAfterPay = await createWithdrawal(user2, 30_000_000, user2BankId);
    expect(overLimitAfterPay.status).toBe(409);
    expect(overLimitAfterPay.body.code).toBe('WITHDRAWAL_DAILY_LIMIT');
  });
});
