import { ConfigService } from '@nestjs/config';

import { BreachCheckService, sha1Hex } from './breach-check.service';

// HIBP k-anonymity adapter. Never calls the real API in unit tests (mocked fetch).
describe('BreachCheckService', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('is disabled by default outside production and never calls the API', async () => {
    const service = new BreachCheckService(new ConfigService({ password: { breachCheck: false } }));
    globalThis.fetch = jest.fn();
    await expect(service.isBreached(sha1Hex('password123'))).resolves.toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('detects a breached password via the k-anonymity range API', async () => {
    const service = new BreachCheckService(new ConfigService({ password: { breachCheck: true } }));
    const sha1 = sha1Hex('breached-password-example');
    const prefix = sha1.slice(0, 5).toUpperCase();
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        ['ABCDEF0123456789ABCDEF01234567891234:5', `${sha1.slice(5).toUpperCase()}:3`].join('\n'),
    });

    await expect(service.isBreached(sha1)).resolves.toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `https://api.pwnedpasswords.com/range/${prefix}`,
      expect.anything(),
    );
  });

  it('treats unknown suffixes as not breached', async () => {
    const service = new BreachCheckService(new ConfigService({ password: { breachCheck: true } }));
    const sha1 = sha1Hex('unique-password-not-in-dump');
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        'ABCDEF0123456789ABCDEF01234567891234:5\nFEDCBA0123456789ABCDEF01234567891234:1\n',
    });
    await expect(service.isBreached(sha1)).resolves.toBe(false);
  });

  it('fails open when the HIBP API is unreachable', async () => {
    const service = new BreachCheckService(new ConfigService({ password: { breachCheck: true } }));
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('network down'));
    await expect(service.isBreached(sha1Hex('whatever-password'))).resolves.toBe(false);
  });
});
