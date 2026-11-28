import { Role } from '@cvc/shared';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { AdminGroups } from '../common/decorators/admin-groups.decorator';
import { type AccessPayload, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  type ApproveWithdrawalInput,
  approveWithdrawalSchema,
  type ListWithdrawalsInput,
  listWithdrawalsSchema,
  type MarkWithdrawalPaidInput,
  markWithdrawalPaidSchema,
  type RejectWithdrawalInput,
  rejectWithdrawalSchema,
} from './withdrawals.dto';
import { WithdrawalsService } from './withdrawals.service';

// P4.26 — finance-only withdrawal queue. The bank transfer is manual and
// outside the platform; mark-paid records the proof and posts the ledger.
@ApiTags('admin')
@Roles(Role.Admin)
@AdminGroups('admin_finance', 'admin_super')
@Controller('admin/withdrawals')
export class AdminWithdrawalsController {
  constructor(private readonly withdrawals: WithdrawalsService) {}

  @Get()
  @ApiOperation({ summary: 'Hàng đợi yêu cầu rút tiền (?status=...)' })
  list(@Query(new ZodValidationPipe(listWithdrawalsSchema)) query: ListWithdrawalsInput) {
    return this.withdrawals.listForAdmin(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết yêu cầu rút tiền' })
  detail(@Param('id') id: string) {
    return this.withdrawals.detailForAdmin(id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Duyệt yêu cầu rút tiền (hai lớp nếu vượt ngưỡng)' })
  approve(
    @CurrentUser() admin: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(approveWithdrawalSchema)) body: ApproveWithdrawalInput,
  ) {
    return this.withdrawals.approve(admin, id, body);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Từ chối yêu cầu rút tiền (hoàn tạm giữ)' })
  reject(
    @CurrentUser() admin: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rejectWithdrawalSchema)) body: RejectWithdrawalInput,
  ) {
    return this.withdrawals.reject(admin, id, body);
  }

  @Post(':id/mark-paid')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đã chuyển khoản ngoài hệ thống + ảnh minh chứng + mã giao dịch' })
  markPaid(
    @CurrentUser() admin: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(markWithdrawalPaidSchema)) body: MarkWithdrawalPaidInput,
  ) {
    return this.withdrawals.markPaid(admin, id, body);
  }
}
