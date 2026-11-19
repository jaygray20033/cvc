import { sanitizeMessageBody } from './messages.sanitize';

describe('sanitizeMessageBody (P4.13 DoD)', () => {
  it('neutralises script and event-handler payloads', () => {
    const body = sanitizeMessageBody('<script>alert(1)</script><img src=x onerror=alert(1)>');
    expect(body).not.toContain('<script');
    expect(body).not.toContain('<img');
    expect(body).toContain('&lt;script&gt;');
  });

  it('escapes quotes and ampersands, strips control characters', () => {
    const body = sanitizeMessageBody('Tom & "Jerry"\u0007 <b>bold</b>');
    expect(body).toBe('Tom &amp; &quot;Jerry&quot; &lt;b&gt;bold&lt;/b&gt;');
  });

  it('caps the stored body at 2000 characters', () => {
    expect(sanitizeMessageBody('a'.repeat(2500))).toHaveLength(2000);
  });
});
