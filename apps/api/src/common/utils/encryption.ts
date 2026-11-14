import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// AES-256-GCM helpers for sensitive data at rest (TOTP secrets now; bank
// accounts later). Key is derived by hashing ENCRYPTION_KEY so any length
// works. Output: base64(iv[12] | authTag[16] | ciphertext).
export function encryptAesGcm(plaintext: string, secret: string): string {
  const key = createHash('sha256').update(secret, 'utf8').digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

export function decryptAesGcm(encoded: string, secret: string): string {
  const key = createHash('sha256').update(secret, 'utf8').digest();
  const data = Buffer.from(encoded, 'base64');
  const iv = data.subarray(0, 12);
  const authTag = data.subarray(12, 28);
  const ciphertext = data.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
