import { Writable } from 'node:stream';

import pino from 'pino';

import { redactPaths } from './logger.config';

describe('logger redaction', () => {
  it('censors sensitive fields at every configured path', () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const logger = pino({ redact: { paths: redactPaths, censor: '[REDACTED]' } }, sink);

    logger.info(
      {
        password: 'supersecret',
        user: { password: 'nestedpass', cccd: '0123456789', bankAccount: '99998888' },
        req: { headers: { authorization: 'Bearer tok' } },
      },
      'test',
    );

    const out = lines.join('');
    expect(out).not.toContain('supersecret');
    expect(out).not.toContain('nestedpass');
    expect(out).not.toContain('0123456789');
    expect(out).not.toContain('99998888');
    expect(out).not.toContain('Bearer tok');
    expect(out).toContain('[REDACTED]');
  });
});
