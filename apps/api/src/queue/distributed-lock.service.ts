import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../redis/redis.service';

// Distributed lock over Redis (P2.19): SET key token NX PX ttl. Used by cron
// jobs so only one instance runs a scheduled task even with many workers.
@Injectable()
export class DistributedLockService {
  private readonly logger = new Logger(DistributedLockService.name);

  constructor(private readonly redis: RedisService) {}

  // Returns a release token, or null when the lock is already held.
  async acquire(key: string, ttlMs: number): Promise<string | null> {
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const ok = await this.redis.setNx(`lock:${key}`, token, ttlMs);
    return ok ? token : null;
  }

  // Release only if we still own the lock (token compare; dev scale is fine).
  async release(key: string, token: string): Promise<void> {
    const full = `lock:${key}`;
    if ((await this.redis.get(full)) === token) {
      await this.redis.del(full);
    }
  }

  // Runs fn while holding the lock; returns null when the lock is taken.
  async withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
    const token = await this.acquire(key, ttlMs);
    if (!token) return null;
    try {
      return await fn();
    } finally {
      await this.release(key, token).catch((err) =>
        this.logger.warn({ err: String(err) }, 'lock release failed'),
      );
    }
  }
}
