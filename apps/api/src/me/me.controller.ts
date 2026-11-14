import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { type AccessPayload, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { SwitchRoleDto } from './me.dto';
import { MeService } from './me.service';

@ApiTags('me')
@Controller('me')
export class MeController {
  constructor(private readonly meService: MeService) {}

  @Roles()
  @Get()
  @ApiOperation({ summary: 'Hồ sơ tóm tắt: vai trò đang dùng và mọi vai trò của tài khoản' })
  me(@CurrentUser() user: AccessPayload) {
    return this.meService.getMe(user);
  }

  @Roles()
  @Post('active-role')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Chuyển vai trò đang dùng; cấp access token mới, không cần đăng nhập lại',
  })
  switchActiveRole(
    @CurrentUser() user: AccessPayload,
    @Body(new ZodValidationPipe(SwitchRoleDto.schema)) dto: SwitchRoleDto,
  ) {
    return this.meService.switchActiveRole(user, dto.role);
  }
}
