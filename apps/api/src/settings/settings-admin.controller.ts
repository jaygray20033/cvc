import { Role } from '@cvc/shared';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { AdminGroups } from '../common/decorators/admin-groups.decorator';
import { type AccessPayload, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { SystemSettingsService } from './system-settings.service';

const putSettingSchema = z.object({
  value: z.unknown(),
});
class PutSettingDto {
  static schema = putSettingSchema;
  value!: unknown;
}

// Admin settings API (P2.22). Reads for every admin; writes only admin_super
// (permissions.md: "cấu hình hệ thống: chỉ admin_super").
@ApiTags('admin')
@Controller('admin/system-settings')
@Roles(Role.Admin)
@AdminGroups('admin_super', 'admin_ops', 'admin_finance', 'admin_support')
export class SettingsAdminController {
  constructor(private readonly settings: SystemSettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách cấu hình hệ thống (mặc định + giá trị đã ghi)' })
  list() {
    return this.settings.list();
  }

  @Get(':key')
  @ApiOperation({ summary: 'Xem một cấu hình' })
  async get(@Param('key') key: string) {
    return { key, value: await this.settings.get(key) };
  }

  @Get(':key/history')
  @ApiOperation({ summary: 'Lịch sử thay đổi cấu hình (từ audit log)' })
  history(@Param('key') key: string) {
    return this.settings.history(key);
  }

  @Put(':key')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cập nhật cấu hình (chỉ admin_super)' })
  @AdminGroups('admin_super')
  async update(
    @CurrentUser() user: AccessPayload,
    @Param('key') key: string,
    @Body(new ZodValidationPipe(PutSettingDto.schema)) dto: PutSettingDto,
  ) {
    return this.settings.set(key, dto.value, user);
  }
}
