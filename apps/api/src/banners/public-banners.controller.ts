import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { PartnerBannerQueryInput, partnerBannerQuerySchema } from './banners.dto';
import { BannersService } from './banners.service';

// Public partner banners (P4.6): seeded by `sponsoredSuppliers` in the demo.
@ApiTags('public-partner-banners')
@Controller()
export class PublicBannersController {
  constructor(private readonly banners: BannersService) {}

  @Public()
  @Get('public/partner-banners')
  @ApiOperation({ summary: 'Banner đối tác đang hiệu lực (hết hạn tự ẩn)' })
  list(@Query(new ZodValidationPipe(partnerBannerQuerySchema)) query: PartnerBannerQueryInput) {
    return this.banners.listPublic(query);
  }
}
