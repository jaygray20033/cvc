// Auth limits and stable error codes. Values chosen to balance security/UX;
// expose via SystemSetting later (P2.22) if ops need to tune them.
export const AUTH_LIMITS = {
  /** Failed logins per account/IP before temporary lockout (P2.3). */
  loginMaxFailures: 5,
  loginLockWindowSec: 15 * 60,
  /** OTP codes (P2.2, delivered by email/Gmail — no SMS, see D13 cost decision). */
  otpLength: 6,
  otpTtlMinutes: 5,
  otpMaxVerifyAttempts: 5,
  otpSendsPerEmail: 3,
  otpSendsPerEmailWindowSec: 15 * 60,
  otpSendsPerIp: 10,
  otpSendsPerIpWindowSec: 60 * 60,
  /** One-time email tokens (P2.1) and password reset (P2.3). */
  verifyEmailTtlHours: 24,
  resetTtlMinutes: 60,
  forgotSendsPerEmail: 3,
  forgotSendsPerEmailWindowSec: 15 * 60,
} as const;

export const AuthErrorCode = {
  InvalidCredentials: 'AUTH_INVALID_CREDENTIALS',
  EmailNotVerified: 'AUTH_EMAIL_NOT_VERIFIED',
  AccountDisabled: 'AUTH_ACCOUNT_DISABLED',
  Locked: 'AUTH_LOCKED',
  RateLimited: 'AUTH_RATE_LIMITED',
  TokenInvalid: 'AUTH_TOKEN_INVALID',
  TokenExpired: 'AUTH_TOKEN_EXPIRED',
  RefreshReused: 'AUTH_REFRESH_REUSED',
  OtpInvalid: 'AUTH_OTP_INVALID',
  PasswordPolicy: 'AUTH_PASSWORD_POLICY',
  ResetTokenInvalid: 'AUTH_RESET_TOKEN_INVALID',
  NoPassword: 'AUTH_NO_PASSWORD',
  EmailTaken: 'AUTH_EMAIL_TAKEN',
  SessionNotFound: 'AUTH_SESSION_NOT_FOUND',
} as const;

export type AuthErrorCode = (typeof AuthErrorCode)[keyof typeof AuthErrorCode];

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

// Client IP: prefer the proxy chain (nginx) header, fall back to socket address.
export function readRequestMeta(req: {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}): RequestMeta {
  const forwarded = req.headers['x-forwarded-for'];
  const forwardedIp = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const ip = (forwardedIp?.split(',')[0].trim() || req.ip || null) ?? null;
  const rawUa = req.headers['user-agent'];
  const userAgent = (Array.isArray(rawUa) ? rawUa[0] : rawUa)?.slice(0, 512) ?? null;
  return { ip, userAgent };
}
