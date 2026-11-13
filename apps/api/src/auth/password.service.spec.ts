import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AuthErrorCode } from './auth.constants';
import { BreachCheckService, sha1Hex } from './breach-check.service';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  let service: PasswordService;
  const breachCheck = { isBreached: jest.fn<Promise<boolean>, [string]>(), isEnabled: () => true };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      providers: [PasswordService, { provide: BreachCheckService, useValue: breachCheck }],
    }).compile();
    service = module.get(PasswordService);
  });

  describe('hash/verify (argon2id)', () => {
    it('hashes and verifies a correct password', async () => {
      const passwordHash = await service.hashPassword('Sup3r-Secret!');
      expect(passwordHash).toMatch(/^\$argon2id\$/);
      await expect(service.verifyPassword(passwordHash, 'Sup3r-Secret!')).resolves.toBe(true);
    });

    it('rejects a wrong password', async () => {
      const passwordHash = await service.hashPassword('Sup3r-Secret!');
      await expect(service.verifyPassword(passwordHash, 'wrong-password')).resolves.toBe(false);
    });

    it('returns false on malformed stored hash instead of crashing', async () => {
      await expect(service.verifyPassword('not-a-hash', 'Sup3r-Secret!')).resolves.toBe(false);
    });
  });

  describe('policy', () => {
    it('accepts a strong, non-breached password', async () => {
      breachCheck.isBreached.mockResolvedValue(false);
      await expect(service.assertPolicy('Sup3r-Secret!')).resolves.toBeUndefined();
      expect(breachCheck.isBreached).toHaveBeenCalledWith(sha1Hex('Sup3r-Secret!'));
    });

    it('rejects passwords shorter than 8 chars', async () => {
      const error = await service.assertPolicy('Sh0rt!').catch((e) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toMatchObject({ code: AuthErrorCode.PasswordPolicy });
      expect(breachCheck.isBreached).not.toHaveBeenCalled();
    });

    it('rejects passwords longer than 64 chars', async () => {
      const error = await service.assertPolicy('a'.repeat(65)).catch((e) => e);
      expect(error).toBeInstanceOf(BadRequestException);
    });

    it('rejects breached (commonly leaked) passwords', async () => {
      breachCheck.isBreached.mockResolvedValue(true);
      const error = await service.assertPolicy('password123').catch((e) => e);
      expect(error.getResponse()).toMatchObject({ code: AuthErrorCode.PasswordPolicy });
    });
  });
});
