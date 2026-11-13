import { SetMetadata } from '@nestjs/common';

// Marks a route as reachable without a JWT (health probes, auth endpoints).
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
