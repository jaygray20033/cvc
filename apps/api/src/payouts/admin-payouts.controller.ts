import { Role } from '@cvc/shared';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { AdminGroups } from '../common/decorators/admin-groups.decorator';
import { type AccessPayload, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  ApprovePayoutInput,
  approvePayoutSchema,
  CreateSupplierPayoutInput,
  createSupplierPayoutSchema,
  ListPayoutsInput,
  listPayoutsSchema,
  MarkPayoutPaidInput,
  markPayoutPaidSchema,
  RejectPayoutInput,
  rejectPayoutSchema,
} from './payouts.dto';
import { PayoutsService } from './payouts.service';

// P4.20 — finance-only supplier payouts. Explicitly manual: the actual bank
// transfer happens outside the platform, then mark-paid records the proof.
@ApiTags('admin')
@Roles(Role.Admin)
@AdminGroups('admin_finance', 'admin_super')
@Controller('admin')
export class AdminPayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Post('orders/:id/supplier-payouts')
  @ApiOperation({ summary: 'Tạo lệnh chi NCC (tài khoản nhận đã xác minh, tham chiếu đơn)' })
  create(
    @CurrentUser() admin: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createSupplierPayoutSchema)) body: CreateSupplierPayoutInput,
  ) {
    return this.payouts.createForOrder(admin, id, body);
  }

  @Get('payouts')
  @ApiOperation({ summary: 'Hàng đợi lệnh chi NCC (?status=...) ' })
  list(@Query(new ZodValidationPipe(listPayoutsSchema)) query: ListPayoutsInput) {
    return this.payouts.listForAdmin(query);
  }

  @Post('payouts/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Duyệt lệnh chi (hai lớp nếu vượt ngưỡng)' })
  approve(
    @CurrentUser() admin: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(approvePayoutSchema)) body: ApprovePayoutInput,
  ) {
    return this.payouts.approve(admin, id, body);
  }

  @Post('payouts/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Từ chối lệnh chi trước khi chuyển tiền' })
  reject(
    @CurrentUser() admin: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rejectPayoutSchema)) body: RejectPayoutInput,
  ) {
    return this.payouts.reject(admin, id, body);
  }

  @Post('payouts/:id/mark-paid')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đã chuyển khoản ngoài hệ thống + ảnh minh chứng + mã giao dịch' })
  markPaid(
    @CurrentUser() admin: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(markPayoutPaidSchema)) body: MarkPayoutPaidInput,
  ) {
    return this.payouts.markPaid(admin, id, body);
  }
}
