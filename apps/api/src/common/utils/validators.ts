import { decryptAesGcm, encryptAesGcm } from './encryption';

// Format validators for profile data (P2.11).
export const TAX_ID_RE = /^[0-9]{10}(-[0-9]{3})?$/;
export const PHONE_RE = /^(0|\+84)\d{9}$/;
export const BANK_ACCOUNT_RE = /^[0-9]{6,19}$/;

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
