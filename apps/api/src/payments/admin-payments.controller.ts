import { Role } from '@cvc/shared';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { AdminGroups } from '../common/decorators/admin-groups.decorator';
import { type AccessPayload, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  ApprovePaymentInput,
  approvePaymentSchema,
  type ListAdminPaymentsInput,
  listAdminPaymentsSchema,
  RejectPaymentInput,
  rejectPaymentSchema,
  RequestMorePaymentInput,
  requestMorePaymentSchema,
} from './payments.dto';
import { PaymentsService } from './payments.service';

// P4.19 A — finance queue. Only admin_finance/admin_super may see proofs and
// approve money (P2.10 group rule).
@ApiTags('admin')
@Roles(Role.Admin)
@AdminGroups('admin_finance', 'admin_super')
@Controller('admin/payments')
export class AdminPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @ApiOperation({ summary: 'Hàng đợi thanh toán (?status=PROOF_SUBMITTED|...) ' })
  list(@Query(new ZodValidationPipe(listAdminPaymentsSchema)) query: ListAdminPaymentsInput) {
    return this.payments.listForAdmin(query);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Duyệt số tiền thực nhận; ghi sổ cái và tạo yêu cầu bù nếu thiếu' })
  approve(
    @CurrentUser() admin: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(approvePaymentSchema)) body: ApprovePaymentInput,
  ) {
    return this.payments.approve(admin, id, body);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Từ chối minh chứng (khách được nộp lại ảnh khác)' })
  reject(
    @CurrentUser() admin: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rejectPaymentSchema)) body: RejectPaymentInput,
  ) {
    return this.payments.reject(admin, id, body);
  }

  @Post(':id/request-more')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Yêu cầu bổ sung minh chứng' })
  requestMore(
    @CurrentUser() admin: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(requestMorePaymentSchema)) body: RequestMorePaymentInput,
  ) {
    return this.payments.requestMore(admin, id, body);
  }
}
