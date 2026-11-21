import { Role } from '@cvc/shared';
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { type AccessPayload, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CreateSampleInput, createSampleSchema } from './samples.dto';
import { SamplesService } from './samples.service';

// P4.17 — sample requests live under the order. The service enforces that
// only the order's buyer can request; staff/outsiders follow order access.
@ApiTags('samples')
@Roles(Role.Buyer, Role.Supplier, Role.Sales, Role.Inspector, Role.Admin)
@Controller('orders')
export class OrderSamplesController {
  constructor(private readonly samples: SamplesService) {}

  @Get(':id/samples')
  @ApiOperation({ summary: 'Danh sách mẫu thử của đơn' })
  list(@CurrentUser() user: AccessPayload, @Param('id') id: string) {
    return this.samples.list(user, id);
  }

  @Post(':id/samples')
  @ApiOperation({ summary: 'Khách yêu cầu làm mẫu (requestSample)' })
  request(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createSampleSchema)) body: CreateSampleInput,
  ) {
    return this.samples.request(user, id, body);
  }
}
