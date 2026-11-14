import { PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryModule, DiscoveryService } from '@nestjs/core';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../app.module';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';

// P2.7 DoD: the permissions matrix is enforced by a test that scans every
// route. A route passes only when it declares access rules: @Public() OR
// @Roles(...). Anything else means the route has no declared authorization
// and must fail the build (deny by default, see RolesGuard).
describe('route access declaration scan (P2.7 DoD)', () => {
  const undeclared: string[] = [];

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule, DiscoveryModule],
    }).compile();
    const discovery = module.get(DiscoveryService);

    for (const wrapper of discovery.getControllers()) {
      const prototype = Object.getPrototypeOf(wrapper.instance) as Record<string, unknown>;
      for (const key of Object.getOwnPropertyNames(prototype)) {
        if (key === 'constructor') continue;
        const handler = prototype[key] as object | undefined;
        // Only actual route handlers (skips helpers like AuthController.meta).
        if (!handler || Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
        const name = `${(wrapper.metatype as { name: string }).name}.${key}`;

        // Handler-level or class-level decorators both count.
        const isPublic =
          Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true ||
          Reflect.getMetadata(IS_PUBLIC_KEY, wrapper.metatype) === true;
        const hasRoles =
          Reflect.getMetadata(ROLES_KEY, handler) !== undefined ||
          Reflect.getMetadata(ROLES_KEY, wrapper.metatype) !== undefined;
        if (!isPublic && !hasRoles) undeclared.push(name);
      }
    }
    await module.close();
  });

  it('every route is @Public() or declares @Roles()', () => {
    expect(undeclared).toEqual([]);
  });
});
