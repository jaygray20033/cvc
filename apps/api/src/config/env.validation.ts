import { z } from 'zod';

import configuration from './configuration';

// Env schema. Boot fails fast and names the missing/invalid variables.
// Integration keys stay empty until a provider is wired (Backlog, D13 manual ops).
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.string().url().default('http://localhost:5173'),
  API_URL: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be >= 16 chars'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be >= 16 chars'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  ENCRYPTION_KEY: z.string().min(16, 'ENCRYPTION_KEY must be >= 16 chars'),

  S3_ENDPOINT: z.string().min(1),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET_PUBLIC: z.string().min(1),
  S3_BUCKET_PRIVATE: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  EMAIL_FROM: z.string().min(1),

  // Password breach check (HIBP k-anonymity). Third-party HTTP call, so it is
  // disabled by default outside production (CLAUDE.md: no real 3rd-party calls
  // in dev/test).
  PASSWORD_BREACH_CHECK: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),

  // Optional provider keys (empty until integrated; no gateway/webhook per D13).
  SMS_PROVIDER_KEY: z.string().optional().default(''),
  ZNS_PROVIDER_KEY: z.string().optional().default(''),
  TRANSLATION_PROVIDER_KEY: z.string().optional().default(''),
  INVOICE_PROVIDER_KEY: z.string().optional().default(''),
  EKYC_PROVIDER_KEY: z.string().optional().default(''),

  // KYC (P2.14). slaHours: review SLA shown to the user (moves to SystemSetting
  // in P2.22). cccdHashSalt: salt for the salted HMAC of the CCCD number, used
  // only for cross-account duplicate detection; rotate = re-hash stored rows.
  KYC_SLA_HOURS: z.coerce.number().int().positive().default(48),
  KYC_CCCD_HASH_SALT: z.string().min(16).default('dev-kyc-cccd-salt-change-me-32'),

  // ClamAV TCP daemon for the file service (P2.17). Empty host disables the
  // remote scan and falls back to local EICAR signature checking in dev.
  CLAMAV_HOST: z.string().optional().default(''),
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
});

export type Env = z.infer<typeof envSchema>;

// Returns the structured config (app/database/...) consumed via ConfigService.get('app.port').
export function validateEnv(config: Record<string, unknown>) {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return configuration(parsed.data);
}
