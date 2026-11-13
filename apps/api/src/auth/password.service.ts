import { BadRequestException, Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

import { AuthErrorCode } from './auth.constants';
import { BreachCheckService, sha1Hex } from './breach-check.service';

// Argon2id password hashing (P2.1) + password policy (length, breach check).
const ARGON2_OPTIONS = {
  // OWASP-recommended settings for Argon2id.
  timeCost: 2,
  memoryCost: 19456, // 19 MiB
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  constructor(private readonly breachCheck: BreachCheckService) {}

  async hashPassword(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  async verifyPassword(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      // Malformed stored hash must never crash login.
      return false;
    }
  }

  // Throws AUTH_PASSWORD_POLICY when the password is too weak (length out of
  // bounds is enforced by the Zod schema; this adds the breach check).
  async assertPolicy(password: string): Promise<void> {
    if (password.length < 8 || password.length > 64) {
      throw new BadRequestException({
        code: AuthErrorCode.PasswordPolicy,
        message: 'Mật khẩu phải có độ dài từ 8 đến 64 ký tự.',
      });
    }
    if (await this.breachCheck.isBreached(sha1Hex(password))) {
      throw new BadRequestException({
        code: AuthErrorCode.PasswordPolicy,
        message: 'Mật khẩu này đã bị lộ trong các vụ rò rỉ phổ biến. Vui lòng chọn mật khẩu khác.',
      });
    }
  }
}
