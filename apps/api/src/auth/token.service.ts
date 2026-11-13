import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { parseTtlToSeconds } from '../common/utils/ttl';

export interface AccessPayload {
  sub: string;
  email: string;
  sid: string;
}

export interface RefreshPayload {
  sid: string;
  fam: string;
  jti: string;
}

// Signs/verifies JWTs and hashes tokens for storage. Access tokens are short
// lived; refresh tokens rotate per session family (P2.4).
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  accessToken(payload: AccessPayload): string {
    return this.jwt.sign(payload, {
      secret: this.config.get<string>('jwt.accessSecret'),
      expiresIn: this.config.get<string>('jwt.accessTtl', '15m'),
    });
  }

  createRefreshToken(sid: string, familyId: string): string {
    return this.jwt.sign({ sid, fam: familyId, jti: randomUUID() } satisfies RefreshPayload, {
      secret: this.config.get<string>('jwt.refreshSecret'),
      expiresIn: this.config.get<string>('jwt.refreshTtl', '30d'),
    });
  }

  verifyRefreshToken(token: string): RefreshPayload {
    return this.jwt.verify<RefreshPayload>(token, {
      secret: this.config.get<string>('jwt.refreshSecret'),
    });
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  refreshTtlSeconds(): number {
    return parseTtlToSeconds(this.config.get<string>('jwt.refreshTtl', '30d'));
  }
}
