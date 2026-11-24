import { Role } from '@cvc/shared';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { type AccessPayload, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  ProductionReadyInput,
  productionReadySchema,
  ProductionReportInput,
  productionReportSchema,
} from './production.dto';
import { ProductionService } from './production.service';

// P4.19 B — supplier production reports; the buyer and CVC staff can read.
@ApiTags('production')
@Roles(Role.Buyer, Role.Supplier, Role.Sales, Role.Inspector, Role.Admin)
@Controller('orders')
export class ProductionController {
  constructor(private readonly production: ProductionService) {}

  @Post(':id/production-reports')
  @ApiOperation({ summary: 'NCC báo tiến độ sản xuất kèm ảnh/video' })
  report(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(productionReportSchema)) body: ProductionReportInput,
  ) {
    return this.production.report(user, id, body);
  }

  @Post(':id/ready')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'NCC báo hoàn tất sản xuất; đơn chuyển production → qc' })
  ready(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(productionReadySchema)) body: ProductionReadyInput,
  ) {
    return this.production.ready(user, id, body);
  }

  @Get(':id/production-reports')
  @ApiOperation({ summary: 'Danh sách báo cáo sản xuất của đơn' })
  list(@CurrentUser() user: AccessPayload, @Param('id') id: string) {
    return this.production.list(user, id);
  }
}
