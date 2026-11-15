import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

// KYC document types (P2.12).
export const KYC_DOC_TYPES = ['CCCD_FRONT', 'CCCD_BACK', 'BUSINESS_REG', 'AUTHORIZATION'] as const;
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
