import { z } from 'zod';

// Purposes gate which file types are allowed (extend as modules land).
export const FILE_PURPOSES = ['kyc', 'payment_proof', 'shipping_proof', 'general'] as const;
export type FilePurpose = (typeof FILE_PURPOSES)[number];

export const FILE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

// Size limits per type (P2.17 defaults; overridden at runtime by the
// settings keys files.maxImageMb / files.maxPdfMb since P2.22).
export const SIZE_LIMITS: Record<string, number> = {
  'image/jpeg': 5 * 1024 * 1024,
  'image/png': 5 * 1024 * 1024,
  'image/webp': 5 * 1024 * 1024,
  'application/pdf': 10 * 1024 * 1024,
};

// True when the declared MIME is an image kind (drives the MB setting).
export function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

export const presignFileSchema = z.object({
  purpose: z.enum(FILE_PURPOSES).default('general'),
  mime: z.enum(FILE_MIME_TYPES),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024),
});
export type PresignFileInput = z.infer<typeof presignFileSchema>;

export class PresignFileDto {
  static schema = presignFileSchema;
  purpose!: PresignFileInput['purpose'];
  mime!: PresignFileInput['mime'];
  sizeBytes!: number;
}
