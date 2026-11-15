import { createHash, createHmac } from 'node:crypto';

import { decryptAesGcm, encryptAesGcm } from './encryption';

// Format validators for profile data (P2.11).
export const TAX_ID_RE = /^[0-9]{10}(-[0-9]{3})?$/;
export const PHONE_RE = /^(0|\+84)\d{9}$/;
export const BANK_ACCOUNT_RE = /^[0-9]{6,19}$/;
// Vietnam CCCD (citizen id): 12 digits (P2.14).
export const CCCD_RE = /^[0-9]{12}$/;

// Name normalization for the bank-holder match rule (P2.11): lowercase,
// strip Vietnamese diacritics, collapse whitespace. "Nguyễn Văn A" and
// "nguyen van a" must match.
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

// True when the bank holder name matches one of the profile names.
export function holderNameMatches(holderName: string, profileNames: string[]): boolean {
  const holder = normalizeName(holderName);
  return profileNames.some((n) => normalizeName(n) === holder && holder.length > 0);
}

// Encrypt a bank account number for storage (AES-256-GCM, see encryption.ts).
export function encryptAccountNo(accountNo: string, secret: string): string {
  return encryptAesGcm(accountNo, secret);
}

export function decryptAccountNo(accountNoEnc: string, secret: string): string {
  return decryptAesGcm(accountNoEnc, secret);
}

// Display mask: "1234567" -> "****4567" (P2.11 DoD). Never expose full digits.
export function maskAccountNo(accountNo: string): string {
  const last4 = accountNo.slice(-4);
  return `****${last4}`;
}

export function maskAccountNoFromEnc(accountNoEnc: string, secret: string): string {
  return maskAccountNo(decryptAesGcm(accountNoEnc, secret));
}

// P2.14 CCCD (citizen id) handling. The number is AES-256-GCM encrypted for
// admin viewing, and separately hashed with a salt (HMAC-SHA256) so the same
// number reused across accounts can be detected without ever comparing
// plaintext or exposing it. A salted hash (not a bare SHA-256) prevents an
// offline rainbow lookup over the small CCCD number space.
export function encryptCccdNumber(cccdNumber: string, secret: string): string {
  return encryptAesGcm(cccdNumber, secret);
}

export function decryptCccdNumber(cccdNumberEnc: string, secret: string): string {
  return decryptAesGcm(cccdNumberEnc, secret);
}

export function hashCccdNumber(cccdNumber: string, salt: string): string {
  return createHmac('sha256', salt).update(cccdNumber, 'utf8').digest('hex');
}

// SHA-256 of a KYC file's bytes (P2.14 duplicate-image detection).
export function hashImageBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
