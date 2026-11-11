import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';

// Background job worker (same image as api, different command). Real queues land in later phases.
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  logger.error('REDIS_URL is required for the worker.');
  process.exit(1);
}

const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
const queueName = 'cvc-default';

const worker = new Worker(
  queueName,
  async (job) => {
    // Placeholder processor; replace with real handlers per phase.
    logger.info({ jobId: job.id, name: job.name }, 'processing job');
  },
  { connection },
);

worker.on('ready', () => logger.info({ queue: queueName }, 'worker ready'));
worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'job failed'));

async function shutdown(): Promise<void> {
  await worker.close();
  await connection.quit();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
