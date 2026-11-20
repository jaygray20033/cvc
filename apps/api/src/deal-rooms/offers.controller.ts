import { Role } from '@cvc/shared';
import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { type AccessPayload, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CounterOfferInput, createOfferSchema } from './deal-rooms.dto';
import { OffersService } from './offers.service';

// P4.15 — offer decisions. Only the counterparty may accept/reject/counter;
// the service enforces that plus current-offer checks. Outsiders get 404.
@ApiTags('offers')
@Roles(
  Role.Buyer,
  Role.Participant,
  Role.Retailer,
  Role.Supplier,
  Role.Sales,
  Role.Inspector,
  Role.Admin,
)
@Controller('offers')
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Chấp nhận đề nghị (chỉ bên kia, chỉ đề nghị hiện hành)' })
  accept(@CurrentUser() user: AccessPayload, @Param('id') id: string) {
    return this.offers.accept(user, id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Từ chối đề nghị (chỉ bên kia)' })
  reject(@CurrentUser() user: AccessPayload, @Param('id') id: string) {
    return this.offers.reject(user, id);
  }

  @Post(':id/counter')
  @ApiOperation({ summary: 'Đối đề nghị bằng một mức giá mới' })
  counter(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createOfferSchema)) body: CounterOfferInput,
  ) {
    return this.offers.counter(user, id, body);
  }
}
