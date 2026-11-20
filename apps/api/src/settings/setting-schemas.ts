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
};

export type SettingKey = keyof typeof SETTING_DEFINITIONS;
