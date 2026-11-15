import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

import { CCCD_RE } from '../common/utils/validators';

// KYC document types (P2.12/P2.14). PORTRAIT = selfie holding the CCCD.
export const KYC_DOC_TYPES = [
  'CCCD_FRONT',
  'CCCD_BACK',
  'PORTRAIT',
  'BUSINESS_REG',
  'AUTHORIZATION',
] as const;
export type KycDocTypeValue = (typeof KYC_DOC_TYPES)[number];

// Allowed file types for KYC documents. Images or signed PDF, max 5MB.
export const KYC_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export const KYC_MAX_SIZE_BYTES = 5 * 1024 * 1024;

export const KYC_STATUSES = ['PENDING', 'NEED_MORE', 'APPROVED', 'REJECTED'] as const;
export type KycStatusValue = (typeof KYC_STATUSES)[number];

// POST /me/kyc/documents/presign
export const presignUploadSchema = z.object({
  type: z.enum(KYC_DOC_TYPES),
  mime: z.enum(KYC_MIME_TYPES),
  sizeBytes: z.number().int().positive().max(KYC_MAX_SIZE_BYTES, 'Tệp tối đa 5MB'),
});
export type PresignUploadInput = z.infer<typeof presignUploadSchema>;

export class PresignUploadDto {
  static schema = presignUploadSchema;
  @ApiProperty({ enum: KYC_DOC_TYPES }) type!: PresignUploadInput['type'];
  @ApiProperty({ enum: KYC_MIME_TYPES, example: 'image/jpeg' }) mime!: PresignUploadInput['mime'];
  @ApiProperty({ example: 102400 }) sizeBytes!: number;
}

// POST /me/kyc/documents/:id/confirm takes no body.

// GET /admin/kyc?status=
export class ListKycQueryDto {
  static schema = z
    .object({
      status: z.enum(KYC_STATUSES).optional(),
    })
    .passthrough();
  @ApiProperty({ required: false, enum: KYC_STATUSES }) status?: KycStatusValue;
}

// POST /admin/kyc/:id/reject and /request-more — reason is mandatory.
export const reviewNoteSchema = z.object({
  reason: z.string().trim().min(5, 'Lý do tối thiểu 5 ký tự').max(500),
});
export type ReviewNoteInput = z.infer<typeof reviewNoteSchema>;

export class ReviewNoteDto {
  static schema = reviewNoteSchema;
  @ApiProperty({ example: 'Ảnh CCCD không rõ mặt' }) reason!: string;
}

// PUT /me/kyc/cccd — the user's CCCD number for identity matching (P2.14).
// Stored encrypted + as a salted hash; never returned in full to the client.
export const cccdSubmitSchema = z.object({
  cccdNumber: z.string().regex(CCCD_RE, 'Số CCCD phải gồm 12 chữ số'),
});
export type CccdSubmitInput = z.infer<typeof cccdSubmitSchema>;

export class CccdSubmitDto {
  static schema = cccdSubmitSchema;
  @ApiProperty({ example: '012345678901' }) cccdNumber!: string;
}

// POST /admin/kyc/:id/approve — the admin's eye-match checklist (P2.14).
// All five items must be confirmed before an approval goes through.
export const KYC_CHECKLIST_ITEMS = [
  'imageClear', // ảnh rõ nét
  'infoMatch', // thông tin khớp hồ sơ
  'faceMatch', // khuôn mặt khớp
  'docValid', // giấy tờ còn hạn
  'bankNameMatch', // tên chủ TK ngân hàng khớp
] as const;

export const approveSchema = z.object({
  checklist: z
    .object({
      imageClear: z.boolean(),
      infoMatch: z.boolean(),
      faceMatch: z.boolean(),
      docValid: z.boolean(),
      bankNameMatch: z.boolean(),
    })
    .refine(
      (c) => KYC_CHECKLIST_ITEMS.every((item) => c[item] === true),
      'Phải xác nhận đủ mọi mục trong checklist trước khi duyệt.',
    ),
});
export type KycChecklist = z.infer<typeof approveSchema>['checklist'];

export class ApproveDto {
  static schema = approveSchema;
  @ApiProperty({
    example: {
      imageClear: true,
      infoMatch: true,
      faceMatch: true,
      docValid: true,
      bankNameMatch: true,
    },
  })
  checklist!: KycChecklist;
}
