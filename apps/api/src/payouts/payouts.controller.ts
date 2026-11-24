import { Role } from '@cvc/shared';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { type AccessPayload, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ConfirmPayoutReceivedInput, confirmPayoutReceivedSchema } from './payouts.dto';
import { PayoutsService } from './payouts.service';

// P4.20 — the supplier view: read one payout and confirm the money arrived.
@ApiTags('payouts')
@Roles(Role.Supplier, Role.Sales, Role.Inspector, Role.Admin)
@Controller('payouts')
export class PayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết lệnh chi + ảnh minh chứng' })
  detail(@CurrentUser() user: AccessPayload, @Param('id') id: string) {
    return this.payouts.detail(user, id);
  }

  @Post(':id/confirm-received')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'NCC xác nhận đã nhận tiền' })
  confirmReceived(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(confirmPayoutReceivedSchema)) body: ConfirmPayoutReceivedInput,
  ) {
    return this.payouts.confirmReceived(user, id, body);
  }
}
