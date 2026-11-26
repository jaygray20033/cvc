import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../../app.module';
import { TokenService } from '../../auth/token.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from './ledger.service';

// P4.23 integration — balanced posts, validation, immutable entries,
// concurrent idempotency and the finance read API. RUN_DB_TESTS=1.
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

const EMAIL_PREFIX = 'p4l-test-';
const REF_PREFIX = 'P4L-';
const ACCOUNT_PREFIX = 'P4L-';

let app: INestApplication;
let prisma: PrismaService;
let tokens: TokenService;
let ledger: LedgerService;

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
  const transactions = await prisma.ledgerTransaction.findMany({
    where: { refId: { startsWith: REF_PREFIX } },
    select: { id: true },
  });
  const transactionIds = transactions.map((row) => row.id);
  await withUnlock(async (tx) => {
    await tx.ledgerEntry.deleteMany({ where: { transactionId: { in: transactionIds } } });
    await tx.ledgerTransaction.deleteMany({ where: { id: { in: transactionIds } } });
  });
  await prisma.ledgerAccount.deleteMany({
    where: { code: { startsWith: ACCOUNT_PREFIX } },
  });
  await prisma.wallet.deleteMany({ where: { user: { email: { startsWith: EMAIL_PREFIX } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
}

describeDb('Ledger (P4.23)', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
    ledger = app.get(LedgerService);
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

  function lines(amount: number, debitSuffix = 'BANK', creditSuffix = 'USER') {
    return [
      {
        accountCode: `${ACCOUNT_PREFIX}${debitSuffix}`,
        accountName: `P4L asset ${debitSuffix}`,
        accountType: 'ASSET' as const,
        side: 'DEBIT' as const,
        amount,
      },
      {
        accountCode: `${ACCOUNT_PREFIX}${creditSuffix}`,
        accountName: `P4L liability ${creditSuffix}`,
        accountType: 'LIABILITY' as const,
        side: 'CREDIT' as const,
        amount,
      },
    ];
  }

  async function post(amount: number, idempotencyKey?: string) {
    return prisma.$transaction((tx) =>
      ledger.post(tx, {
        type: 'ADJUSTMENT',
        refType: 'test',
        refId: `${REF_PREFIX}${randomUUID().slice(0, 8)}`,
        currency: 'VND',
        createdById: finance.id,
        note: 'P4.23 test',
        idempotencyKey,
        lines: lines(amount),
      }),
    );
  }

  it('posts a balanced transaction and serves the finance read API', async () => {
    const posted = await post(25_000);
    expect(posted.alreadyPosted).toBe(false);

    const detail = await prisma.ledgerTransaction.findUniqueOrThrow({
      where: { id: posted.transactionId },
      include: { entries: true },
    });
    expect(detail.entries).toHaveLength(2);
    expect(detail.entries.reduce((sum, row) => sum + Number(row.amount), 0)).toBe(50_000);

    const trial = await api().get('/api/v1/admin/ledger/trial-balance').set(auth(finance));
    expect(trial.status).toBe(200);
    expect(trial.body.balanced).toBe(true);
    expect(Number(trial.body.debitTotal)).toBe(Number(trial.body.creditTotal));

    const accounts = await api().get('/api/v1/admin/ledger/accounts').set(auth(finance));
    expect(accounts.status).toBe(200);
    const accountCodes = (accounts.body as Array<{ code: string }>).map((row) => row.code);
    expect(accountCodes).toEqual(
      expect.arrayContaining([`${ACCOUNT_PREFIX}BANK`, `${ACCOUNT_PREFIX}USER`]),
    );

    const list = await api()
      .get(`/api/v1/admin/ledger/transactions?refId=${detail.refId}`)
      .set(auth(finance));
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].entries).toHaveLength(2);

    const one = await api()
      .get(`/api/v1/admin/ledger/transactions/${posted.transactionId}`)
      .set(auth(finance));
    expect(one.status).toBe(200);
    expect(one.body.idempotencyKey).toBeNull();

    // Buyer cannot read the ledger; other admin groups cannot either.
    expect((await api().get('/api/v1/admin/ledger/accounts').set(auth(buyer))).status).toBe(403);
    expect((await api().get('/api/v1/admin/ledger/accounts').set(auth(opsAdmin))).status).toBe(403);
  });

  it('rejects unbalanced, non-positive and mismatched accounts', async () => {
    const unbalanced = await prisma
      .$transaction((tx) =>
        ledger.post(tx, {
          type: 'ADJUSTMENT',
          refType: 'test',
          refId: `${REF_PREFIX}unbalanced`,
          currency: 'VND',
          createdById: finance.id,
          lines: [
            {
              accountCode: `${ACCOUNT_PREFIX}BANK`,
              accountName: 'P4L asset',
              accountType: 'ASSET',
              side: 'DEBIT',
              amount: 10,
            },
            {
              accountCode: `${ACCOUNT_PREFIX}USER`,
              accountName: 'P4L liability',
              accountType: 'LIABILITY',
              side: 'CREDIT',
              amount: 9,
            },
          ],
        }),
      )
      .catch((error: unknown) => error);
    expect(unbalanced).toMatchObject({
      response: { code: 'LEDGER_UNBALANCED' },
    });

    const zero = await prisma
      .$transaction((tx) =>
        ledger.post(tx, {
          type: 'ADJUSTMENT',
          refType: 'test',
          refId: `${REF_PREFIX}zero`,
          currency: 'VND',
          createdById: finance.id,
          lines: lines(0),
        }),
      )
      .catch((error: unknown) => error);
    expect(zero).toMatchObject({ response: { code: 'LEDGER_INVALID_LINES' } });

    // Create an EUR account, then try to post VND against it.
    await prisma.ledgerAccount.create({
      data: {
        code: `${ACCOUNT_PREFIX}EUR`,
        name: 'P4L EUR',
        type: 'ASSET',
        currency: 'EUR',
      },
    });
    const currencyMismatch = await prisma
      .$transaction((tx) =>
        ledger.post(tx, {
          type: 'ADJUSTMENT',
          refType: 'test',
          refId: `${REF_PREFIX}currency`,
          currency: 'VND',
          createdById: finance.id,
          lines: [
            {
              accountCode: `${ACCOUNT_PREFIX}EUR`,
              accountName: 'P4L EUR',
              accountType: 'ASSET',
              side: 'DEBIT',
              amount: 10,
            },
            {
              accountCode: `${ACCOUNT_PREFIX}USER`,
              accountName: 'P4L liability',
              accountType: 'LIABILITY',
              side: 'CREDIT',
              amount: 10,
            },
          ],
        }),
      )
      .catch((error: unknown) => error);
    expect(currencyMismatch).toMatchObject({
      response: { code: 'LEDGER_ACCOUNT_CURRENCY_MISMATCH' },
    });
  });

  it('blocks direct UPDATE/DELETE on ledger entries', async () => {
    const posted = await post(12_000);
    const entry = await prisma.ledgerEntry.findFirstOrThrow({
      where: { transactionId: posted.transactionId },
    });

    const updateError =
      await prisma.$executeRaw`UPDATE ledger_entries SET amount = 1 WHERE id = ${entry.id}`.catch(
        (error: unknown) => error,
      );
    expect(String(updateError)).toContain('LEDGER_ENTRY_IMMUTABLE');

    const deleteError =
      await prisma.$executeRaw`DELETE FROM ledger_entries WHERE id = ${entry.id}`.catch(
        (error: unknown) => error,
      );
    expect(String(deleteError)).toContain('LEDGER_ENTRY_IMMUTABLE');
  });

  it('posts once under concurrent retries with the same idempotency key', async () => {
    const key = `${REF_PREFIX}key-${randomUUID()}`;
    const ref = `${REF_PREFIX}conc-${randomUUID().slice(0, 8)}`;
    const attempt = () =>
      prisma.$transaction((tx) =>
        ledger.post(tx, {
          type: 'ADJUSTMENT',
          refType: 'test',
          refId: ref,
          currency: 'VND',
          createdById: finance.id,
          idempotencyKey: key,
          lines: lines(30_000),
        }),
      );

    const results = await Promise.allSettled([attempt(), attempt()]);
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    const ids = results.map((result) =>
      result.status === 'fulfilled' ? result.value.transactionId : 'rejected',
    );
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).not.toBe('rejected');

    const transactions = await prisma.ledgerTransaction.findMany({
      where: { idempotencyKey: key },
      include: { entries: true },
    });
    expect(transactions).toHaveLength(1);
    expect(transactions[0].entries).toHaveLength(2);

    // A sequential retry resolves to the same transaction.
    const retry = await attempt();
    expect(retry.alreadyPosted).toBe(true);
    expect(retry.transactionId).toBe(transactions[0].id);
  });
});
