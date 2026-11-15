import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

// One audit entry. before/after are snapshots of the changed record.
export interface AuditEntry {
  actorId?: string;
  actorRole?: string;
  action: string; // dot notation, e.g. 'user.role_switched'
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

// Fields that make up the hash payload (stable field order).
const HASH_FIELDS = [
  'actorId',
  'actorRole',
  'action',
  'entityType',
  'entityId',
  'before',
  'after',
  'ip',
  'userAgent',
  'requestId',
] as const;

// Key-order-insensitive stringify: MySQL JSON reorders object keys, so the
// hash must not depend on the original insertion order.
function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalStringify(v)}`).join(',')}}`;
}

// Append-only audit log (P2.16). No service writes with update/delete and no
// API exposes them; each row hashes its payload plus the previous row's hash
// so any DB tampering breaks the chain (verifyChain).
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  // In-process write mutex: concurrent log() calls would read the same chain
  // head and fork the chain, breaking verifyChain. Serialized per instance.
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly prisma: PrismaService) {}

  // Recompute the row hash the same way the DB write did.
  static rowHash(
    prevHash: string,
    entry: Omit<AuditEntry, 'before' | 'after'> & {
      before?: unknown;
      after?: unknown;
    },
  ): string {
    const payload: Record<string, unknown> = {};
    for (const field of HASH_FIELDS) payload[field] = entry[field] ?? null;
    return createHash('sha256')
      .update(`${prevHash}|${canonicalStringify(payload)}`)
      .digest('hex');
  }

  async log(entry: AuditEntry): Promise<void> {
    // Chain writes through the mutex so each row sees the true head.
    const run = this.queue.then(() => this.write(entry));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async write(entry: AuditEntry): Promise<void> {
    try {
      const last = await this.prisma.auditLog.findFirst({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], // cuid ids break ms ties
        select: { hash: true },
      });
      const prevHash = last?.hash ?? 'GENESIS';
      const hash = AuditService.rowHash(prevHash, entry);
      await this.prisma.auditLog.create({
        data: {
          actorId: entry.actorId,
          actorRole: entry.actorRole,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          before: entry.before === undefined ? undefined : (entry.before as object),
          after: entry.after === undefined ? undefined : (entry.after as object),
          ip: entry.ip,
          userAgent: entry.userAgent,
          requestId: entry.requestId,
          prevHash,
          hash,
        },
      });
    } catch (error) {
      // Audit must never break the business request; failure is loud instead.
      this.logger.error(
        { err: error instanceof Error ? error.message : String(error), action: entry.action },
        'audit log write failed',
      );
    }
  }

  // Walk the chain from the start; returns the first broken row id, if any.
  async verifyChain(): Promise<{ ok: boolean; brokenAtId?: string }> {
    const rows = await this.prisma.auditLog.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    let prevHash = 'GENESIS';
    for (const row of rows) {
      if (row.prevHash !== prevHash) {
        return { ok: false, brokenAtId: row.id };
      }
      const expected = AuditService.rowHash(row.prevHash, {
        actorId: row.actorId ?? undefined,
        actorRole: row.actorRole ?? undefined,
        action: row.action,
        entityType: row.entityType ?? undefined,
        entityId: row.entityId ?? undefined,
        before: row.before,
        after: row.after,
        ip: row.ip ?? undefined,
        userAgent: row.userAgent ?? undefined,
        requestId: row.requestId ?? undefined,
      });
      if (expected !== row.hash) {
        return { ok: false, brokenAtId: row.id };
      }
      prevHash = row.hash;
    }
    return { ok: true };
  }
}
