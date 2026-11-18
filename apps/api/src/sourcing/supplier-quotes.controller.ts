import { Role } from '@cvc/shared';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { type AccessPayload, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  CreateQuoteInput,
  createQuoteSchema,
  SupplierRequestQueryInput,
  supplierRequestQuerySchema,
  UpdateQuoteInput,
  updateQuoteSchema,
} from './sourcing-requests.dto';
import { SupplierQuotesService } from './supplier-quotes.service';

// P4.9 — supplier portal quoting. Suppliers only see RFQs they were invited
// to (or that match their approved categories) and only their own quote.
@ApiTags('supplier-quotes')
@Roles(Role.Supplier)
@Controller('supplier')
export class SupplierQuotesController {
  constructor(private readonly quotes: SupplierQuotesService) {}

  @Get('requests')
  @ApiOperation({ summary: 'Yêu cầu phù hợp/được mời (postRequest)' })
  list(
    @CurrentUser() user: AccessPayload,
    @Query(new ZodValidationPipe(supplierRequestQuerySchema))
    query: SupplierRequestQueryInput,
  ) {
    return this.quotes.listRequests(user.sub, query);
  }

  @Post('requests/:id/quotes')
  @ApiOperation({ summary: 'Gửi báo giá (sendQuote)' })
  create(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createQuoteSchema)) body: CreateQuoteInput,
  ) {
    return this.quotes.createQuote(user.sub, id, body);
  }

  @Put('quotes/:id')
  @ApiOperation({ summary: 'Cập nhật báo giá đang chờ chọn' })
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateQuoteSchema)) body: UpdateQuoteInput,
  ) {
    return this.quotes.updateQuote(user.sub, id, body);
  }

  @Post('quotes/:id/withdraw')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rút báo giá trước khi được chọn' })
  withdraw(@CurrentUser() user: AccessPayload, @Param('id') id: string) {
    return this.quotes.withdrawQuote(user.sub, id);
  }
}
