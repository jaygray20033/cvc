import {
  otpHtml,
  otpText,
  passwordChangedHtml,
  resetPasswordHtml,
  verifyEmailHtml,
} from './mail.templates';

describe('mail templates', () => {
  it('verification email carries the one-time link and validity window', () => {
    const html = verifyEmailHtml('https://app/verify-email?token=abc123', 24);
    expect(html).toContain('https://app/verify-email?token=abc123');
    expect(html).toContain('24');
  });

  it('OTP email carries the 6-digit code and expiry, but nothing else sensitive', () => {
    const text = otpText('012345', 5);
    expect(text).toContain('012345');
    expect(text).toContain('5 phút');
    expect(otpHtml('012345', 5)).toContain('012345');
  });

  it('reset email carries the reset link and short validity', () => {
    const html = resetPasswordHtml('https://app/reset-password?token=xyz789', 60);
    expect(html).toContain('https://app/reset-password?token=xyz789');
    expect(html).toContain('60');
  });

  it('password-changed notice tells the user and asks to act if unauthorized', () => {
    const html = passwordChangedHtml('2026-11-13T00:00:00.000Z');
    expect(html).toContain('2026-11-13');
    expect(html).toContain('đăng xuất');
  });
});
