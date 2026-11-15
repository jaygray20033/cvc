import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

import { AuditService } from './audit.service';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const isPublic = (path: string): boolean => path === '/health' || path === '/ready';

// Automatic audit for write requests (P2.16): action = method + controller +
// handler, entity type from the route path, entity id from the response body
// when it has one. Rich domain events (role switch, KYC review...) are logged
// manually with AuditService on top of this baseline.
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<{ method: string; url?: string; path?: string }>();
    const path = request.path ?? request.url ?? '';
    if (!WRITE_METHODS.has(request.method) || isPublic(path)) {
      return next.handle();
    }

    return next.handle().pipe(
      tap({
        next: (body) => void this.auditWrite(context, request as never, body, path),
        // Failed writes are not audited: only committed state changes.
        error: () => undefined,
      }),
    );
  }

  private async auditWrite(
    context: ExecutionContext,
    request: Request & { user?: { sub?: string; role?: string }; id?: string; ip?: string },
    body: unknown,
    path: string,
  ): Promise<void> {
    try {
      const handler = context.getHandler();
      const controller = context.getClass().name;
      // Entity type = first path segment after the prefix, skipping the
      // generic 'me'/'admin' scopes (e.g. /me/addresses -> 'addresses').
      const parts = path
        .replace(/^\/?api\/v1\/?/, '')
        .split(/[/:?]/)
        .filter(Boolean);
      const entityType = parts.find((p) => p !== 'me' && p !== 'admin') || undefined;
      const entityId =
        body && typeof body === 'object' && 'id' in (body as Record<string, unknown>)
          ? String((body as Record<string, unknown>).id)
          : undefined;
      await this.audit.log({
        actorId: request.user?.sub,
        actorRole: request.user?.role,
        action: `${request.method} ${controller}.${String(handler.name)}`,
        entityType,
        entityId,
        after: body && typeof body === 'object' ? (body as object) : undefined,
        ip: request.ip,
        userAgent: (request.headers as unknown as Record<string, string | undefined>)['user-agent'],
        requestId: request.id,
      });
    } catch {
      // Never let audit bookkeeping break the response.
    }
  }
}
