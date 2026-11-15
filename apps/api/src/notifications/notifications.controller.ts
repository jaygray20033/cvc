import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { type AccessPayload, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { UpdatePreferencesDto } from './notifications.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@Controller()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Roles()
  @Get('notifications')
  @ApiOperation({ summary: 'Danh sách thông báo của tôi + số chưa đọc' })
  list(@CurrentUser() user: AccessPayload, @Query() query: Record<string, string | undefined>) {
    const page = Math.max(1, Number(query.page ?? 1) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20) || 20));
    return this.notifications.list(user.sub, page, limit);
  }

  @Roles()
  @Post('notifications/:id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đánh dấu một thông báo đã đọc' })
  markRead(@CurrentUser() user: AccessPayload, @Param('id') id: string) {
    return this.notifications.markRead(user.sub, id);
  }

  @Roles()
  @Post('notifications/read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đánh dấu tất cả thông báo đã đọc' })
  markAllRead(@CurrentUser() user: AccessPayload) {
    return this.notifications.markAllRead(user.sub);
  }

  @Roles()
  @Get('me/notification-preferences')
  @ApiOperation({ summary: 'Xem tuỳ chọn kênh thông báo' })
  getPreferences(@CurrentUser() user: AccessPayload) {
    return this.notifications.getPreferences(user.sub);
  }

  @Roles()
  @Put('me/notification-preferences')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bật/tắt kênh thông báo (bảo mật/tiền vẫn gửi bắt buộc)' })
  updatePreferences(
    @CurrentUser() user: AccessPayload,
    @Body(new ZodValidationPipe(UpdatePreferencesDto.schema)) dto: UpdatePreferencesDto,
  ) {
    return this.notifications.updatePreferences(user.sub, dto);
  }
}
