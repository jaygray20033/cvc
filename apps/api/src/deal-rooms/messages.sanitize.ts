// P4.13 — chat bodies are plain text. Escape HTML entities before storing so
// a payload like <script>alert(1)</script> can never execute when the web app
// renders it (defence in depth: the client also renders as text, not HTML).
const MAX_BODY = 2000;

function stripControlChars(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    // Keep tab/newline/carriage return; drop the rest of C0 and DEL.
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) {
      out += char;
    }
  }
  return out;
}

export function sanitizeMessageBody(raw: string): string {
  const escaped = stripControlChars(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  return escaped.slice(0, MAX_BODY);
}
