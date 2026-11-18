import { Role } from '@cvc/shared';
import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { type AccessPayload, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  CreatePartnerBannerInput,
  createPartnerBannerSchema,
  PartnerBannerQueryInput,
  partnerBannerQuerySchema,
  UpdatePartnerBannerInput,
  updatePartnerBannerSchema,
} from './banners.dto';
import { BannersService } from './banners.service';

// Admin partner-banner CRUD (P4.6).
@ApiTags('admin-partner-banners')
@Roles(Role.Admin)
@Controller('admin/partner-banners')
export class AdminBannersController {
  constructor(private readonly banners: BannersService) {}

  @Post()
  @ApiOperation({ summary: 'Tạo banner đối tác' })
  create(
    @CurrentUser() user: AccessPayload,
    @Body(new ZodValidationPipe(createPartnerBannerSchema)) body: CreatePartnerBannerInput,
  ) {
    return this.banners.create(user, body);
  }

  @Get()
  @ApiOperation({ summary: 'Danh sách banner (kể cả hết hạn/tạm ẩn)' })
  list(@Query(new ZodValidationPipe(partnerBannerQuerySchema)) query: PartnerBannerQueryInput) {
    return this.banners.listAdmin(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết banner' })
  detail(@Param('id') id: string) {
    return this.banners.getById(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Cập nhật banner' })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePartnerBannerSchema)) body: UpdatePartnerBannerInput,
  ) {
    return this.banners.update(id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Xóa banner' })
  remove(@Param('id') id: string) {
    return this.banners.remove(id);
  }
}
