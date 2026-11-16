import { createHash } from 'node:crypto';

import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  UnprocessableEntityException,
} from '@nestjs/common';
import { firstValueFrom, Observable } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

import type { AccessPayload } from '../../common/decorators/current-user.decorator';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../prisma/prisma.service';

const TTL_MS = 24 * 60 * 60 * 1000; // 24h (P2.21)
const IN_FLIGHT_POLL_MS = 100;
const IN_FLIGHT_MAX_MS = 5000;

interface StoredResponse {
  status: number;
  body: unknown;
}

// Idempotency for POSTs carrying an Idempotency-Key header (P2.21). The first
// request inserts a lock row (unique key) and stores the real response once
// sent; replays return the stored response with the original status; the same
// key with a different body is 422; concurrent duplicates poll briefly then
// get 409. Errors release the reservation so the client can retry.
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<{
      method: string;
      path: string;
      user?: AccessPayload;
      body?: unknown;
      headers: Record<string, string | string[] | undefined>;
    }>();
    const response = http.getResponse<{
      statusCode: number;
      writableEnded: boolean;
      once(event: string, listener: () => void): unknown;
    }>();

    const header = request.headers['idempotency-key'];
    const rawKey =
      typeof header === 'string' ? header : Array.isArray(header) ? (header[0] ?? '') : '';
    const key = rawKey.trim();
    if (request.method !== 'POST' || !key || key.length > 191) {
      return next.handle();
    }

    const scope = request.path.slice(0, 100);
    const storageKey = createHash('sha256').update(`${scope}|${key}`).digest('hex');
    const requestHash = createHash('sha256')
      .update(JSON.stringify(request.body ?? {}))
      .digest('hex');

    return fromPromise(this.replayOrRun(next, { storageKey, scope, requestHash, response }));
  }

  private async replayOrRun(
    next: CallHandler,
    ctx: {
      storageKey: string;
      scope: string;
      requestHash: string;
      response: {
        statusCode: number;
        writableEnded: boolean;
        once(event: string, listener: () => void): unknown;
      };
    },
  ): Promise<unknown> {
    // Existing row: same body -> replay; different body -> 422; no response
    // yet (another request in flight) -> poll briefly, then 409.
    const existing = await this.prisma.idempotencyKey.findUnique({
      where: { key: ctx.storageKey },
    });
    if (existing) {
      if (existing.expiresAt.getTime() < Date.now()) {
        await this.prisma.idempotencyKey
          .delete({ where: { key: ctx.storageKey } })
          .catch(() => undefined);
      } else {
        if (existing.requestHash !== ctx.requestHash) {
          throw new UnprocessableEntityException({
            code: ErrorCode.UnprocessableEntity,
            message: 'Idempotency-Key đã được dùng cho một yêu cầu khác nội dung.',
          });
        }
        const stored = await this.awaitStoredResponse(ctx.storageKey);
        if (stored) {
          ctx.response.statusCode = stored.status;
          return stored.body;
        }
        throw new ConflictException({
          code: ErrorCode.Conflict,
          message: 'Yêu cầu với Idempotency-Key này đang được xử lý.',
        });
      }
    }

    // Reserve the key; losing the insert race means someone else is running it.
    try {
      await this.prisma.idempotencyKey.create({
        data: {
          key: ctx.storageKey,
          scope: ctx.scope,
          requestHash: ctx.requestHash,
          expiresAt: new Date(Date.now() + TTL_MS),
        },
      });
    } catch {
      const raced = await this.awaitStoredResponse(ctx.storageKey);
      if (raced) {
        ctx.response.statusCode = raced.status;
        return raced.body;
      }
      throw new ConflictException({
        code: ErrorCode.Conflict,
        message: 'Yêu cầu với Idempotency-Key này đang được xử lý.',
      });
    }

    return firstValueFrom(
      next.handle().pipe(
        tap((body) => {
          const store = (): void => {
            void this.prisma.idempotencyKey
              .update({
                where: { key: ctx.storageKey },
                data: { response: { status: ctx.response.statusCode, body } as object },
              })
              .catch(() => undefined);
          };
          // The true status code is only known when the response is flushed.
          if (ctx.response.writableEnded) {
            store();
          } else {
            ctx.response.once('finish', store);
          }
        }),
        // Errors release the reservation: the request may be retried.
        catchError((err: unknown) => {
          void this.prisma.idempotencyKey
            .delete({ where: { key: ctx.storageKey } })
            .catch(() => undefined);
          throw err;
        }),
      ),
    );
  }

  private async awaitStoredResponse(storageKey: string): Promise<StoredResponse | null> {
    const deadline = Date.now() + IN_FLIGHT_MAX_MS;
    while (Date.now() < deadline) {
      await sleep(IN_FLIGHT_POLL_MS);
      const row = await this.prisma.idempotencyKey.findUnique({ where: { key: storageKey } });
      if (row?.response) return row.response as unknown as StoredResponse;
      if (!row) return null; // released by a failed run
    }
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fromPromise(promise: Promise<unknown>): Observable<unknown> {
  return new Observable((subscriber) => {
    promise.then(
      (value) => {
        subscriber.next(value);
        subscriber.complete();
      },
      (err) => subscriber.error(err),
    );
  });
}
