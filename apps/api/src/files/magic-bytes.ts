// Real MIME detection from magic bytes (P2.17). Only the declared types the
// file service accepts are recognized here; anything else is 'unknown'.

export type DetectedMime =
  'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf' | 'unknown';

export function detectMime(bytes: Buffer): DetectedMime {
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  // PNG: 89 50 4E 47
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png';
  }
  // WEBP: RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  // PDF: %PDF
  if (bytes.subarray(0, 4).toString('ascii') === '%PDF') {
    return 'application/pdf';
  }
  return 'unknown';
}
