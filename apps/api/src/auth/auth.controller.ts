import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { type AccessPayload, CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AUTH_LIMITS, readRequestMeta, type RequestMeta } from './auth.constants';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  LogoutDto,
  OtpRequestDto,
  OtpVerifyDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
  TotpDisableDto,
  TotpEnableDto,
  TotpVerifyDto,
  VerifyEmailDto,
} from './auth.dto';
import { AuthService } from './auth.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private meta(req: Request): RequestMeta {
    return readRequestMeta(req);
  }

  // ------------------------------------------------------- P2.1 email+password

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đăng ký tài khoản (gửi email xác minh)' })
  register(@Body(new ZodValidationPipe(RegisterDto.schema)) dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xác minh email bằng token một lần' })
  verifyEmail(@Body(new ZodValidationPipe(VerifyEmailDto.schema)) dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ...AUTH_LIMITS.throttleLogin } })
  @ApiOperation({ summary: 'Đăng nhập email + mật khẩu' })
  login(@Body(new ZodValidationPipe(LoginDto.schema)) dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, this.meta(req));
  }

  // ------------------------------------------------------------ P2.2 email OTP

  @Public()
  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ...AUTH_LIMITS.throttleOtp } })
  @ApiOperation({ summary: 'Yêu cầu mã OTP đăng nhập qua email (Gmail/SMTP)' })
  otpRequest(
    @Body(new ZodValidationPipe(OtpRequestDto.schema)) dto: OtpRequestDto,
    @Req() req: Request,
  ) {
    return this.auth.otpRequest(dto, this.meta(req));
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ...AUTH_LIMITS.throttleOtp } })
  @ApiOperation({ summary: 'Xác minh mã OTP để nhận phiên đăng nhập' })
  otpVerify(
    @Body(new ZodValidationPipe(OtpVerifyDto.schema)) dto: OtpVerifyDto,
    @Req() req: Request,
  ) {
    return this.auth.otpVerify(dto, this.meta(req));
  }

  // ------------------------------------------------------- P2.3 password flows

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ...AUTH_LIMITS.throttleForgot } })
  @ApiOperation({ summary: 'Yêu cầu đặt lại mật khẩu (không tiết lộ email tồn tại)' })
  forgotPassword(
    @Body(new ZodValidationPipe(ForgotPasswordDto.schema)) dto: ForgotPasswordDto,
    @Req() req: Request,
  ) {
    return this.auth.forgotPassword(dto, this.meta(req));
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đặt mật khẩu mới bằng token một lần; thu hồi mọi phiên' })
  resetPassword(@Body(new ZodValidationPipe(ResetPasswordDto.schema)) dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đổi mật khẩu khi đã đăng nhập; thu hồi mọi phiên' })
  changePassword(
    @CurrentUser() user: AccessPayload,
    @Body(new ZodValidationPipe(ChangePasswordDto.schema)) dto: ChangePasswordDto,
  ) {
    return this.auth.changePassword(user, dto);
  }

  // ------------------------------------------------------------- 2FA (P2.5)

  @Post('2fa/setup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bắt đầu thiết lập TOTP: trả về secret + URI để quét QR' })
  setup2fa(@CurrentUser() user: AccessPayload) {
    return this.auth.setup2fa(user);
  }

  @Post('2fa/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Kích hoạt 2FA bằng mã 6 số; trả về mã dự phòng một lần' })
  enable2fa(
    @CurrentUser() user: AccessPayload,
    @Body(new ZodValidationPipe(TotpEnableDto.schema)) dto: TotpEnableDto,
  ) {
    return this.auth.enable2fa(user, dto);
  }

  @Post('2fa/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Tắt 2FA (yêu cầu mật khẩu); xoá mọi mã dự phòng' })
  disable2fa(
    @CurrentUser() user: AccessPayload,
    @Body(new ZodValidationPipe(TotpDisableDto.schema)) dto: TotpDisableDto,
  ) {
    return this.auth.disable2fa(user, dto);
  }

  @Public()
  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đổi pendingToken + mã TOTP/mã dự phòng lấy phiên đăng nhập' })
  verify2fa(
    @Body(new ZodValidationPipe(TotpVerifyDto.schema)) dto: TotpVerifyDto,
    @Req() req: Request,
  ) {
    return this.auth.verify2fa(dto, this.meta(req));
  }

  // -------------------------------------------------------- P2.4 JWT & sessions

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xoay vòng refresh token; phát hiện tái sử dụng → thu hồi chuỗi' })
  refresh(@Body(new ZodValidationPipe(RefreshDto.schema)) dto: RefreshDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, this.meta(req));
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đăng xuất phiên hiện tại' })
  logout(
    @CurrentUser() user: AccessPayload,
    @Body(new ZodValidationPipe(LogoutDto.schema)) dto: LogoutDto,
  ) {
    return this.auth.logout(user, dto);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Danh sách phiên đăng nhập đang hoạt động' })
  sessions(@CurrentUser() user: AccessPayload) {
    return this.auth.listSessions(user);
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Thu hồi một phiên đăng nhập' })
  revokeSession(@CurrentUser() user: AccessPayload, @Param('id') id: string) {
    return this.auth.revokeSession(user, id);
  }
}
