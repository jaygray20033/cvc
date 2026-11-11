import type { Env } from './env.validation';

// Structured config grouped by concern; read via ConfigService.get('app.port') etc.
export default (env: Env) => ({
  app: {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    appUrl: env.APP_URL,
    apiUrl: env.API_URL,
    isProduction: env.NODE_ENV === 'production',
  },
  database: { url: env.DATABASE_URL },
  redis: { url: env.REDIS_URL },
  jwt: {
    accessSecret: env.JWT_ACCESS_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessTtl: env.JWT_ACCESS_TTL,
    refreshTtl: env.JWT_REFRESH_TTL,
  },
  encryption: { key: env.ENCRYPTION_KEY },
  s3: {
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    bucketPublic: env.S3_BUCKET_PUBLIC,
    bucketPrivate: env.S3_BUCKET_PRIVATE,
    accessKey: env.S3_ACCESS_KEY,
    secretKey: env.S3_SECRET_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  },
  mail: {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.EMAIL_FROM,
  },
});
