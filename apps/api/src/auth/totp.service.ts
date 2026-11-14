import { Injectable } from '@nestjs/common';
import { Secret, TOTP } from 'otpauth';

import { AUTH_LIMITS } from './auth.constants';

// TOTP (RFC 6238) helper wrapping the `otpauth` library. Six digits / 30s
// period (standard authenticator apps); window ±1 tolerates clock drift.
@Injectable()
export class TotpService {
  private readonly issuer = 'CVC';

  generateSecretBase32(): string {
    return new Secret({ size: 20 }).base32;
  }

  forUser(email: string, secretBase32: string): TOTP {
    return new TOTP({
      issuer: this.issuer,
      label: email,
      algorithm: 'SHA1',
      digits: AUTH_LIMITS.totpDigits,
      period: AUTH_LIMITS.totpPeriodSec,
      secret: Secret.fromBase32(secretBase32),
    });
  }

  otpauthUri(email: string, secretBase32: string): string {
    return this.forUser(email, secretBase32).toString();
  }

  // Returns true when the code is valid for the current (or adjacent) window.
  verify(email: string, secretBase32: string, token: string): boolean {
    if (!/^\d{6}$/.test(token)) return false;
    const delta = this.forUser(email, secretBase32).validate({
      token,
      window: AUTH_LIMITS.totpWindow,
    });
    return delta !== null;
  }
}
