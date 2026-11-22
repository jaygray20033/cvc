import { Role } from '@cvc/shared';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { type AccessPayload, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { type UpsertCustomerInfoInput, upsertCustomerInfoSchema } from './customer-info.dto';
import { CustomerInfoService } from './customer-info.service';

// P4.18 — legal customer information used by the sourcing contract.
// Supplier accounts may see the order but not this privacy-sensitive snapshot.
@ApiTags('orders')
@Roles(Role.Buyer, Role.Supplier, Role.Sales, Role.Inspector, Role.Admin)
@Controller('orders')
export class CustomerInfoController {
  constructor(private readonly customerInfo: CustomerInfoService) {}

  @Get(':id/customer-info')
  @ApiOperation({ summary: 'Thông tin khách cho hợp đồng + gợi ý từ hồ sơ/KYC' })
  get(@CurrentUser() user: AccessPayload, @Param('id') id: string) {
    return this.customerInfo.get(user, id);
  }

  @Put(':id/customer-info')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lưu thông tin khách cho hợp đồng (khóa sau khi có hợp đồng)' })
  upsert(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(upsertCustomerInfoSchema)) body: UpsertCustomerInfoInput,
  ) {
    return this.customerInfo.upsert(user, id, body);
  }
}
