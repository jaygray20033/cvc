import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../../app.module';
import { TokenService } from '../../auth/token.service';
import { PrismaService } from '../../prisma/prisma.service';
import { WalletService } from '../../wallet/wallet.service';
import { ConservationService } from './conservation.service';

// P4.25 integration — a deliberately corrupted wallet cache or ledger must
// raise the finance alert, block withdrawals, and clear again on a later OK
// run. RUN_DB_TESTS=1.
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

const EMAIL_PREFIX = 'p4v-test-';
const REF_PREFIX = 'P4V-';
const SOURCE = 'test:P4V';

let app: INestApplication;
let prisma: PrismaService;
let tokens: TokenService;
let walletService: WalletService;
let conservation: ConservationService;

interface TestUser {
  id: string;
  email: string;
  accessToken: string;
}

let buyer: TestUser;
let finance: TestUser;
let opsAdmin: TestUser;

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

  const users = await prisma.user.findMany({
    where: { email: { startsWith: EMAIL_PREFIX } },
    select: { id: true },
  });
  const userIds = users.map((row) => row.id);
  await prisma.moneyConservationRun.deleteMany({
    where: {
      OR: [{ source: { startsWith: SOURCE } }, { triggeredById: { in: userIds } }],
    },
  });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.ledgerAccount.deleteMany({
    where: { code: { in: userIds.map((id) => `CUS-${id}`) } },
  });
  await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

describeDb('Money conservation (P4.25)', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
    walletService = app.get(WalletService);
    conservation = app.get(ConservationService);
    await cleanup();

    buyer = await createUser(['buyer']);
    finance = await createUser(['admin', 'admin_finance']);
    opsAdmin = await createUser(['admin', 'admin_ops']);
  }, 90_000);

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.accessToken}` });
  const api = () => request(app.getHttpServer());

  async function creditWallet(amount: number): Promise<void> {
    await prisma.$transaction((tx) =>
      walletService.credit(tx, {
        userId: buyer.id,
        amount,
        createdById: finance.id,
        refType: 'test',
        refId: `${REF_PREFIX}${randomUUID()}`,
        note: 'P4V conservation',
      }),
    );
  }

  it('detects a wallet cache mismatch, alerts finance and blocks withdrawals', async () => {
    await creditWallet(50_000);

    const baseline = await conservation.run({ source: SOURCE });
    expect(baseline.status).toBe('OK');
    expect(baseline.ledger.balanced).toBe(true);
    expect(await conservation.isWithdrawalsBlocked()).toBe(false);

    // Simulate a cache bug: the ledger still says 50,000 but the wallet says 999.
    await prisma.wallet.update({
      where: { userId: buyer.id },
      data: { balance: new Prisma.Decimal('999.00') },
    });

    const broken = await conservation.run({ source: SOURCE });
    expect(broken.status).toBe('MISMATCH');
    expect(broken.wallets.mismatches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: buyer.id, reason: 'BALANCE_MISMATCH' }),
      ]),
    );
    expect(await conservation.isWithdrawalsBlocked()).toBe(true);

    const blocked = await conservation.assertWithdrawalsAllowed().catch((error: unknown) => error);
    expect(blocked).toMatchObject({
      response: { code: 'WITHDRAWALS_BLOCKED_CONSERVATION' },
    });

    // Finance admins get the mandatory alert; other admin groups do not.
    const alert = await prisma.notification.findFirst({
      where: { userId: finance.id, event: 'money.conservation_mismatch' },
    });
    expect(alert).not.toBeNull();
    expect(
      await prisma.notification.count({
        where: { userId: opsAdmin.id, event: 'money.conservation_mismatch' },
      }),
    ).toBe(0);

    // The post-transaction hook records a run without throwing.
    await conservation.runAfter(`${SOURCE}.after`);
    const hookRun = await prisma.moneyConservationRun.findFirst({
      where: { source: `${SOURCE}.after` },
      orderBy: { checkedAt: 'desc' },
    });
    expect(hookRun?.status).toBe('MISMATCH');

    // Reading the wallet reconciles the cache; the next check clears the lock.
    await walletService.getWallet(buyer.id);
    const fixed = await conservation.run({ source: SOURCE });
    expect(fixed.status).toBe('OK');
    expect(await conservation.isWithdrawalsBlocked()).toBe(false);
    await expect(conservation.assertWithdrawalsAllowed()).resolves.toBeUndefined();
  });

  it('detects a tampered ledger entry and clears after restore', async () => {
    const entry = await prisma.ledgerEntry.findFirstOrThrow({
      where: {
        side: 'DEBIT',
        transaction: { type: 'DEPOSIT', refId: { startsWith: REF_PREFIX } },
      },
      select: { id: true, amount: true },
    });

    await withUnlock((tx) =>
      tx.ledgerEntry.update({
        where: { id: entry.id },
        data: { amount: entry.amount.plus(1) },
      }),
    );

    const broken = await conservation.run({ source: SOURCE });
    expect(broken.ledger.balanced).toBe(false);
    expect(broken.status).toBe('MISMATCH');

    await withUnlock((tx) =>
      tx.ledgerEntry.update({
        where: { id: entry.id },
        data: { amount: entry.amount },
      }),
    );

    const restored = await conservation.run({ source: SOURCE });
    expect(restored.ledger.balanced).toBe(true);
    expect(restored.status).toBe('OK');
  });

  it('exposes the status/run API only to finance admins', async () => {
    const latest = await api().get('/api/v1/admin/ledger/conservation').set(auth(finance));
    expect(latest.status).toBe(200);
    expect(latest.body.withdrawalsBlocked).toBe(false);

    const run = await api()
      .post('/api/v1/admin/ledger/conservation/check')
      .set(auth(finance))
      .send({});
    expect(run.status).toBe(200);
    expect(run.body.status).toBe('OK');

    expect((await api().get('/api/v1/admin/ledger/conservation').set(auth(buyer))).status).toBe(
      403,
    );
    expect((await api().get('/api/v1/admin/ledger/conservation').set(auth(opsAdmin))).status).toBe(
      403,
    );
  });
});
