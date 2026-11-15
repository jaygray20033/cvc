import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

import { BANK_ACCOUNT_RE, PHONE_RE, TAX_ID_RE } from '../common/utils/validators';

// Org types (P2.11): individual, business household, company.
export const ORG_TYPES = ['PERSONAL', 'BUSINESS_HOUSEHOLD', 'COMPANY'] as const;
export type OrgTypeValue = (typeof ORG_TYPES)[number];

const trimmed = z.string().trim();

// PUT /me/profile: upsert — an empty body is not allowed.
export const upsertProfileSchema = z
  .object({
    orgType: z.enum(ORG_TYPES),
    displayName: trimmed.pipe(z.string().min(2).max(100)),
    taxId: trimmed
      .pipe(
        z
          .string()
          .regex(TAX_ID_RE, 'MST không đúng định dạng (10 số hoặc 10 số + -3 số chi nhánh)'),
      )
      .nullish(),
    businessRegNo: trimmed.pipe(z.string().max(20)).nullish(),
    representativeName: trimmed.pipe(z.string().max(100)).nullish(),
    address: trimmed.pipe(z.string().max(255)).nullish(),
  })
  .refine((v) => v.orgType === 'PERSONAL' || Boolean(v.taxId && v.businessRegNo), {
    message: 'Hộ kinh doanh/doanh nghiệp phải có MST và số ĐKKD.',
  });
export type UpsertProfileInput = z.infer<typeof upsertProfileSchema>;

export class UpsertProfileDto {
  static schema = upsertProfileSchema;
  @ApiProperty({ enum: ORG_TYPES, example: 'PERSONAL' }) orgType!: OrgTypeValue;
  @ApiProperty({ example: 'Nguyễn Văn A' }) displayName!: string;
  @ApiProperty({ required: false, example: '0123456789' }) taxId?: string;
  @ApiProperty({ required: false }) businessRegNo?: string;
  @ApiProperty({ required: false }) representativeName?: string;
  @ApiProperty({ required: false }) address?: string;
}

// POST /me/addresses and PUT /me/addresses/:id.
export const addressSchema = z.object({
  label: trimmed.pipe(z.string().max(50)).nullish(),
  receiverName: trimmed.pipe(z.string().min(2).max(100)),
  phone: trimmed.pipe(z.string().regex(PHONE_RE, 'SĐT không đúng định dạng Việt Nam')),
  city: trimmed.pipe(z.string().min(1).max(100)),
  district: trimmed.pipe(z.string().min(1).max(100)),
  ward: trimmed.pipe(z.string().min(1).max(100)),
  line: trimmed.pipe(z.string().min(1).max(255)),
  isDefault: z.boolean().optional(),
});
export type AddressInput = z.infer<typeof addressSchema>;

export class AddressDto {
  static schema = addressSchema;
  @ApiProperty({ required: false }) label?: string;
  @ApiProperty({ example: 'Nguyễn Văn A' }) receiverName!: string;
  @ApiProperty({ example: '0912345678' }) phone!: string;
  @ApiProperty({ example: 'Hà Nội' }) city!: string;
  @ApiProperty({ example: 'Cầu Giấy' }) district!: string;
  @ApiProperty({ example: 'Dịch Vọng' }) ward!: string;
  @ApiProperty({ example: 'Số 1 Xuân Thủy' }) line!: string;
  @ApiProperty({ required: false }) isDefault?: boolean;
}

// POST /me/bank-accounts and PUT /me/bank-accounts/:id.
export const bankAccountSchema = z.object({
  bankName: trimmed.pipe(z.string().min(2).max(100)),
  // Must match the profile display/representative name; checked in service.
  holderName: trimmed.pipe(z.string().min(2).max(100)),
  accountNo: trimmed.pipe(z.string().regex(BANK_ACCOUNT_RE, 'Số tài khoản gồm 6-19 chữ số')),
  isDefault: z.boolean().optional(),
});
export type BankAccountInput = z.infer<typeof bankAccountSchema>;

export class BankAccountDto {
  static schema = bankAccountSchema;
  @ApiProperty({ example: 'Vietcombank' }) bankName!: string;
  @ApiProperty({ example: 'Nguyễn Văn A' }) holderName!: string;
  @ApiProperty({ example: '1234567890' }) accountNo!: string;
  @ApiProperty({ required: false }) isDefault?: boolean;
}
