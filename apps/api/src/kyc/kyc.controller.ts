import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { type AccessPayload, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { PresignUploadDto } from './kyc.dto';
import { KycService } from './kyc.service';

@ApiTags('kyc')
@Controller('me/kyc')
export class KycController {
  constructor(private readonly kyc: KycService) {}

  @Roles()
  @Get()
  @ApiOperation({ summary: 'Hồ sơ KYC của tôi + trạng thái từng lần nộp' })
  listMine(@CurrentUser() user: AccessPayload) {
    return this.kyc.listMySubmissions(user);
  }

  @Roles()
  @Post('documents/presign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lấy URL upload có hạn 5 phút cho một giấy tờ KYC' })
  presign(
    @CurrentUser() user: AccessPayload,
    @Body(new ZodValidationPipe(PresignUploadDto.schema)) dto: PresignUploadDto,
  ) {
    return this.kyc.presignUpload(user, dto);
  }

  @Roles()
  @Post('documents/:id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xác nhận đã upload xong giấy tờ' })
  confirm(@CurrentUser() user: AccessPayload, @Param('id') id: string) {
    return this.kyc.confirmUpload(user, id);
  }

  @Roles()
  @Get('documents/:id/download')
  @ApiOperation({ summary: 'Link tải giấy tờ của tôi (hạn 5 phút, có log truy cập)' })
  downloadMine(@CurrentUser() user: AccessPayload, @Param('id') id: string) {
    return this.kyc.getDocumentDownloadLink(user, id);
  }
}
