import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import { PrismaService } from '../../prisma/prisma.service';
import type { AccessPayload } from '../decorators/current-user.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { REQUIRE_KYC_KEY } from '../decorators/require-kyc.decorator';
import { KycGuard } from './kyc.guard';

// Unit tests for the KYC gate (P2.15). BASIC needs an APPROVED submission,
// FULL additionally needs a bank account; routes that never declare
// @RequireKyc are untouched.

const user: AccessPayload = { sub: 'u1', email: 'a@b.c', sid: 's1', role: 'buyer' };

function makeContext(_handlerMeta: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => Symbol('h'),
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function makeReflector(meta: Record<string, unknown>): Reflector {
  return { getAllAndOverride: (key: string) => meta[key] } as unknown as Reflector;
}

// approved/banks drive the two DB counts the guard reads.
function makePrisma(approved: number, banks: number): PrismaService {
  return {
    kycSubmission: { count: async () => approved },
    bankAccount: { count: async () => banks },
  } as unknown as PrismaService;
}

const config = { get: (_k: string, d: number) => d } as never;

describe('KycGuard', () => {
  it('passes routes that do not declare @RequireKyc', async () => {
    const guard = new KycGuard(makeReflector({}), makePrisma(0, 0), config);
    await expect(guard.canActivate(makeContext({}))).resolves.toBe(true);
  });

  it('skips @Public() routes', async () => {
    const meta = { [IS_PUBLIC_KEY]: true, [REQUIRE_KYC_KEY]: 'BASIC' };
    const guard = new KycGuard(makeReflector(meta), makePrisma(0, 0), config);
    await expect(guard.canActivate(makeContext(meta))).resolves.toBe(true);
  });

  it('BASIC: blocks with 403 when no approved submission, allows after one', async () => {
    const meta = { [REQUIRE_KYC_KEY]: 'BASIC' };
    const blocked = new KycGuard(makeReflector(meta), makePrisma(0, 0), config);
    await expect(blocked.canActivate(makeContext(meta))).rejects.toMatchObject({
      status: 403,
      response: { code: 'KYC_REQUIRED' },
    });

    const ok = new KycGuard(makeReflector(meta), makePrisma(1, 0), config);
    await expect(ok.canActivate(makeContext(meta))).resolves.toBe(true);
  });

  it('FULL: approved alone is not enough, also requires a bank account', async () => {
    const meta = { [REQUIRE_KYC_KEY]: 'FULL' };
    const noBank = new KycGuard(makeReflector(meta), makePrisma(1, 0), config);
    await expect(noBank.canActivate(makeContext(meta))).rejects.toMatchObject({ status: 403 });

    const withBank = new KycGuard(makeReflector(meta), makePrisma(1, 1), config);
    await expect(withBank.canActivate(makeContext(meta))).resolves.toBe(true);
  });

  it('blocks when the caller has no authenticated user', async () => {
    const meta = { [REQUIRE_KYC_KEY]: 'BASIC' };
    const guard = new KycGuard(makeReflector(meta), makePrisma(1, 1), config);
    const anonymous = {
      getHandler: () => Symbol('h'),
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({}) }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(anonymous)).rejects.toMatchObject({ status: 403 });
  });
});
