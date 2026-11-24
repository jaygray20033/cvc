import { Role } from '@cvc/shared';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { type AccessPayload, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  ChooseClaimResolutionInput,
  chooseClaimResolutionSchema,
  ClaimProposalInput,
  claimProposalSchema,
  ConfirmRefundInput,
  confirmRefundSchema,
  ConfirmTopupInput,
  confirmTopupSchema,
  IssueClaimInput,
  issueClaimSchema,
  MoveTopupInput,
  moveTopupSchema,
  ReceiveReturnInput,
  receiveReturnSchema,
  SendReturnInput,
  sendReturnSchema,
  WithdrawClaimInput,
  withdrawClaimSchema,
} from './claims.dto';
import { ClaimsService } from './claims.service';

// P4.22 — buyer files a claim with evidence; both parties can read them.
@ApiTags('claims')
@Roles(Role.Buyer, Role.Supplier, Role.Sales, Role.Inspector, Role.Admin)
@Controller('orders')
export class OrderClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Post(':id/claims')
  @ApiOperation({ summary: 'Khách mở khiếu nại thiếu hàng / chất lượng kèm ảnh-video' })
  create(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(issueClaimSchema)) body: IssueClaimInput,
  ) {
    return this.claims.create(user, id, body);
  }

  @Get(':id/claims')
  @ApiOperation({ summary: 'Danh sách khiếu nại của đơn' })
  list(@CurrentUser() user: AccessPayload, @Param('id') id: string) {
    return this.claims.listForOrder(user, id);
  }
}

// P4.22 — claim lifecycle. State changes use explicit action routes; the
// service enforces the state machine role matrix.
@ApiTags('claims')
@Roles(Role.Buyer, Role.Supplier, Role.Sales, Role.Inspector, Role.Admin)
@Controller('claims')
export class ClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết khiếu nại + điều khoản đã khóa + hợp đồng đã ký' })
  detail(@CurrentUser() user: AccessPayload, @Param('id') id: string) {
    return this.claims.detail(user, id);
  }

  @Post(':id/proposals')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'CVC/nhà cung cấp đề xuất phương án xử lý' })
  propose(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(claimProposalSchema)) body: ClaimProposalInput,
  ) {
    return this.claims.propose(user, id, body);
  }

  @Post(':id/choose-resolution')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Khách chọn gửi bù, hoàn tiền hoặc trả hàng hoàn tiền' })
  chooseResolution(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(chooseClaimResolutionSchema)) body: ChooseClaimResolutionInput,
  ) {
    return this.claims.chooseResolution(user, id, body);
  }

  @Post(':id/topup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'NCC/CVC cập nhật tiến độ hàng gửi bù' })
  moveTopup(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(moveTopupSchema)) body: MoveTopupInput,
  ) {
    return this.claims.moveTopup(user, id, body);
  }

  @Post(':id/topup/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Khách xác nhận đã nhận hàng gửi bù' })
  confirmTopup(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(confirmTopupSchema)) body: ConfirmTopupInput,
  ) {
    return this.claims.confirmTopup(user, id, body);
  }

  @Post(':id/return/ship')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Khách gửi trả hàng (mã vận đơn + đồng ý điều kiện)' })
  sendReturn(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(sendReturnSchema)) body: SendReturnInput,
  ) {
    return this.claims.sendReturn(user, id, body);
  }

  @Post(':id/return/receive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'CVC xác nhận đã nhận hàng trả về' })
  receiveReturn(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(receiveReturnSchema)) body: ReceiveReturnInput,
  ) {
    return this.claims.receiveReturn(user, id, body);
  }

  @Post(':id/confirm-refund')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Khách xác nhận đã nhận tiền hoàn' })
  confirmRefund(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(confirmRefundSchema)) body: ConfirmRefundInput,
  ) {
    return this.claims.confirmRefund(user, id, body);
  }

  @Post(':id/withdraw')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Khách rút khiếu nại trước khi kết luận' })
  withdraw(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(withdrawClaimSchema)) body: WithdrawClaimInput,
  ) {
    return this.claims.withdraw(user, id, body);
  }
}
