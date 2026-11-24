import { z } from 'zod';

// Runtime settings (P2.22). Each key has a zod schema validated on write so
// an admin typo cannot break boot. Defaults keep the system working before
// any row exists. Add new keys here; DB rows override defaults.
export interface SettingDefinition {
  schema: z.ZodTypeAny;
  defaultValue: unknown;
  description: string;
}

export const SETTING_DEFINITIONS: Record<string, SettingDefinition> = {
  'kyc.slaHours': {
    schema: z.number().int().min(1).max(720),
    defaultValue: 48,
    description: 'SLA duyệt KYC (giờ) hiển thị cho người dùng và cron sweep.',
  },
  'files.maxImageMb': {
    schema: z.number().int().min(1).max(100),
    defaultValue: 5,
    description: 'Dung lượng tối đa (MB) cho tệp ảnh.',
  },
  'files.maxPdfMb': {
    schema: z.number().int().min(1).max(100),
    defaultValue: 10,
    description: 'Dung lượng tối đa (MB) cho tệp PDF.',
  },
  'notifications.emailEnabled': {
    schema: z.boolean(),
    defaultValue: true,
    description: 'Bật/tắt toàn cục kênh email của engine thông báo.',
  },
  'search.minQueryLength': {
    schema: z.number().int().min(2).max(10),
    defaultValue: 2,
    description: 'Độ dài tối thiểu của truy vấn tìm kiếm.',
  },
  'translate.dailyLimit': {
    schema: z.number().int().min(0).max(100_000),
    defaultValue: 100,
    description: 'Số lượt dịch mới tối đa mỗi người dùng mỗi ngày (bản cache không tính).',
  },
  'samples.maxRevisionRounds': {
    schema: z.number().int().min(0).max(20),
    defaultValue: 2,
    description: 'Số vòng sửa mẫu tối đa trước khi khách phải duyệt hoặc từ chối.',
  },
  'payments.proofDueDays': {
    schema: z.number().int().min(1).max(60),
    defaultValue: 3,
    description: 'Số ngày khách phải nộp ảnh minh chứng thanh toán kể từ khi tạo yêu cầu.',
  },
  'payouts.dualApprovalThreshold': {
    schema: z.number().min(0),
    defaultValue: 50_000_000,
    description: 'Ngưỡng tiền (theo currency của payout) cần duyệt hai lớp trước khi chi NCC.',
  },
  'payouts.autoConfirmDays': {
    schema: z.number().int().min(1).max(90),
    defaultValue: 7,
    description: 'Số ngày sau khi chi mà NCC không xác nhận thì hệ thống tự xác nhận.',
  },
  'shipping.staleAfterDays': {
    schema: z.number().int().min(1).max(60),
    defaultValue: 5,
    description: 'Số ngày không cập nhật mốc vận chuyển trước khi nhắc NCC/sales.',
  },
};

export type SettingKey = keyof typeof SETTING_DEFINITIONS;
