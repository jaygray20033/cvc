import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

import { AUTH_LIMITS } from './auth.constants';

// Validation at the boundary (Zod) + Swagger DTO classes for the same shapes.
export const emailSchema = z.string().trim().toLowerCase().email().max(191);
export const passwordSchema = z
  .string()
  .min(8, 'Mật khẩu tối thiểu 8 ký tự.')
  .max(64, 'Mật khẩu tối đa 64 ký tự.');

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  phone: z
    .string()
    .regex(/^\+[0-9]{8,15}$/, 'SĐT định dạng +84xxxxxxxxx')
    .optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Vui lòng nhập mật khẩu.').max(64),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(32).max(128),
});

export const otpRequestSchema = z.object({
  email: emailSchema,
});

export const otpVerifySchema = z.object({
  email: emailSchema,
  code: z.string().regex(new RegExp(`^[0-9]{${AUTH_LIMITS.otpLength}}$`), 'Mã OTP gồm 6 chữ số.'),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(32).max(128),
  newPassword: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Vui lòng nhập mật khẩu hiện tại.').max(64),
  newPassword: passwordSchema,
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(20).max(4096),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(20).max(4096).optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type OtpRequestInput = z.infer<typeof otpRequestSchema>;
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type LogoutInput = z.infer<typeof logoutSchema>;

export class RegisterDto {
  static schema = registerSchema;
  @ApiProperty({ example: 'user@example.com' }) email!: string;
  @ApiProperty({ example: 'my-strong-pass' }) password!: string;
  @ApiProperty({ required: false, example: '+84901234567' }) phone?: string;
}

export class LoginDto {
  static schema = loginSchema;
  @ApiProperty({ example: 'user@example.com' }) email!: string;
  @ApiProperty() password!: string;
}

export class VerifyEmailDto {
  static schema = verifyEmailSchema;
  @ApiProperty() token!: string;
}

export class OtpRequestDto {
  static schema = otpRequestSchema;
  @ApiProperty({ example: 'user@example.com' }) email!: string;
}

export class OtpVerifyDto {
  static schema = otpVerifySchema;
  @ApiProperty({ example: 'user@example.com' }) email!: string;
  @ApiProperty({ example: '123456' }) code!: string;
}

export class ForgotPasswordDto {
  static schema = forgotPasswordSchema;
  @ApiProperty({ example: 'user@example.com' }) email!: string;
}

export class ResetPasswordDto {
  static schema = resetPasswordSchema;
  @ApiProperty() token!: string;
  @ApiProperty() newPassword!: string;
}

export class ChangePasswordDto {
  static schema = changePasswordSchema;
  @ApiProperty() currentPassword!: string;
  @ApiProperty() newPassword!: string;
}

export class RefreshDto {
  static schema = refreshSchema;
  @ApiProperty() refreshToken!: string;
}

export class LogoutDto {
  static schema = logoutSchema;
  @ApiProperty({ required: false }) refreshToken?: string;
}
