import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ProductQueryInput, productQuerySchema } from './catalog.dto';
import { PublicCatalogService } from './public-catalog.service';

// Public catalog (P4.2): only visible (published) products, no price or
// supplier data in any response.
@ApiTags('public-catalog')
@Controller()
export class PublicCatalogController {
  constructor(private readonly catalog: PublicCatalogService) {}

  @Public()
  @Get('public/products')
  @ApiOperation({ summary: 'Danh mục công khai (P4.2, chỉ sản phẩm visible)' })
  list(@Query(new ZodValidationPipe(productQuerySchema)) query: ProductQueryInput) {
    return this.catalog.list(query);
  }

  @Public()
  @Get('public/products/:sku')
  @ApiOperation({ summary: 'Chi tiết sản phẩm công khai theo SKU (P4.2)' })
  detail(@Param('sku') sku: string) {
    return this.catalog.detailBySku(sku);
  }

  @Public()
  @Get('public/categories')
  @ApiOperation({ summary: 'Danh sách danh mục công khai (P4.2)' })
  categories() {
    return this.catalog.categories();
  }

  @Public()
  @Get('public/sourcing-cases')
  @ApiOperation({ summary: 'Hồ sơ tìm nguồn đã hỗ trợ (P4.3, ẩn danh khách/NCC)' })
  sourcingCases(@Query(new ZodValidationPipe(productQuerySchema)) query: ProductQueryInput) {
    return this.catalog.sourcingCases(query.page ?? 1, query.limit ?? 20);
  }
}
