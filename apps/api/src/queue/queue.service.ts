import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

import { DEFAULT_BACKOFF, DEFAULT_JOB_ATTEMPTS } from './queue.constants';

// Central BullMQ producer (P2.19). Queues are created lazily on a dedicated
// connection (maxRetriesPerRequest must be null for BullMQ). Business code
// calls enqueue(); the processor (same module) consumes.
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly connection: Redis;
  private readonly queues = new Map<string, Queue>();

  constructor(config: ConfigService) {
    this.connection = new Redis(config.get<string>('redis.url', 'redis://localhost:6379'), {
      maxRetriesPerRequest: null,
    });
  }

  getQueue(name: string): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, {
        connection: this.connection,
        defaultJobOptions: {
          attempts: DEFAULT_JOB_ATTEMPTS,
          backoff: DEFAULT_BACKOFF,
          // Keep a bounded tail of results for inspection.
          removeOnComplete: { count: 1000 },
          removeOnFail: { count: 5000 },
        },
      });
      this.queues.set(name, queue);
    }
    return queue;
  }

  async enqueue(
    name: string,
    jobName: string,
    data: Record<string, unknown>,
    opts: Record<string, unknown> = {},
  ): Promise<string | undefined> {
    const job = await this.getQueue(name).add(jobName, data, opts);
    return job?.id;
  }

  // Same jobId is deduplicated by BullMQ: replaying an enqueue is a no-op.
  async enqueueIdempotent(
    name: string,
    jobName: string,
    data: Record<string, unknown>,
    idempotencyId: string,
    opts: Record<string, unknown> = {},
  ): Promise<string | undefined> {
    return this.enqueue(name, jobName, data, { ...opts, jobId: idempotencyId });
  }

  // Counts per state for the admin jobs API.
  async counts(name: string): Promise<Record<string, number>> {
    const queue = this.getQueue(name);
    const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed');
    return counts as Record<string, number>;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    await this.connection.quit();
  }
}
