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
  /** TOTP 2FA (P2.5). */
  totpDigits: 6,
  totpPeriodSec: 30,
  totpWindow: 1,
  totpChallengeTtl: '5m', // pendingToken lifetime after password step
  recoveryCodeCount: 10,
  /** Throttler limits (P2.6), ttl in ms. throttleDefault is the module-level
   * limit; the others are applied per-route via @Throttle({ default: {...} }).
   * Chat/request endpoints get their own overrides later (P4.7, P4.13). */
  throttleDefault: { limit: 100, ttl: 60_000 },
  throttleLogin: { limit: 15, ttl: 60_000 },
  throttleOtp: { limit: 8, ttl: 60_000 },
  throttleForgot: { limit: 6, ttl: 60_000 },
} as const;

/** Roles that must have 2FA enabled (P2.5). Enforced at password login. */
export const TWO_FACTOR_REQUIRED_ROLES = ['admin', 'sales', 'inspector'] as const;

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
  TwoFactorRequired: 'AUTH_2FA_REQUIRED',
  TwoFactorInvalid: 'AUTH_2FA_INVALID',
  TwoFactorAlreadyEnabled: 'AUTH_2FA_ALREADY_ENABLED',
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
