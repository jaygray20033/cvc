import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

// Shared Redis client (counters for auth rate limiting/lockout now, BullMQ later).
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis(config.get<string>('redis.url', 'redis://localhost:6379'), {
      lazyConnect: false,
      maxRetriesPerRequest: 2,
    });
  }

  // Atomic counter with a sliding window: sets TTL on first increment only.
  async incrementWithTtl(key: string, windowSeconds: number): Promise<number> {
    const count = await this.client.incr(key);
    if (count === 1) {
      await this.client.expire(key, windowSeconds);
    }
    return count;
  }

  async count(key: string): Promise<number> {
    return this.client.get(key).then((value) => (value === null ? 0 : Number(value)));
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  async reset(key: string): Promise<void> {
    await this.client.del(key);
  }

  // Deletes every key matching a glob pattern (used in tests to clear counters).
  async deleteByPattern(pattern: string): Promise<void> {
    let cursor = '0';
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      if (keys.length > 0) await this.client.del(...keys);
    } while (cursor !== '0');
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
