import { randomUUID } from 'node:crypto';

import type { Options } from 'pino-http';

// Sensitive fields never written to logs (CLAUDE.md: no CCCD, account, token, OTP).
export const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'cccd',
  'cccdNumber',
  'bankAccount',
  'accountNumber',
  'otp',
  'secret',
  '*.password',
  '*.token',
  '*.cccd',
  '*.bankAccount',
  '*.otp',
  'user.password',
  'user.cccd',
  'user.bankAccount',
  'body.password',
  'body.cccd',
];

// JSON logs in prod, pretty in dev. Each request gets an x-request-id.
export function buildPinoOptions(nodeEnv: string): Options {
  const isDev = nodeEnv === 'development';
  return {
    level: isDev ? 'debug' : 'info',
    redact: { paths: redactPaths, censor: '[REDACTED]' },
    genReqId: (req, res) => {
      const header = req.headers['x-request-id'];
      const id = typeof header === 'string' && header.length > 0 ? header : randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    transport: isDev
      ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
      : undefined,
  };
}
