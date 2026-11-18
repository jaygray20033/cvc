import { Role } from '@cvc/shared';
import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { type AccessPayload, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  CreateSupplierAccountInput,
  createSupplierAccountSchema,
  CreateSupplierInput,
  createSupplierSchema,
  SupplierAccountStatusInput,
  supplierAccountStatusSchema,
} from './suppliers.dto';
import { SuppliersService } from './suppliers.service';

// Admin supplier management (P4.5): create suppliers, invite login accounts,
// lock/unlock accounts. Write actions are audit-logged by AuditInterceptor.
@ApiTags('admin-suppliers')
@Roles(Role.Admin)
@Controller('admin')
export class AdminSuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Post('suppliers')
  @ApiOperation({ summary: 'Tạo nhà cung cấp' })
  createSupplier(
    @CurrentUser() user: AccessPayload,
    @Body(new ZodValidationPipe(createSupplierSchema)) body: CreateSupplierInput,
  ) {
    return this.suppliers.createSupplier(user, body);
  }

  @Post('supplier-accounts')
  @ApiOperation({ summary: 'Tạo tài khoản đăng nhập NCC + gửi email mời (createAccount)' })
  createAccount(
    @CurrentUser() user: AccessPayload,
    @Body(new ZodValidationPipe(createSupplierAccountSchema)) body: CreateSupplierAccountInput,
  ) {
    return this.suppliers.createAccount(user, body);
  }

  @Patch('supplier-accounts/:id/status')
  @ApiOperation({ summary: 'Khóa/mở tài khoản NCC (toggleAccount)' })
  setAccountStatus(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(supplierAccountStatusSchema)) body: SupplierAccountStatusInput,
  ) {
    return this.suppliers.setAccountStatus(user, id, body);
  }
}
