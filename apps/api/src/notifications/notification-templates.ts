import { kycStatusHtml, kycStatusText } from '../common/mail/mail.templates';

// Notification templates (P2.18). Each event defines its channels and
// whether user opt-outs apply (security/money events are mandatory).
// New modules register their events here; unknown events fall back generic.
export interface RenderedNotification {
  title: string;
  body: string;
  emailSubject?: string;
  emailHtml?: string;
  emailText?: string;
}

export interface NotificationTemplate {
  channels: Array<'in_app' | 'email' | 'sms' | 'zns' | 'push'>;
  // Mandatory events ignore NotificationPreference opt-outs (P2.18 DoD).
  mandatory?: boolean;
  render(data: Record<string, unknown>): RenderedNotification;
}

export const NOTIFICATION_TEMPLATES: Record<string, NotificationTemplate> = {
  'kyc.status_changed': {
    channels: ['in_app', 'email'],
    render: (data) => {
      const status = String(data.status ?? 'PENDING');
      const reason = data.reason ? String(data.reason) : undefined;
      const titles: Record<string, string> = {
        APPROVED: 'Hồ sơ KYC của bạn đã được duyệt',
        NEED_MORE: 'CVC cần bổ sung giấy tờ KYC',
        REJECTED: 'Hồ sơ KYC của bạn chưa được duyệt',
        PENDING: 'Bạn vừa nộp hồ sơ KYC',
      };
      return {
        title: titles[status] ?? titles.PENDING,
        body: reason ? `Lý do: ${reason}` : 'Xem chi tiết trong hồ sơ KYC.',
        emailSubject: `CVC — Cập nhật hồ sơ KYC (${status})`,
        emailHtml: kycStatusHtml(status, reason),
        emailText: kycStatusText(status, reason),
      };
    },
  },
  // Security events are mandatory: always in-app + email regardless of prefs.
  'security.password_changed': {
    channels: ['in_app', 'email'],
    mandatory: true,
    render: () => ({
      title: 'Mật khẩu vừa được thay đổi',
      body: 'Nếu không phải bạn, hãy đặt lại mật khẩu ngay.',
      emailSubject: 'CVC — Mật khẩu đã được thay đổi',
      emailHtml:
        '<p>Mật khẩu tài khoản CVC của bạn vừa được thay đổi. Nếu không phải bạn, hãy đặt lại mật khẩu ngay.</p>',
      emailText:
        'Mật khẩu tài khoản CVC của bạn vừa được thay đổi. Nếu không phải bạn, hãy đặt lại mật khẩu ngay.',
    }),
  },
};
