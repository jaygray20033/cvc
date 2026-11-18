import { Role } from '@cvc/shared';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { type AccessPayload, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { QuoteSelectionService } from './quote-selection.service';
import {
  CreateSourcingRequestInput,
  createSourcingRequestSchema,
  SelectQuoteInput,
  selectQuoteSchema,
  SourcingRequestQueryInput,
  sourcingRequestQuerySchema,
} from './sourcing-requests.dto';
import { SourcingRequestsService } from './sourcing-requests.service';

// Buyer RFQs (P4.7) + quote comparison/selection (P4.10). A buyer only ever
// touches its own requests.
@ApiTags('sourcing-requests')
@Roles(Role.Buyer)
@Controller('sourcing-requests')
export class BuyerSourcingController {
  constructor(
    private readonly requests: SourcingRequestsService,
    private readonly quotes: QuoteSelectionService,
  ) {}

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

  @Get(':id/quotes')
  @ApiOperation({ summary: 'So sánh báo giá (đơn giá, MOQ, lead time, hiệu lực)' })
  compare(@CurrentUser() user: AccessPayload, @Param('id') id: string) {
    return this.quotes.listQuotes(user, id);
  }

  @Post(':id/select-quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Chọn báo giá, tạo đơn + phòng thương lượng (selectQuote)' })
  select(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(selectQuoteSchema)) body: SelectQuoteInput,
  ) {
    return this.quotes.selectQuote(user, id, body);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hủy yêu cầu (trước khi chọn báo giá)' })
  cancel(@CurrentUser() user: AccessPayload, @Param('id') id: string) {
    return this.requests.cancel(user, id);
  }
}
