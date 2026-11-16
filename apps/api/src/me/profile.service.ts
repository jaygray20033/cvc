import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ErrorCode } from '../common/errors/error-codes';
import { assertOwned } from '../common/policies/ownership';
import { encryptAccountNo, holderNameMatches } from '../common/utils/validators';
import { PrismaService } from '../prisma/prisma.service';
import type { AddressInput, BankAccountInput, UpsertProfileInput } from './profile.dto';

// Profile / addresses / bank accounts (P2.11). Bank account numbers are
// AES-256-GCM encrypted at rest; API responses only ever carry the masked
// form (****1234) via explicit select lists.
@Injectable()
export class ProfileService {
  private readonly encryptionKey: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.encryptionKey = config.get<string>('encryption.key', '');
  }

  // ---- profile ----

  async getProfile(userId: string) {
    const profile = await this.prisma.profile.findUnique({ where: { userId } });
    return profile ?? null;
  }

  async upsertProfile(userId: string, input: UpsertProfileInput) {
    // MST must be globally unique across profiles when provided.
    if (input.taxId) {
      const taken = await this.prisma.profile.findFirst({
        where: { taxId: input.taxId, userId: { not: userId } },
        select: { id: true },
      });
      if (taken) {
        throw new ConflictException({
          code: ErrorCode.Conflict,
          message: 'MST này đã được dùng bởi hồ sơ khác.',
        });
      }
    }
    return this.prisma.profile.upsert({
      where: { userId },
      create: { ...input, userId },
      update: { ...input },
    });
  }

  // ---- addresses ----

  async listAddresses(userId: string) {
    return this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createAddress(userId: string, input: AddressInput) {
    return this.setDefaultAwareAddressCreate(userId, input);
  }

  async updateAddress(userId: string, addressId: string, input: Partial<AddressInput>) {
    const existing = await this.prisma.address.findUnique({ where: { id: addressId } });
    if (!existing) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Không tìm thấy địa chỉ.',
      });
    }
    assertOwned(userId, existing.userId, 'địa chỉ');

    return this.setDefaultAwareAddressUpdate(userId, addressId, input);
  }

  async deleteAddress(userId: string, addressId: string) {
    const existing = await this.prisma.address.findUnique({ where: { id: addressId } });
    if (!existing) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Không tìm thấy địa chỉ.',
      });
    }
    assertOwned(userId, existing.userId, 'địa chỉ');
    await this.prisma.address.delete({ where: { id: addressId } });
    return { message: 'Đã xoá địa chỉ.' };
  }

  private async setDefaultAwareAddressCreate(userId: string, input: AddressInput) {
    return this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      }
      return tx.address.create({ data: { ...input, userId } });
    });
  }

  private async setDefaultAwareAddressUpdate(
    userId: string,
    addressId: string,
    input: Partial<AddressInput>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      if (input.isDefault === true) {
        await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      }
      return tx.address.update({ where: { id: addressId }, data: input });
    });
  }

  // ---- bank accounts ----

  async listBankAccounts(userId: string) {
    // Only masked numbers ever leave the service (P2.11 DoD).
    return this.prisma.bankAccount.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        bankName: true,
        holderName: true,
        accountNoLast4: true,
        isDefault: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async createBankAccount(userId: string, input: BankAccountInput) {
    const profile = await this.prisma.profile.findUnique({ where: { userId } });
    const profileNames = [profile?.displayName, profile?.representativeName].filter(
      (n): n is string => Boolean(n),
    );
    if (!holderNameMatches(input.holderName, profileNames)) {
      throw new BadRequestException({
        code: ErrorCode.BadRequest,
        message: 'Tên chủ tài khoản phải trùng với tên trên hồ sơ.',
      });
    }

    const hash = createHash('sha256').update(input.accountNo, 'utf8').digest('hex');
    const duplicate = await this.prisma.bankAccount.findUnique({ where: { accountNoHash: hash } });
    if (duplicate) {
      throw new ConflictException({
        code: ErrorCode.Conflict,
        message: 'Số tài khoản này đã được đăng ký.',
      });
    }

    const accountNoEnc = encryptAccountNo(input.accountNo, this.encryptionKey);
    return this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.bankAccount.updateMany({ where: { userId }, data: { isDefault: false } });
      }
      return tx.bankAccount.create({
        data: {
          userId,
          bankName: input.bankName,
          holderName: input.holderName,
          accountNoEnc,
          accountNoLast4: input.accountNo.slice(-4),
          accountNoHash: hash,
          isDefault: input.isDefault ?? false,
        },
        select: this.bankSelect,
      });
    });
  }

  async updateBankAccount(userId: string, accountId: string, input: Partial<BankAccountInput>) {
    const existing = await this.prisma.bankAccount.findUnique({ where: { id: accountId } });
    if (!existing) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Không tìm thấy tài khoản ngân hàng.',
      });
    }
    assertOwned(userId, existing.userId ?? '', 'tài khoản ngân hàng');

    return this.prisma.$transaction(async (tx) => {
      if (input.isDefault === true) {
        await tx.bankAccount.updateMany({ where: { userId }, data: { isDefault: false } });
      }
      return tx.bankAccount.update({
        where: { id: accountId },
        // accountNo is immutable once created: change = delete + re-add.
        data: {
          bankName: input.bankName,
          holderName: input.holderName,
          isDefault: input.isDefault,
        },
        select: this.bankSelect,
      });
    });
  }

  async deleteBankAccount(userId: string, accountId: string) {
    const existing = await this.prisma.bankAccount.findUnique({ where: { id: accountId } });
    if (!existing) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Không tìm thấy tài khoản ngân hàng.',
      });
    }
    assertOwned(userId, existing.userId ?? '', 'tài khoản ngân hàng');
    await this.prisma.bankAccount.delete({ where: { id: accountId } });
    return { message: 'Đã xoá tài khoản ngân hàng.' };
  }

  private bankSelect = {
    id: true,
    bankName: true,
    holderName: true,
    accountNoLast4: true,
    isDefault: true,
    createdAt: true,
    updatedAt: true,
  } as const;
}
