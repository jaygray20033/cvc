import { Role } from '@cvc/shared';
import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { type AccessPayload, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  SupplierProductInput,
  SupplierProductQueryInput,
  supplierProductQuerySchema,
  supplierProductSchema,
  SupplierProductVisibilityInput,
  supplierProductVisibilitySchema,
  UpdateSupplierProductInput,
  updateSupplierProductSchema,
} from './suppliers.dto';
import { SuppliersService } from './suppliers.service';

// Supplier portal (P4.4): a supplier only ever sees/edits its own listings.
@ApiTags('supplier-products')
@Roles(Role.Supplier)
@Controller('supplier')
export class SupplierPortalController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get('products')
  @ApiOperation({ summary: 'Sản phẩm của nhà cung cấp đang đăng nhập (ownProducts)' })
  list(
    @CurrentUser() user: AccessPayload,
    @Query(new ZodValidationPipe(supplierProductQuerySchema)) query: SupplierProductQueryInput,
  ) {
    return this.suppliers.listOwn(user.sub, query.page ?? 1, query.limit ?? 20);
  }

  @Post('products')
  @ApiOperation({ summary: 'Đăng sản phẩm mới (saveProduct, chờ admin duyệt)' })
  create(
    @CurrentUser() user: AccessPayload,
    @Body(new ZodValidationPipe(supplierProductSchema)) body: SupplierProductInput,
  ) {
    return this.suppliers.createOwn(user.sub, body);
  }

  @Get('products/:id')
  @ApiOperation({ summary: 'Chi tiết sản phẩm của chính mình' })
  detail(@CurrentUser() user: AccessPayload, @Param('id') id: string) {
    return this.suppliers.getOwn(user.sub, id);
  }

  @Put('products/:id')
  @ApiOperation({ summary: 'Sửa sản phẩm của chính mình' })
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSupplierProductSchema)) body: UpdateSupplierProductInput,
  ) {
    return this.suppliers.updateOwn(user.sub, id, body);
  }

  @Patch('products/:id/visibility')
  @ApiOperation({ summary: 'Ẩn/hiện sản phẩm (hiện cần admin duyệt trước)' })
  setVisibility(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(supplierProductVisibilitySchema))
    body: SupplierProductVisibilityInput,
  ) {
    return this.suppliers.setVisibility(user.sub, id, body);
  }
}
