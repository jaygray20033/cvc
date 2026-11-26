import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../app.module';
import { TokenService } from '../auth/token.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from './wallet.service';

// P4.24 integration — the wallet reconciles from the ledger, statements export
// to CSV/PDF, holds reserve funds and two concurrent debits cannot overdraw.
// RUN_DB_TESTS=1.
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

const EMAIL_PREFIX = 'p4w-test-';
const REF_PREFIX = 'P4W-';

let app: INestApplication;
let prisma: PrismaService;
let tokens: TokenService;
let walletService: WalletService;

interface TestUser {
  id: string;
  email: string;
  accessToken: string;
}

let user: TestUser;

function makeEmail(): string {
  return `${EMAIL_PREFIX}${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`;
}

async function createUser(roles: string[]): Promise<TestUser> {
  const email = makeEmail();
  const created = await prisma.user.create({
    data: { email, passwordHash: 'x', emailVerifiedAt: new Date(), status: 'ACTIVE' },
  });
  await prisma.userRole.createMany({ data: roles.map((role) => ({ userId: created.id, role })) });
  const sessionId = randomUUID();
  await prisma.session.create({
    data: {
      id: sessionId,
      userId: created.id,
      familyId: randomUUID(),
      refreshHash: tokens.hashToken(randomUUID()),
      activeRole: roles[0],
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  return {
    id: created.id,
    email,
    accessToken: tokens.accessToken({ sub: created.id, email, sid: sessionId, role: roles[0] }),
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
  const transactions = await prisma.ledgerTransaction.findMany({
    where: { refId: { startsWith: REF_PREFIX } },
    select: { id: true },
  });
  const transactionIds = transactions.map((row) => row.id);
  await withUnlock(async (tx) => {
    await tx.ledgerEntry.deleteMany({ where: { transactionId: { in: transactionIds } } });
    await tx.ledgerTransaction.deleteMany({ where: { id: { in: transactionIds } } });
  });

  const wallets = await prisma.wallet.findMany({
    where: { user: { email: { startsWith: EMAIL_PREFIX } } },
    select: { id: true, userId: true },
  });
  await prisma.ledgerAccount.deleteMany({
    where: { code: { in: wallets.map((row) => `CUS-${row.userId}`) } },
  });
  await prisma.wallet.deleteMany({ where: { id: { in: wallets.map((row) => row.id) } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
}

function mutation(overrides: Partial<{ refId: string; refType: string; note: string }> = {}) {
  return {
    userId: user.id,
    createdById: user.id,
    refType: overrides.refType ?? 'wallet_test',
    refId: overrides.refId ?? `${REF_PREFIX}${randomUUID()}`,
    note: overrides.note,
  };
}

describeDb('Wallet (P4.24)', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
    walletService = app.get(WalletService);
    await cleanup();
  }, 90_000);

  beforeEach(async () => {
    // Fresh wallet per test so assertions do not depend on earlier cases.
    user = await createUser(['buyer']);
  }, 30_000);

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  async function credit(amount: number, refId?: string) {
    return prisma.$transaction((tx) =>
      walletService.credit(tx, { ...mutation({ refId }), amount }),
    );
  }

  async function debit(amount: number, refId?: string) {
    return prisma.$transaction((tx) => walletService.debit(tx, { ...mutation({ refId }), amount }));
  }

  it('reconciles the cached balance from the ledger and lists transactions', async () => {
    await credit(50_000);

    const summary = await walletService.getWallet(user.id);
    expect(summary.balance).toBe('50000.00');
    expect(summary.held).toBe('0.00');
    expect(summary.available).toBe('50000.00');
    expect(summary.ledgerBalance).toBe('50000.00');
    expect(summary.reconciled).toBe(true);

    const list = await walletService.listTransactions(user.id, { page: 1, limit: 20 });
    expect(list.total).toBe(1);
    expect(list.items[0].direction).toBe('IN');
    expect(list.items[0].amount).toBe('50000.00');

    const http = await request(app.getHttpServer())
      .get('/api/v1/me/wallet')
      .set({ Authorization: `Bearer ${user.accessToken}` });
    expect(http.status).toBe(200);
    expect(http.body.balance).toBe('50000.00');
  });

  it('exports CSV and PDF statements', async () => {
    await credit(50_000);

    const csv = await walletService.getStatement(user.id, { format: 'csv' });
    expect(csv.contentType).toContain('text/csv');
    expect(csv.filename.endsWith('.csv')).toBe(true);
    const csvBody = csv.body as string;
    expect(csvBody).toContain('50000.00');
    expect(csvBody.startsWith('\uFEFF')).toBe(true);

    const pdf = await walletService.getStatement(user.id, { format: 'pdf' });
    expect(pdf.contentType).toBe('application/pdf');
    expect(pdf.filename.endsWith('.pdf')).toBe(true);
    const pdfBody = pdf.body as Buffer;
    expect(pdfBody.subarray(0, 8).toString('ascii')).toBe('%PDF-1.4');
    expect(pdfBody.toString('ascii')).toContain('CVC WALLET STATEMENT');
  });

  it('blocks two concurrent debits from overdrawing the wallet', async () => {
    await credit(100_000);

    const results = await Promise.allSettled([debit(80_000), debit(80_000)]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason as {
      response?: { code?: string };
    };
    expect(reason.response?.code).toBe('INSUFFICIENT_FUNDS');

    // Ledger and cache both stay at 20,000 and never go negative.
    const summary = await walletService.getWallet(user.id);
    expect(summary.balance).toBe('20000.00');
    expect(summary.ledgerBalance).toBe('20000.00');
    expect(summary.reconciled).toBe(true);
    expect(Number(summary.available)).toBeGreaterThanOrEqual(0);
  });

  it('holds, releases and captures funds without double counting', async () => {
    await credit(60_000);

    await prisma.$transaction((tx) => walletService.hold(tx, { ...mutation(), amount: 40_000 }));
    let summary = await walletService.getWallet(user.id);
    expect(summary.balance).toBe('60000.00');
    expect(summary.held).toBe('40000.00');
    expect(summary.available).toBe('20000.00');

    await prisma.$transaction((tx) => walletService.release(tx, { ...mutation(), amount: 15_000 }));
    summary = await walletService.getWallet(user.id);
    expect(summary.held).toBe('25000.00');
    expect(summary.available).toBe('35000.00');

    await prisma.$transaction((tx) =>
      walletService.captureHeld(tx, { ...mutation(), amount: 25_000 }),
    );
    summary = await walletService.getWallet(user.id);
    expect(summary.balance).toBe('35000.00');
    expect(summary.held).toBe('0.00');
    expect(summary.available).toBe('35000.00');
    expect(summary.reconciled).toBe(true);
  });
});
