import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { type AccessPayload, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { PresignFileDto } from './files.dto';
import { FilesService } from './files.service';

@ApiTags('files')
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Roles()
  @Post('presign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lấy URL upload có hạn (presigned PUT) + fileId' })
  presign(
    @CurrentUser() user: AccessPayload,
    @Body(new ZodValidationPipe(PresignFileDto.schema)) dto: PresignFileDto,
  ) {
    return this.files.presign(user, dto);
  }

  @Roles()
  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xác nhận đã upload; kiểm tra MIME thật + bắt đầu quét virus' })
  confirm(@CurrentUser() user: AccessPayload, @Param('id') id: string) {
    return this.files.confirm(user, id);
  }

  @Roles()
  @Get(':id')
  @ApiOperation({ summary: 'Metadata tệp (chủ sở hữu hoặc admin)' })
  meta(@CurrentUser() user: AccessPayload, @Param('id') id: string) {
    return this.files.getMeta(user, id);
  }

  @Roles()
  @Get(':id/download')
  @ApiOperation({ summary: 'Link tải có hạn (chỉ khi tệp READY + CLEAN)' })
  download(@CurrentUser() user: AccessPayload, @Param('id') id: string) {
    return this.files.download(user, id);
  }
}
