import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { type AccessPayload, CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireKyc } from '../common/decorators/require-kyc.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  type CancelWithdrawalInput,
  cancelWithdrawalSchema,
  type CreateWithdrawalInput,
  createWithdrawalSchema,
  type ListWithdrawalsInput,
  listWithdrawalsSchema,
} from './withdrawals.dto';
import { WithdrawalsService } from './withdrawals.service';

// P4.26 — a user's own withdrawal requests. Requesting money out needs a
// fully verified identity and a bank account (KYC FULL).
@ApiTags('withdrawals')
@Roles()
@Controller('me/withdrawals')
export class WithdrawalsController {
  constructor(private readonly withdrawals: WithdrawalsService) {}

  @Post()
  @RequireKyc('FULL')
  @ApiOperation({ summary: 'Tạo yêu cầu rút tiền (tạm giữ số dư khả dụng)' })
  create(
    @CurrentUser() user: AccessPayload,
    @Body(new ZodValidationPipe(createWithdrawalSchema)) body: CreateWithdrawalInput,
  ) {
    return this.withdrawals.request(user, body);
  }

  @Get()
  @ApiOperation({ summary: 'Danh sách yêu cầu rút tiền của tôi' })
  list(
    @CurrentUser() user: AccessPayload,
    @Query(new ZodValidationPipe(listWithdrawalsSchema)) query: ListWithdrawalsInput,
  ) {
    return this.withdrawals.listForUser(user.sub, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết yêu cầu rút tiền của tôi' })
  detail(@CurrentUser() user: AccessPayload, @Param('id') id: string) {
    return this.withdrawals.detailForUser(user.sub, id);
  }

  @Get(':id/proof')
  @ApiOperation({ summary: 'Link tải ảnh minh chứng chi (chỉ khi đã chi)' })
  proof(@CurrentUser() user: AccessPayload, @Param('id') id: string) {
    return this.withdrawals.proofUrl(user.sub, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hủy yêu cầu rút tiền (hoàn tạm giữ về ví)' })
  cancel(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelWithdrawalSchema)) body: CancelWithdrawalInput,
  ) {
    return this.withdrawals.cancel(user, id, body);
  }
}
