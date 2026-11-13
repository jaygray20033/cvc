import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

import type { AccessPayload } from '../decorators/current-user.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ErrorCode } from '../errors/error-codes';

declare module 'express' {
  interface Request {
    user?: AccessPayload;
  }
}

// Global guard: every route requires a Bearer access token unless @Public().
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization ?? '';
    const token = /^Bearer\s+(.+)$/i.exec(header)?.[1];
    if (!token) {
      throw new UnauthorizedException({
        code: ErrorCode.Unauthorized,
        message: 'Missing bearer token.',
      });
    }

    try {
      const payload = await this.jwt.verifyAsync<AccessPayload>(token, {
        secret: this.config.get<string>('jwt.accessSecret'),
      });
      if (!payload.sub || !payload.sid) throw new Error('Malformed token payload.');
      request.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException({
        code: ErrorCode.Unauthorized,
        message: 'Invalid or expired access token.',
      });
    }
  }
}
