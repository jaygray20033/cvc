import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { type AccessPayload, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AddressDto, BankAccountDto, UpsertProfileDto } from './profile.dto';
import { ProfileService } from './profile.service';

@ApiTags('me')
@Controller('me')
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  // ---- profile ----

  @Roles()
  @Get('profile')
  @ApiOperation({ summary: 'Xem hồ sơ cá nhân/hộ kinh doanh/doanh nghiệp' })
  getProfile(@CurrentUser() user: AccessPayload) {
    return this.profile.getProfile(user.sub);
  }

  @Roles()
  @Put('profile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Tạo/cập nhật hồ sơ (validate MST, SĐT, ĐKKD)' })
  upsertProfile(
    @CurrentUser() user: AccessPayload,
    @Body(new ZodValidationPipe(UpsertProfileDto.schema)) dto: UpsertProfileDto,
  ) {
    return this.profile.upsertProfile(user.sub, dto);
  }

  // ---- addresses ----

  @Roles()
  @Get('addresses')
  @ApiOperation({ summary: 'Danh sách địa chỉ giao nhận' })
  listAddresses(@CurrentUser() user: AccessPayload) {
    return this.profile.listAddresses(user.sub);
  }

  @Roles()
  @Post('addresses')
  @ApiOperation({ summary: 'Thêm địa chỉ giao nhận' })
  createAddress(
    @CurrentUser() user: AccessPayload,
    @Body(new ZodValidationPipe(AddressDto.schema)) dto: AddressDto,
  ) {
    return this.profile.createAddress(user.sub, dto);
  }

  @Roles()
  @Put('addresses/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cập nhật địa chỉ' })
  updateAddress(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AddressDto.schema.partial())) dto: AddressDto,
  ) {
    return this.profile.updateAddress(user.sub, id, dto);
  }

  @Roles()
  @Delete('addresses/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xoá địa chỉ' })
  deleteAddress(@CurrentUser() user: AccessPayload, @Param('id') id: string) {
    return this.profile.deleteAddress(user.sub, id);
  }

  // ---- bank accounts ----

  @Roles()
  @Get('bank-accounts')
  @ApiOperation({ summary: 'Danh sách tài khoản ngân hàng (số TK che ****1234)' })
  listBankAccounts(@CurrentUser() user: AccessPayload) {
    return this.profile.listBankAccounts(user.sub);
  }

  @Roles()
  @Post('bank-accounts')
  @ApiOperation({ summary: 'Thêm tài khoản ngân hàng (tên chủ TK phải khớp hồ sơ)' })
  createBankAccount(
    @CurrentUser() user: AccessPayload,
    @Body(new ZodValidationPipe(BankAccountDto.schema)) dto: BankAccountDto,
  ) {
    return this.profile.createBankAccount(user.sub, dto);
  }

  @Roles()
  @Put('bank-accounts/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cập nhật thông tin tài khoản (số TK không sửa được)' })
  updateBankAccount(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(BankAccountDto.schema.partial())) dto: BankAccountDto,
  ) {
    return this.profile.updateBankAccount(user.sub, id, dto);
  }

  @Roles()
  @Delete('bank-accounts/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xoá tài khoản ngân hàng' })
  deleteBankAccount(@CurrentUser() user: AccessPayload, @Param('id') id: string) {
    return this.profile.deleteBankAccount(user.sub, id);
  }
}
