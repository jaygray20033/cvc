import type { ExecutionContext } from '@nestjs/common';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { ThrottlerLimitDetail } from '@nestjs/throttler';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';

// ThrottlerGuard answering 429 with the shared error envelope ({ code, message })
// and a proper Retry-After header, instead of the library's plain message (P2.6).
export class RetryAfterThrottlerGuard extends ThrottlerGuard {
  protected async throwThrottlingException(
    context: ExecutionContext,
    throttler: ThrottlerLimitDetail,
  ): Promise<void> {
    const ttlSeconds = Math.ceil(throttler.ttl / 1000);
    const res = context.switchToHttp().getResponse<Response>();
    res.setHeader('Retry-After', ttlSeconds);
    throw new HttpException(
      {
        code: 'RATE_LIMITED',
        message: `Quá nhiều yêu cầu. Vui lòng thử lại sau ${ttlSeconds} giây.`,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
