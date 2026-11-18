import { Role } from '@cvc/shared';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { type AccessPayload, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  CreateSourcingRequestInput,
  createSourcingRequestSchema,
  SourcingRequestQueryInput,
  sourcingRequestQuerySchema,
} from './sourcing-requests.dto';
import { SourcingRequestsService } from './sourcing-requests.service';

// Buyer RFQs (P4.7): create, list own, detail own, cancel before selection.
@ApiTags('sourcing-requests')
@Roles(Role.Buyer)
@Controller('sourcing-requests')
export class BuyerSourcingController {
  constructor(private readonly requests: SourcingRequestsService) {}

  @Post()
  @ApiOperation({ summary: 'Gửi yêu cầu tìm nguồn (createRFQ)' })
  create(
    @CurrentUser() user: AccessPayload,
    @Body(new ZodValidationPipe(createSourcingRequestSchema)) body: CreateSourcingRequestInput,
  ) {
    return this.requests.create(user, body);
  }

  @Get()
  @ApiOperation({ summary: 'Yêu cầu của tôi' })
  list(
    @CurrentUser() user: AccessPayload,
    @Query(new ZodValidationPipe(sourcingRequestQuerySchema)) query: SourcingRequestQueryInput,
  ) {
    return this.requests.listMine(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết yêu cầu của tôi' })
  detail(@CurrentUser() user: AccessPayload, @Param('id') id: string) {
    return this.requests.getMine(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hủy yêu cầu (trước khi chọn báo giá)' })
  cancel(@CurrentUser() user: AccessPayload, @Param('id') id: string) {
    return this.requests.cancel(user, id);
  }
}
