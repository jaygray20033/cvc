import { Role } from '@cvc/shared';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { AdminGroups } from '../common/decorators/admin-groups.decorator';
import { type AccessPayload, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ApproveDto, ListKycQueryDto, ReviewNoteDto } from './kyc.dto';
import { KycService } from './kyc.service';

// Admin KYC review queue (P2.13/P2.14). KYC review belongs to admin_ops and
// admin_super (admin_finance/support cannot review KYC).
@ApiTags('admin')
@Controller('admin/kyc')
@Roles(Role.Admin)
@AdminGroups('admin_ops', 'admin_super')
export class KycAdminController {
  constructor(private readonly kyc: KycService) {}

  @Get()
  @ApiOperation({ summary: 'Hàng đợi duyệt KYC (?status=PENDING|NEED_MORE|APPROVED|REJECTED)' })
  list(@Query(new ZodValidationPipe(ListKycQueryDto.schema)) query: { status?: string }) {
    return this.kyc.listSubmissionsForAdmin(
      query.status as 'PENDING' | 'NEED_MORE' | 'APPROVED' | 'REJECTED' | undefined,
    );
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Duyệt hồ sơ KYC theo checklist đối chiếu bằng mắt' })
  approve(
    @CurrentUser() admin: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ApproveDto.schema)) dto: ApproveDto,
  ) {
    return this.kyc.approve(admin, id, dto.checklist);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Từ chối hồ sơ KYC (bắt buộc có lý do)' })
  reject(
    @CurrentUser() admin: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReviewNoteDto.schema)) dto: ReviewNoteDto,
  ) {
    return this.kyc.reject(admin, id, dto.reason);
  }

  @Post(':id/request-more')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Yêu cầu bổ sung giấy tờ (bắt buộc có lý do)' })
  requestMore(
    @CurrentUser() admin: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReviewNoteDto.schema)) dto: ReviewNoteDto,
  ) {
    return this.kyc.requestMore(admin, id, dto.reason);
  }

  @Get('documents/:id/download')
  @ApiOperation({ summary: 'Link tải giấy tờ KYC của người dùng (hạn 5 phút, log truy cập)' })
  downloadDoc(@CurrentUser() admin: AccessPayload, @Param('id') id: string) {
    return this.kyc.getDocumentDownloadLinkForAdmin(admin, id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết hồ sơ: ảnh + số CCCD giải mã + lịch sử (log mỗi lần xem)' })
  detail(@CurrentUser() admin: AccessPayload, @Param('id') id: string) {
    return this.kyc.getSubmissionDetailForAdmin(admin, id);
  }
}
