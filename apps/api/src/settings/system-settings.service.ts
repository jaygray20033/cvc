import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { AuditService } from '../common/audit/audit.service';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { SETTING_DEFINITIONS } from './setting-schemas';

const CACHE_TTL_MS = 30_000;

// Runtime configuration (P2.22). Values live in SystemSetting (versioned,
// audit logged), cached in Redis for 30s so a change takes effect without a
// deploy; every read falls back to the schema defaults.
@Injectable()
export class SystemSettingsService {
  private readonly logger = new Logger(SystemSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  // Typed-ish read: returns the stored value or the default.
  async get<T = unknown>(key: string): Promise<T> {
    const cached = await this.redis.get(`setting:${key}`);
    if (cached !== null) {
      try {
        return JSON.parse(cached) as T;
      } catch {
        // Corrupt cache entry: fall through to DB.
      }
    }
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    const value = row ? row.value : (SETTING_DEFINITIONS[key]?.defaultValue ?? null);
    if (value === null) return undefined as T;
    await this.redis
      .setWithTtl(`setting:${key}`, JSON.stringify(value), CACHE_TTL_MS)
      .catch(() => undefined);
    return value as T;
  }

  // List = defaults merged with stored rows.
  async list(): Promise<
    Array<{
      key: string;
      value: unknown;
      version: number | null;
      description: string;
      overridden: boolean;
    }>
  > {
    const rows = await this.prisma.systemSetting.findMany();
    const byKey = new Map(rows.map((row) => [row.key, row]));
    return Object.entries(SETTING_DEFINITIONS).map(([key, def]) => {
      const row = byKey.get(key);
      return {
        key,
        value: row ? row.value : def.defaultValue,
        version: row?.version ?? null,
        description: def.description,
        overridden: Boolean(row),
      };
    });
  }

  // Validates per-key schema, bumps version, invalidates cache, audits.
  async set(key: string, value: unknown, actor: { sub: string; role?: string }): Promise<unknown> {
    const def = SETTING_DEFINITIONS[key];
    if (!def) {
      throw new BadRequestException({
        code: ErrorCode.BadRequest,
        message: 'Khóa cấu hình không tồn tại.',
      });
    }
    const parsed = def.schema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException({
        code: ErrorCode.BadRequest,
        message: 'Giá trị cấu hình không hợp lệ.',
        details: parsed.error.flatten(),
      });
    }

    const before = await this.prisma.systemSetting.findUnique({ where: { key } });
    const row = await this.prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: parsed.data as object, updatedById: actor.sub },
      update: {
        value: parsed.data as object,
        updatedById: actor.sub,
        version: { increment: 1 },
      },
    });
    await this.redis.del(`setting:${key}`).catch(() => undefined);
    await this.audit.log({
      actorId: actor.sub,
      actorRole: actor.role,
      action: 'setting.updated',
      entityType: 'system_setting',
      entityId: key,
      before: before ? { value: before.value, version: before.version } : null,
      after: { value: row.value, version: row.version },
    });
    return row;
  }

  // Change history from the append-only audit log (entityType system_setting).
  async history(key: string, limit = 50) {
    return this.prisma.auditLog.findMany({
      where: { entityType: 'system_setting', entityId: key },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: {
        id: true,
        actorId: true,
        actorRole: true,
        before: true,
        after: true,
        createdAt: true,
      },
    });
  }
}
