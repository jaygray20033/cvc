import { detectMime } from './magic-bytes';

describe('magic bytes (P2.17)', () => {
  it('detects jpeg/png/webp/pdf by header', () => {
    expect(detectMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectMime(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png');
    expect(Buffer.from('RIFF____WEBPVP ').subarray(0, 12)).toBeDefined();
    expect(detectMime(Buffer.from('RIFF0000WEBPVP8 '))).toBe('image/webp');
    expect(detectMime(Buffer.from('%PDF-1.7'))).toBe('application/pdf');
  });

  it('rejects disguised content (text claiming to be an image)', () => {
    expect(detectMime(Buffer.from('hello world this is text'))).toBe('unknown');
  });
});
