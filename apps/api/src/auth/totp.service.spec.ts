import { TotpService } from './totp.service';

describe('TotpService', () => {
  const service = new TotpService();
  const email = 'user@example.com';
  const secret = service.generateSecretBase32();

  it('generates base32 secrets', () => {
    expect(secret).toMatch(/^[A-Z2-7]+=*$/);
    expect(secret.length).toBeGreaterThanOrEqual(32);
    expect(service.generateSecretBase32()).not.toBe(service.generateSecretBase32());
  });

  it('builds a standard otpauth:// uri', () => {
    const uri = service.otpauthUri(email, secret);
    expect(uri).toContain('otpauth://totp/');
    expect(uri).toContain(`secret=${secret}`);
    expect(uri).toContain('issuer=CVC');
  });

  it('verifies the current window code', () => {
    const code = service.forUser(email, secret).generate();
    expect(service.verify(email, secret, code)).toBe(true);
  });

  it('rejects malformed codes', () => {
    expect(service.verify(email, secret, 'abc123')).toBe(false);
    expect(service.verify(email, secret, '12345')).toBe(false);
    expect(service.verify(email, secret, '')).toBe(false);
  });

  it('rejects codes from a different secret', () => {
    const otherCode = service.forUser(email, service.generateSecretBase32()).generate();
    expect(service.verify(email, secret, otherCode)).toBe(false);
  });
});
