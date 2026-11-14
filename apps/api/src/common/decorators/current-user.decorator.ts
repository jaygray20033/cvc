import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// Payload of a verified access token (see TokenService.accessToken).
export interface AccessPayload {
  sub: string;
  email: string;
  sid: string;
  /** Role currently in use for this session (P2.9 role switching). */
  role: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessPayload => ctx.switchToHttp().getRequest().user,
);
