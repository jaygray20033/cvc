// Queue names (P2.19). Business modules push work here instead of running
// it in-process; the dead-letter queue collects jobs that exhausted retries.
export const QUEUE_NAMES = [
  'notifications',
  'payments',
  'reconcile',
  'campaign',
  'claims',
  'files',
  'cron',
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

export const DEAD_LETTER_QUEUE = 'dead-letter';

// Default per-job policy: 5 attempts with exponential backoff (3s base).
export const DEFAULT_JOB_ATTEMPTS = 5;
export const DEFAULT_BACKOFF = { type: 'exponential' as const, delay: 3000 };
