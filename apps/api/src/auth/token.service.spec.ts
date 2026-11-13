import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { parseTtlToSeconds } from '../common/utils/ttl';
import { TokenService } from './token.service';

describe('TokenService', () => {
  const accessSecret = 'test-access-secret-value-32-chars!';
  const refreshSecret = 'test-refresh-secret-value-32chars';
  let service: TokenService;

  beforeAll(async () => {
    const config = new ConfigService({
      jwt: {
        accessSecret,
        refreshSecret,
        accessTtl: '15m',
        refreshTtl: '30d',
      },
    });
    const jwtService = new JwtService({ secret: accessSecret, signOptions: { expiresIn: '15m' } });
    service = new TokenService(jwtService, config);
  });

  it('signs and verifies an access token payload', () => {
    const token = service.accessToken({ sub: 'user-1', email: 'a@b.c', sid: 'session-1' });
    const decoded = (service as unknown as { jwt: JwtService }).jwt.verify<{
      sub: string;
      email: string;
      sid: string;
    }>(token, { secret: accessSecret });
    expect(decoded.sub).toBe('user-1');
    expect(decoded.sid).toBe('session-1');
  });

  it('creates a refresh token with session/family and verifies it', () => {
    const token = service.createRefreshToken('session-1', 'family-1');
    const payload = service.verifyRefreshToken(token);
    expect(payload.sid).toBe('session-1');
    expect(payload.fam).toBe('family-1');
    expect(payload.jti).toEqual(expect.any(String));
  });

  it('rejects refresh tokens signed with the wrong secret', () => {
    const token = service.createRefreshToken('session-1', 'family-1');
    const other = new TokenService(
      new JwtService({ secret: 'another-secret-32-chars-long-value!!' }),
      new ConfigService({
        jwt: {
          refreshSecret: 'another-secret-32-chars-long-value!!',
          accessTtl: '15m',
          refreshTtl: '30d',
          accessSecret: 'x',
        },
      }),
    );
    expect(() => other.verifyRefreshToken(token)).toThrow();
  });

  it('hashes tokens deterministically (sha256)', () => {
    expect(service.hashToken('abc')).toBe(service.hashToken('abc'));
    expect(service.hashToken('abc')).toHaveLength(64);
    expect(service.hashToken('abc')).not.toBe(service.hashToken('abd'));
  });

  it('parses refresh TTL for session expiry', () => {
    expect(service.refreshTtlSeconds()).toBe(30 * 86400);
    expect(parseTtlToSeconds('15m')).toBe(900);
    expect(parseTtlToSeconds('3600')).toBe(3600);
  });
});
