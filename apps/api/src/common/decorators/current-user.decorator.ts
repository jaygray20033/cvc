import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// Payload of a verified access token (see TokenService.accessPayload).
export interface AccessPayload {
  sub: string;
  email: string;
  sid: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessPayload => ctx.switchToHttp().getRequest().user,
);
