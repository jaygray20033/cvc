import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import { ADMIN_GROUPS_KEY } from '../decorators/admin-groups.decorator';
import type { AccessPayload } from '../decorators/current-user.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { RolesGuard } from './roles.guard';

// Unit tests for the RBAC guard (P2.7) and the admin permission groups
// (P2.10). The route-scan test guarantees metadata is declared everywhere;
// here we check the guard's decisions against that metadata.

type Metadata = Record<string, unknown>;

function makeContext(handlerMeta: Metadata, user?: AccessPayload): ExecutionContext {
  return {
    getHandler: () => Symbol('handler'),
    getClass: () => class RouteClass {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function makeReflector(handlerMeta: Metadata): Reflector {
  return { getAllAndOverride: (key: string) => handlerMeta[key] } as unknown as Reflector;
}

// Mocks prisma.userRole.count: returns how many of the required groups the
// user actually holds (intersection), like the real DB query.
function makePrisma(groupsForUser: string[]) {
  return {
    userRole: {
      count: jest.fn(
        async (args: { where: { role: { in: string[] } } }) =>
          args.where.role.in.filter((group) => groupsForUser.includes(group)).length,
      ),
    },
  };
}

const buyer: AccessPayload = { sub: 'u1', email: 'a@b.c', sid: 's1', role: 'buyer' };
const admin: AccessPayload = { sub: 'u2', email: 'admin@b.c', sid: 's2', role: 'admin' };

describe('RolesGuard', () => {
  it('fails closed when a route declares no roles and is not public', async () => {
    const guard = new RolesGuard(makeReflector({}), makePrisma([]) as never);
    await expect(guard.canActivate(makeContext({}, buyer))).rejects.toMatchObject({
      status: 403,
    });
  });

  it('allows @Public() routes without a user', async () => {
    const guard = new RolesGuard(makeReflector({ [IS_PUBLIC_KEY]: true }), makePrisma([]) as never);
    await expect(guard.canActivate(makeContext({ [IS_PUBLIC_KEY]: true }))).resolves.toBe(true);
  });

  it('@Roles() with no args allows any authenticated user', async () => {
    const guard = new RolesGuard(makeReflector({ [ROLES_KEY]: [] }), makePrisma([]) as never);
    for (const user of [buyer, admin]) {
      await expect(guard.canActivate(makeContext({ [ROLES_KEY]: [] }, user))).resolves.toBe(true);
    }
  });

  it('denies when the active role is not in the declared list', async () => {
    const meta = { [ROLES_KEY]: ['admin'] };
    const guard = new RolesGuard(makeReflector(meta), makePrisma([]) as never);
    await expect(guard.canActivate(makeContext(meta, buyer))).rejects.toMatchObject({
      status: 403,
    });
    await expect(guard.canActivate(makeContext(meta, undefined))).rejects.toMatchObject({
      status: 403,
    });
    await expect(guard.canActivate(makeContext(meta, admin))).resolves.toBe(true);
  });

  // ----- P2.10: admin permission groups (read fresh from user_roles) -----

  const moneyRoute = {
    [ROLES_KEY]: ['admin'],
    [ADMIN_GROUPS_KEY]: ['admin_finance', 'admin_super'],
  };

  it('admin_finance group passes a money route, admin_ops does not', async () => {
    const withFinance = new RolesGuard(
      makeReflector(moneyRoute),
      makePrisma(['admin_finance']) as never,
    );
    const withOps = new RolesGuard(makeReflector(moneyRoute), makePrisma(['admin_ops']) as never);
    const ctx = makeContext(moneyRoute, admin);
    await expect(withFinance.canActivate(ctx)).resolves.toBe(true);
    await expect(withOps.canActivate(ctx)).rejects.toMatchObject({ status: 403 });
  });

  it('admin_super passes every group-restricted route', async () => {
    const configRoute = { [ROLES_KEY]: ['admin'], [ADMIN_GROUPS_KEY]: ['admin_super'] };
    const withSuper = new RolesGuard(
      makeReflector(configRoute),
      makePrisma(['admin_super']) as never,
    );
    await expect(withSuper.canActivate(makeContext(configRoute, admin))).resolves.toBe(true);
  });

  it('admin with no admin_* rows is denied on group-restricted routes', async () => {
    const noGroups = new RolesGuard(makeReflector(moneyRoute), makePrisma([]) as never);
    const ctx = makeContext(moneyRoute, admin);
    await expect(noGroups.canActivate(ctx)).rejects.toMatchObject({ status: 403 });
  });

  it('does not query the DB on routes without @AdminGroups()', async () => {
    const prisma = makePrisma([]);
    const plain = new RolesGuard(makeReflector({ [ROLES_KEY]: [] }), prisma as never);
    await plain.canActivate(makeContext({ [ROLES_KEY]: [] }, buyer));
    expect(prisma.userRole.count).not.toHaveBeenCalled();
  });
});
