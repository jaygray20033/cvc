// Plain-text/HTML builders for auth emails (Vietnamese user-facing copy).
// Kept as pure functions so they are trivial to test; real i18n templates
// land with the notification engine (P2.18).

export function verifyEmailHtml(verifyUrl: string, ttlHours: number): string {
  return [
    '<p>Xin chào,</p>',
    `<p>Bạn vừa đăng ký tài khoản tại CVC. Nhấn vào đường dẫn dưới đây để xác minh email (hạn ${ttlHours} giờ):</p>`,
    `<p><a href="${verifyUrl}">Xác minh email</a></p>`,
    `<p>Nếu nút không hoạt động, mở đường dẫn sau: <code>${verifyUrl}</code></p>`,
    '<p>Nếu bạn không đăng ký tài khoản, hãy bỏ qua email này.</p>',
    '<p>Trân trọng,<br/>CVC</p>',
  ].join('\n');
}

export function verifyEmailText(verifyUrl: string, ttlHours: number): string {
  return `Bạn vừa đăng ký tài khoản tại CVC. Mở đường dẫn sau để xác minh email (hạn ${ttlHours} giờ): ${verifyUrl}\nNếu bạn không đăng ký, hãy bỏ qua email này.`;
}

export function otpHtml(code: string, minutes: number): string {
  return [
    '<p>Xin chào,</p>',
    `<p>Mã OTP đăng nhập CVC của bạn là:</p>`,
    `<p style="font-size:24px;letter-spacing:4px"><strong>${code}</strong></p>`,
    `<p>Mã có hiệu lực ${minutes} phút. Không chia sẻ mã này với bất kỳ ai.</p>`,
    '<p>Nếu bạn không yêu cầu mã, hãy bỏ qua email này.</p>',
    '<p>Trân trọng,<br/>CVC</p>',
  ].join('\n');
}

export function otpText(code: string, minutes: number): string {
  return `Mã OTP đăng nhập CVC của bạn là ${code} (hạn ${minutes} phút). Không chia sẻ mã này với bất kỳ ai.`;
}

export function resetPasswordHtml(resetUrl: string, ttlMinutes: number): string {
  return [
    '<p>Xin chào,</p>',
    `<p>Bạn (hoặc ai đó) vừa yêu cầu đặt lại mật khẩu tài khoản CVC. Mở đường dẫn dưới đây để đặt mật khẩu mới (hạn ${ttlMinutes} phút):</p>`,
    `<p><a href="${resetUrl}">Đặt lại mật khẩu</a></p>`,
    `<p>Nếu nút không hoạt động, mở đường dẫn sau: <code>${resetUrl}</code></p>`,
    '<p>Nếu bạn không yêu cầu, hãy bỏ qua email này — mật khẩu hiện tại vẫn còn hiệu lực.</p>',
    '<p>Trân trọng,<br/>CVC</p>',
  ].join('\n');
}

export function resetPasswordText(resetUrl: string, ttlMinutes: number): string {
  return `Bạn (hoặc ai đó) vừa yêu cầu đặt lại mật khẩu tài khoản CVC. Mở đường dẫn sau để đặt mật khẩu mới (hạn ${ttlMinutes} phút): ${resetUrl}\nNếu bạn không yêu cầu, hãy bỏ qua email này.`;
}

export function passwordChangedHtml(changedAt: string): string {
  return [
    '<p>Xin chào,</p>',
    `<p>Mật khẩu tài khoản CVC của bạn vừa được thay đổi lúc ${changedAt}. Tất cả phiên đăng nhập đã bị đăng xuất.</p>`,
    '<p>Nếu không phải bạn thay đổi, hãy đặt lại mật khẩu ngay và liên hệ bộ phận hỗ trợ.</p>',
    '<p>Trân trọng,<br/>CVC</p>',
  ].join('\n');
}

export function passwordChangedText(changedAt: string): string {
  return `Mật khẩu tài khoản CVC của bạn vừa được thay đổi lúc ${changedAt}. Tất cả phiên đăng nhập đã bị đăng xuất. Nếu không phải bạn thay đổi, hãy đặt lại mật khẩu ngay và liên hệ bộ phận hỗ trợ.`;
}
