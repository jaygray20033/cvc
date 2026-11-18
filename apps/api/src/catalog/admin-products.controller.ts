import { Role } from '@cvc/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { type AccessPayload, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  AdminProductQueryInput,
  adminProductQuerySchema,
  CreateProductInput,
  createProductSchema,
  ProductImagesInput,
  productImagesSchema,
  PublishCaseInput,
  publishCaseSchema,
  ReplaceSpecsInput,
  replaceSpecsSchema,
  UpdateProductInput,
  updateProductSchema,
  VisibilityInput,
  visibilitySchema,
} from './catalog.dto';
import { ProductsService } from './products.service';

// Admin product management (P4.1, admin + sales) and sourcing-case
// publishing (P4.3, sales).
@ApiTags('admin-products')
@Roles(Role.Admin, Role.Sales)
@Controller()
export class AdminProductsController {
  constructor(private readonly products: ProductsService) {}

  @Post('admin/products')
  @ApiOperation({ summary: 'Tạo sản phẩm (P4.1)' })
  create(
    @CurrentUser() user: AccessPayload,
    @Body(new ZodValidationPipe(createProductSchema)) body: CreateProductInput,
  ) {
    return this.products.create(user, body);
  }

  @Put('admin/products/:id')
  @ApiOperation({ summary: 'Cập nhật sản phẩm (P4.1)' })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateProductSchema)) body: UpdateProductInput,
  ) {
    return this.products.update(id, body);
  }

  @Delete('admin/products/:id')
  @ApiOperation({ summary: 'Xóa mềm sản phẩm (P4.1)' })
  remove(@Param('id') id: string) {
    return this.products.softDelete(id);
  }

  @Patch('admin/products/:id/visibility')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ẩn/hiện sản phẩm (toggleProduct)' })
  setVisibility(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(visibilitySchema)) body: VisibilityInput,
  ) {
    return this.products.setVisibility(id, body);
  }

  @Post('admin/products/:id/images')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Thêm ảnh vào gallery (P4.1)' })
  addImages(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(productImagesSchema)) body: ProductImagesInput,
  ) {
    return this.products.addImages(id, body);
  }

  @Delete('admin/products/:id/images/:imageId')
  @ApiOperation({ summary: 'Xóa một ảnh (P4.1)' })
  removeImage(@Param('id') id: string, @Param('imageId') imageId: string) {
    return this.products.removeImage(id, imageId);
  }

  @Put('admin/products/:id/specs')
  @ApiOperation({ summary: 'Thay toàn bộ thông số key-value (P4.1)' })
  replaceSpecs(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(replaceSpecsSchema)) body: ReplaceSpecsInput,
  ) {
    return this.products.replaceSpecs(id, body);
  }

  @Get('admin/products')
  @ApiOperation({ summary: 'Danh sách sản phẩm (admin)' })
  list(@Query(new ZodValidationPipe(adminProductQuerySchema)) query: AdminProductQueryInput) {
    return this.products.list({
      status: query.status,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get('admin/products/:id')
  @ApiOperation({ summary: 'Chi tiết sản phẩm (admin)' })
  getById(@Param('id') id: string) {
    return this.products.getById(id);
  }

  @Post('admin/sourcing-cases/:id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish đơn hoàn tất thành hồ sơ tìm nguồn (P4.3)' })
  publishCase(
    @CurrentUser() user: AccessPayload,
    @Param('id') orderId: string,
    @Body(new ZodValidationPipe(publishCaseSchema)) body: PublishCaseInput,
  ) {
    return this.products.publishSourcingCase(orderId, body, user);
  }
}
