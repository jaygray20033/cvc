import { Role } from '@cvc/shared';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { type AccessPayload, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  CreateOrderPaymentInput,
  createOrderPaymentSchema,
  SubmitPaymentProofInput,
  submitPaymentProofSchema,
} from './payments.dto';
import { PaymentsService } from './payments.service';

// P4.19 A — order payment requests are visible to the buyer and CVC staff;
// supplier accounts get 403 (money privacy), outsiders 404.
@ApiTags('payments')
@Roles(Role.Buyer, Role.Supplier, Role.Sales, Role.Inspector, Role.Admin)
@Controller('orders')
export class OrderPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(':id/payments')
  @ApiOperation({ summary: 'Khách tạo yêu cầu thanh toán cọc/còn lại (mã tham chiếu duy nhất)' })
  create(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createOrderPaymentSchema)) body: CreateOrderPaymentInput,
  ) {
    return this.payments.create(user, id, body);
  }

  @Get(':id/payments')
  @ApiOperation({ summary: 'Danh sách yêu cầu thanh toán của đơn' })
  list(@CurrentUser() user: AccessPayload, @Param('id') id: string) {
    return this.payments.listForOrder(user, id);
  }
}

// P4.19 A — the payer's view of one request and the proof upload.
@ApiTags('payments')
@Roles(Role.Buyer, Role.Supplier, Role.Sales, Role.Inspector, Role.Admin)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết yêu cầu thanh toán + minh chứng đã nộp' })
  detail(@CurrentUser() user: AccessPayload, @Param('id') id: string) {
    return this.payments.detail(user, id);
  }

  @Post(':id/proofs')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Khách nộp ảnh minh chứng + số tiền/ngày/ngân hàng/mã giao dịch' })
  submitProof(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(submitPaymentProofSchema)) body: SubmitPaymentProofInput,
  ) {
    return this.payments.submitProof(user, id, body);
  }
}
