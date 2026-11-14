import { decryptAesGcm, encryptAesGcm } from './encryption';

describe('encryptAesGcm / decryptAesGcm', () => {
  const secret = 'test-encryption-key-change-me-please';

  it('round-trips a plaintext', () => {
    const cipher = encryptAesGcm('my-totp-secret', secret);
    expect(cipher).not.toContain('my-totp-secret');
    expect(decryptAesGcm(cipher, secret)).toBe('my-totp-secret');
  });

  it('produces different ciphertexts per call (random IV)', () => {
    expect(encryptAesGcm('same', secret)).not.toBe(encryptAesGcm('same', secret));
  });

  it('fails to decrypt with the wrong key', () => {
    const cipher = encryptAesGcm('secret-value', secret);
    expect(() => decryptAesGcm(cipher, 'another-key-entirely')).toThrow();
  });
});
