import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import { Worker } from 'bullmq';
import Redis from 'ioredis';

import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { SourcingRequestsService } from '../sourcing/sourcing-requests.service';
import { DistributedLockService } from './distributed-lock.service';
import { DEAD_LETTER_QUEUE, QUEUE_NAMES, type QueueName } from './queue.constants';
import { QueueService } from './queue.service';

type JobData = Record<string, unknown>;
type Handler = (data: JobData) => Promise<unknown>;

// Queue consumers (P2.19). Workers run in every process that boots AppModule
// (api + dedicated worker + tests): BullMQ load-balances and at-most-once
// delivery per job is guaranteed by Redis. Jobs that exhaust their attempts
// are mirrored into the dead-letter queue for admin inspection.
@Injectable()
export class QueueProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueProcessor.name);
  private readonly workers: Worker[] = [];
  private readonly connection: Redis;

  constructor(
    private readonly queues: QueueService,
    private readonly lock: DistributedLockService,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly files: FilesService,
    private readonly redis: RedisService,
    private readonly sourcing: SourcingRequestsService,
    config: ConfigService,
  ) {
    this.connection = new Redis(config.get<string>('redis.url', 'redis://localhost:6379'), {
      maxRetriesPerRequest: null,
    });
  }

  // Handler registry: queue -> jobName -> handler. Placeholders for queues
  // whose business modules land in P4/P5.
  private handlers(queue: QueueName): Record<string, Handler> {
    switch (queue) {
      case 'notifications':
        return {
          // { event, userId, data }
          'notification.deliver': (d) =>
            this.notifications.emit(String(d.event), String(d.userId), (d.data as JobData) ?? {}),
        };
      case 'files':
        return {
          // { fileId } — virus scan + thumbnail post-processing.
          'file.post-process': (d) => this.files.postProcessById(String(d.fileId)),
        };
      case 'payments':
        return {
          // Test hooks: always fail (dead-letter flow) and flaky (retry flow).
          'test.fail': async () => {
            throw new Error('intentional test failure');
          },
          'test.flaky': async (d) => {
            if (d.fail === true) throw new Error('flaky failure');
            return { ok: true };
          },
          // Counts every run of the job in Redis — used to verify that
          // enqueueIdempotent really deduplicates (P2.19).
          'test.count': async (d) => {
            await this.redis.incrementWithTtl(`qtest:count:${String(d.marker)}`, 3600);
            return { ok: true };
          },
        };
      case 'reconcile':
      case 'campaign':
      case 'claims':
        return {
          'placeholder.run': async (d) => {
            this.logger.log({ d }, 'placeholder job (business module lands later)');
            return { ok: true };
          },
        };
      case 'cron':
        return {
          // Scheduled sweeps: distributed lock keeps a single runner.
          'kyc.sla-sweep': () => this.sweepKycSla(),
          'files.rescan-stuck': () => this.rescanStuckFiles(),
          'sourcing.sla-remind': () => this.remindSourcingSla(),
        };
      default:
        return {};
    }
  }

  async onModuleInit(): Promise<void> {
    // Eagerly create queues so bull-board can attach to all of them.
    for (const name of QUEUE_NAMES) this.queues.getQueue(name);

    for (const name of QUEUE_NAMES) {
      const worker = new Worker(
        name,
        async (job) => {
          const handler = this.handlers(name)[job.name];
          if (!handler) throw new Error(`No handler for job ${name}/${job.name}`);
          return handler(job.data as JobData);
        },
        { connection: this.connection, concurrency: 5 },
      );
      worker.on(
        'failed',
        (job: Job | undefined, err: Error) => void this.handleFailure(name, job, err),
      );
      worker.on('error', (err: Error) =>
        this.logger.error({ err: String(err) }, `worker error (${name})`),
      );
      this.workers.push(worker);
    }
    // Dead-letter queue has no worker: jobs pile up as the failure archive.
    this.queues.getQueue(DEAD_LETTER_QUEUE);

    await this.scheduleCronJobs();
    this.logger.log(`queue workers started (${QUEUE_NAMES.join(', ')})`);
  }

  // Final failures (attempts exhausted) are archived into the dead-letter
  // queue with the original context so admins can inspect/requeue them.
  private async handleFailure(queue: string, job: Job | undefined, err: Error): Promise<void> {
    if (!job) return;
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < attempts) return; // will retry
    try {
      await this.queues.getQueue(DEAD_LETTER_QUEUE).add('dead', {
        queue,
        jobId: job.id,
        name: job.name,
        data: job.data,
        error: err.message,
        failedAt: new Date().toISOString(),
      });
      this.logger.warn({ queue, jobId: job.id, name: job.name }, 'job moved to dead-letter');
    } catch (e) {
      this.logger.error({ err: String(e) }, 'dead-letter write failed');
    }
  }

  // Cron jobs (P2.19): repeatable + distributed lock inside each handler.
  private async scheduleCronJobs(): Promise<void> {
    const cron = this.queues.getQueue('cron');
    await cron.add(
      'kyc.sla-sweep',
      {},
      { repeat: { pattern: '*/15 * * * *' }, jobId: 'cron-kyc-sla-sweep' },
    );
    await cron.add(
      'files.rescan-stuck',
      {},
      { repeat: { pattern: '*/5 * * * *' }, jobId: 'cron-files-rescan' },
    );
    await cron.add(
      'sourcing.sla-remind',
      {},
      { repeat: { pattern: '*/10 * * * *' }, jobId: 'cron-sourcing-sla-remind' },
    );
  }

  // KYC SLA sweep: log pending submissions older than the SLA (manual ops).
  private async sweepKycSla(): Promise<unknown> {
    return this.lock.withLock('kyc-sla-sweep', 10 * 60 * 1000, async () => {
      const slaHours = 48;
      const overdue = await this.prisma.kycSubmission.count({
        where: { status: 'PENDING', createdAt: { lt: new Date(Date.now() - slaHours * 3600_000) } },
      });
      if (overdue > 0) {
        this.logger.warn({ overdue }, `kyc sla: ${overdue} pending submissions past ${slaHours}h`);
      }
      return { overdue };
    });
  }

  // Rescan files stuck in PENDING scan (worker crash, scan outage).
  private async rescanStuckFiles(): Promise<unknown> {
    return this.lock.withLock('files-rescan-stuck', 10 * 60 * 1000, async () => {
      const stuck = await this.prisma.fileObject.findMany({
        where: { scanStatus: 'PENDING', updatedAt: { lt: new Date(Date.now() - 30 * 60_000) } },
        select: { id: true },
        take: 10,
      });
      for (const file of stuck) {
        await this.files.postProcessById(file.id).catch(() => undefined);
      }
      return { rescanned: stuck.length };
    });
  }

  // P4.8: nudge assignees about overdue RFQs (once per SLA assignment).
  private async remindSourcingSla(): Promise<unknown> {
    return this.lock.withLock('sourcing-sla-remind', 10 * 60 * 1000, () =>
      this.sourcing.remindOverdueSla(),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
    await this.connection.quit();
  }
}
