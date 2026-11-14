import { NotFoundException } from '@nestjs/common';

import { ErrorCode } from '../errors/error-codes';

// Record-level ownership check (P2.8, anti-IDOR). Every service that loads a
// resource for a user must call this before returning it. Throws 404 (not
// 403) so the API never reveals whether someone else's record exists.
export function assertOwned(actorId: string, ownerId: string, resource: string): void {
  if (actorId !== ownerId) {
    throw new NotFoundException({
      code: ErrorCode.NotFound,
      message: `Không tìm thấy ${resource}.`,
    });
  }
}
