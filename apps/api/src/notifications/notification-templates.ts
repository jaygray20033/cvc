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
  // P4.7/P4.8 — sourcing requests: new request to sales, assignment, SLA.
  'sourcing.request_created': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'Yêu cầu tìm nguồn mới',
      body: `${String(data.requestNo ?? '')} — ${String(data.title ?? '')} (SL: ${
        data.quantity ?? '—'
      }). Cần tiếp nhận và phân công xử lý.`,
    }),
  },
  'sourcing.request_assigned': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'Bạn được phân công yêu cầu tìm nguồn',
      body: `${String(data.requestNo ?? '')} — ${String(data.title ?? '')}${
        data.slaDueAt
          ? ` (hạn xử lý: ${new Date(String(data.slaDueAt)).toLocaleString('vi-VN')})`
          : ''
      }.`,
    }),
  },
  'sourcing.sla_overdue': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'Yêu cầu tìm nguồn quá hạn xử lý',
      body: `${String(data.requestNo ?? '')} — ${String(data.title ?? '')} đã quá hạn SLA. Vui lòng xử lý ngay.`,
    }),
  },
  // P4.9/P4.10 — supplier invites, incoming quotes, selection outcome.
  'sourcing.request_invited': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'Bạn được mời báo giá',
      body: `${String(data.requestNo ?? '')} — ${String(data.title ?? '')}. Vào mục yêu cầu để gửi báo giá.`,
    }),
  },
  'sourcing.quote_received': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'Báo giá mới cho yêu cầu của bạn',
      body: `${String(data.requestNo ?? '')} — ${String(data.title ?? '')}: ${String(
        data.unitPrice ?? '',
      )} ${String(data.currency ?? '')}.`,
    }),
  },
  'sourcing.quote_selected': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'Báo giá của bạn được chọn',
      body: `${String(data.requestNo ?? '')} — ${String(data.title ?? '')}. Đơn hàng ${
        data.orderNo ? String(data.orderNo) : 'đã được tạo'
      }.`,
    }),
  },
  'sourcing.quote_rejected': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'Báo giá không được chọn',
      body: `${String(data.requestNo ?? '')} — ${String(data.title ?? '')}. Cảm ơn bạn đã gửi báo giá.`,
    }),
  },
  // P4.11 — concierge rooms. Copy never names the supplier/buyer.
  'sourcing.room_opened': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'Phòng thương lượng đã mở',
      body: `Yêu cầu ${String(data.requestNo ?? '')} đã được kết nối với nhà cung cấp. Vào Deal Room để trao đổi.`,
    }),
  },
  'sourcing.room_ready': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'CVC đã mở phòng thương lượng',
      body: `Yêu cầu ${String(data.requestNo ?? '')} — ${String(
        data.title ?? '',
      )}. Tiếp tục trải nghiệm trong Deal Room.`,
    }),
  },
  // P4.15 — offers and terms. Copy stays generic (no supplier/cost leak).
  'deal.offer_received': {
    channels: ['in_app'],
    render: (data) => ({
      title: data.counter ? 'Đối đề nghị giá mới' : 'Đề nghị giá mới',
      body: `Đơn giá ${String(data.unitPrice ?? '')} ${String(data.currency ?? '')} × ${String(
        data.quantity ?? '',
      )}. Vào phòng thương lượng để phản hồi.`,
    }),
  },
  'deal.offer_accepted': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'Đề nghị giá đã được chấp nhận',
      body: `Đơn giá ${String(data.unitPrice ?? '')} ${String(data.currency ?? '')} đã được chấp nhận. Tổng tạm tính ${String(
        data.totalAmount ?? '',
      )} ${String(data.currency ?? '')}.`,
    }),
  },
  'deal.offer_rejected': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'Đề nghị giá bị từ chối',
      body: `Đơn giá ${String(data.unitPrice ?? '')} ${String(data.currency ?? '')} không được chấp nhận. Bạn có thể đối đề nghị.`,
    }),
  },
  'deal.terms_confirm_needed': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'Điều khoản đang chờ bạn xác nhận',
      body: `Bên kia đã xác nhận điều khoản phiên bản ${String(
        data.version ?? '',
      )}. Vào phòng thương lượng để xác nhận.`,
    }),
  },
  'deal.terms_locked': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'Điều khoản đã được khóa',
      body: `Hai bên đã xác nhận điều khoản phiên bản ${String(
        data.version ?? '',
      )}. Đơn chuyển sang bước lấy mẫu.`,
    }),
  },
};
