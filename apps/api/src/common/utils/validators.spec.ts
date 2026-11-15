import {
  BANK_ACCOUNT_RE,
  encryptAccountNo,
  holderNameMatches,
  maskAccountNo,
  maskAccountNoFromEnc,
  normalizeName,
  PHONE_RE,
  TAX_ID_RE,
} from './validators';

describe('profile validators (P2.11)', () => {
  describe('format regexes', () => {
    it('tax id (MST): 10 digits, or 10 + 3 branch digits', () => {
      expect('0123456789').toMatch(TAX_ID_RE);
      expect('0123456789-001').toMatch(TAX_ID_RE);
      expect('012345678').not.toMatch(TAX_ID_RE);
      expect('01234567890').not.toMatch(TAX_ID_RE);
      expect('01-23456-89').not.toMatch(TAX_ID_RE);
    });

    it('VN phone: 0xxxxxxxxx or +84xxxxxxxxx (9 digits after prefix)', () => {
      expect('0912345678').toMatch(PHONE_RE);
      expect('+84912345678').toMatch(PHONE_RE);
      expect('1234567890').not.toMatch(PHONE_RE); // must start with 0
      expect('091234567').not.toMatch(PHONE_RE); // too short
      expect('09123456789').not.toMatch(PHONE_RE); // too long
    });

    it('bank account: 6-19 digits', () => {
      expect('123456').toMatch(BANK_ACCOUNT_RE);
      expect('1234567890123').toMatch(BANK_ACCOUNT_RE);
      expect('12345').not.toMatch(BANK_ACCOUNT_RE);
      expect('12345678901234567890').not.toMatch(BANK_ACCOUNT_RE);
      expect('1234-5678').not.toMatch(BANK_ACCOUNT_RE);
      expect('12a456').not.toMatch(BANK_ACCOUNT_RE);
    });
  });

  describe('normalizeName + holderNameMatches', () => {
    it('lowercases, strips diacritics and collapses spaces', () => {
      expect(normalizeName('  Nguyễn   Văn  A ')).toBe('nguyen van a');
      expect(normalizeName('CÔNG TY TNHH ĐẠI PHÁT')).toBe('cong ty tnhh dai phat');
    });

    it('holder matches the profile display name regardless of diacritics/case', () => {
      expect(holderNameMatches('NGUYEN VAN A', ['Nguyễn Văn A'])).toBe(true);
      expect(holderNameMatches('Công ty TNHH Đại Phát', ['cong ty tnhh dai phat'])).toBe(true);
      expect(holderNameMatches('Nguyen Van B', ['Nguyễn Văn A'])).toBe(false);
      expect(holderNameMatches('', ['Nguyễn Văn A'])).toBe(false);
    });
  });

  describe('maskAccountNo', () => {
    it('shows only the last 4 digits', () => {
      expect(maskAccountNo('1234567')).toBe('****4567');
      expect(maskAccountNo('1234')).toBe('****1234');
    });

    it('masks an encrypted value end to end', () => {
      const enc = encryptAccountNo('9876543210', 'test-secret');
      expect(maskAccountNoFromEnc(enc, 'test-secret')).toBe('****3210');
      // wrong key must not decrypt to a maskable value
      expect(() => maskAccountNoFromEnc(enc, 'other-key')).toThrow();
    });
  });
});
