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
  // P4.16 — order state machine.
  'order.status_changed': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'Đơn hàng đã chuyển bước',
      body: `Đơn ${String(data.orderNo ?? '')} chuyển từ ${String(data.from ?? '')} sang ${String(
        data.to ?? '',
      )}${data.reason ? ` — ${String(data.reason)}` : ''}.`,
    }),
  },
  // P4.17 — sample requests, shipping milestones and decisions.
  'sample.requested': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'Yêu cầu mẫu mới',
      body: `Đơn ${String(data.orderNo ?? '')} yêu cầu mẫu ${String(
        data.sampleNo ?? '',
      )}. Vui lòng chuẩn bị và cập nhật ảnh mẫu.`,
    }),
  },
  'sample.uploaded': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'Nhà cung cấp đã cập nhật mẫu',
      body: `Mẫu ${String(data.sampleNo ?? '')} (vòng ${String(
        data.round ?? '',
      )}) đã có ảnh mới. Vào đơn để kiểm tra.`,
    }),
  },
  'sample.sent': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'Mẫu đã được gửi',
      body: `Mẫu ${String(data.sampleNo ?? '')} đã gửi qua ${String(data.carrier ?? '')} · ${String(
        data.trackingNo ?? '',
      )}.`,
    }),
  },
  'sample.delivered': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'Mẫu đã tới nơi',
      body: `Mẫu ${String(data.sampleNo ?? '')} đã được đánh dấu giao. Vui lòng xác nhận nhận mẫu.`,
    }),
  },
  'sample.received': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'Khách đã nhận mẫu',
      body: `Mẫu ${String(data.sampleNo ?? '')} đã được khách xác nhận nhận.`,
    }),
  },
  'sample.revision_requested': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'Khách yêu cầu sửa mẫu',
      body: `Mẫu ${String(data.sampleNo ?? '')} cần sửa (vòng ${String(
        data.round ?? '',
      )}): ${String(data.note ?? '')}`,
    }),
  },
  'sample.approved': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'Mẫu đã được duyệt',
      body: `Khách đã duyệt mẫu ${String(data.sampleNo ?? '')}. Đơn chuyển sang bước hợp đồng.`,
    }),
  },
  // P4.22 — claims. Copy never mentions supplier cost; it only references the
  // claim number, ordered/missing quantities and the refund amount.
  'claim.filed': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'Khiếu nại mới',
      body: `Đơn ${String(data.orderNo ?? '')} · ${String(data.claimNo ?? '')}: ${String(
        data.type ?? '',
      )}, giá trị ${String(data.amount ?? '')} ${String(data.currency ?? '')}.`,
    }),
  },
  'claim.proposed': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'CVC đã đề xuất phương án xử lý',
      body: `Khiếu nại ${String(data.claimNo ?? '')}: ${String(
        data.kind ?? '',
      )}${data.amount ? ` — ${String(data.amount)} ${String(data.currency ?? '')}` : ''}. Vào đơn để chọn phương án.`,
    }),
  },
  'claim.resolution_chosen': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'Khách đã chọn phương án khiếu nại',
      body: `Khiếu nại ${String(data.claimNo ?? '')}: ${String(data.choice ?? '')}.`,
    }),
  },
  'claim.topup_delivered': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'Hàng gửi bù đã tới nơi',
      body: `Khiếu nại ${String(data.claimNo ?? '')}: vui lòng xác nhận đã nhận ${String(
        data.missingQuantity ?? '',
      )} sản phẩm gửi bù.`,
    }),
  },
  'claim.topup_confirmed': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'Khách đã nhận hàng gửi bù',
      body: `Khiếu nại ${String(data.claimNo ?? '')} đã được khách xác nhận. CVC có thể kết luận.`,
    }),
  },
  'claim.return_sent': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'Khách đã gửi trả hàng',
      body: `Khiếu nại ${String(data.claimNo ?? '')} · ${String(data.carrier ?? '')} ${
        data.trackingNo ? `· ${String(data.trackingNo)}` : ''
      }.`,
    }),
  },
  'claim.return_received': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'CVC đã nhận hàng trả về',
      body: `Khiếu nại ${String(data.claimNo ?? '')} đang được xử lý hoàn tiền.`,
    }),
  },
  'claim.refund_executed': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'CVC đã hoàn tiền khiếu nại',
      body: `Khiếu nại ${String(data.claimNo ?? '')}: ${String(data.amount ?? '')} ${String(
        data.currency ?? '',
      )}. Vui lòng xác nhận đã nhận.`,
    }),
  },
  'claim.refund_confirmed': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'Khách đã nhận tiền hoàn',
      body: `Khiếu nại ${String(data.claimNo ?? '')} đã được khách xác nhận.`,
    }),
  },
  'claim.closed': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'Khiếu nại đã kết luận',
      body: `Khiếu nại ${String(data.claimNo ?? '')} đã đóng (${String(data.decision ?? '')}).`,
    }),
  },
  'claim.rejected': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'Khiếu nại bị từ chối',
      body: `Khiếu nại ${String(data.claimNo ?? '')} không được chấp nhận${
        data.reason ? `: ${String(data.reason)}` : ''
      }.`,
    }),
  },
  'claim.withdrawn': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'Khiếu nại đã được rút',
      body: `Khiếu nại ${String(data.claimNo ?? '')} đã được khách rút.`,
    }),
  },
  // P4.26 — withdrawals: request → approval → manual bank transfer.
  'withdrawal.requested': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'Yêu cầu rút tiền mới',
      body: `Yêu cầu ${String(data.withdrawalNo ?? '')} rút ${String(data.amount ?? '')} ${
        data.currency ?? ''
      } đang chờ duyệt. Nội dung chuyển khoản: ${String(data.referenceCode ?? '')}.`,
    }),
  },
  'withdrawal.approval_pending': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'Yêu cầu rút tiền cần duyệt lớp 2',
      body: `Yêu cầu ${String(data.withdrawalNo ?? '')} (${String(data.amount ?? '')} ${
        data.currency ?? ''
      }) đã được duyệt lớp 1, cần admin tài chính khác duyệt tiếp.`,
    }),
  },
  'withdrawal.approved': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'Yêu cầu rút tiền đã được duyệt',
      body: `Yêu cầu ${String(data.withdrawalNo ?? '')} rút ${String(data.amount ?? '')} ${
        data.currency ?? ''
      } đã được duyệt. CVC sẽ chuyển khoản thủ công và cập nhật minh chứng.`,
    }),
  },
  'withdrawal.rejected': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'Yêu cầu rút tiền bị từ chối',
      body: `Yêu cầu ${String(data.withdrawalNo ?? '')} bị từ chối${
        data.reason ? `: ${String(data.reason)}` : ''
      }. Số tiền đã được hoàn về ví khả dụng.`,
    }),
  },
  'withdrawal.paid': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'CVC đã chuyển tiền rút',
      body: `Yêu cầu ${String(data.withdrawalNo ?? '')} rút ${String(data.amount ?? '')} ${
        data.currency ?? ''
      } đã được chuyển khoản (mã giao dịch ${String(data.transactionRef ?? '')}).`,
    }),
  },
  'withdrawal.cancelled': {
    channels: ['in_app'],
    render: (data) => ({
      title: 'Yêu cầu rút tiền đã hủy',
      body: `Yêu cầu ${String(data.withdrawalNo ?? '')} đã bị hủy${
        data.reason ? `: ${String(data.reason)}` : ''
      }. Số tiền đã được hoàn về ví khả dụng.`,
    }),
  },
  // P4.25 — mandatory money-integrity alert for finance admins.
  'money.conservation_mismatch': {
    channels: ['in_app', 'email'],
    mandatory: true,
    render: (data) => ({
      title: 'Cảnh báo: kiểm tra bảo toàn tiền không khớp',
      body: `Lúc ${String(data.checkedAt ?? '')}, tổng nợ ${String(
        data.debitTotal ?? '',
      )} / tổng có ${String(data.creditTotal ?? '')}, ${String(
        data.walletMismatches ?? 0,
      )} ví lệch sổ cái. Rút tiền đang tạm khóa đến khi kiểm tra lại khớp.`,
      emailSubject: 'CVC — Cảnh báo bảo toàn tiền (khóa rút tiền tạm thời)',
      emailHtml:
        '<p>Kiểm tra bảo toàn tiền phát hiện chênh lệch. Hệ thống đã tạm khóa thao tác rút tiền và gửi cảnh báo cho admin tài chính. Vui lòng đối chiếu sổ cái và ví.</p>',
      emailText:
        'Kiểm tra bảo toàn tiền phát hiện chênh lệch. Hệ thống đã tạm khóa thao tác rút tiền. Vui lòng đối chiếu sổ cái và ví.',
    }),
  },
};
