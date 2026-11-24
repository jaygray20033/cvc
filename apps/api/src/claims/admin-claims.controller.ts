import { Role } from '@cvc/shared';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { AdminGroups } from '../common/decorators/admin-groups.decorator';
import { type AccessPayload, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  ExecuteRefundInput,
  executeRefundSchema,
  ListAdminClaimsInput,
  listAdminClaimsSchema,
  ResolveClaimInput,
  resolveClaimSchema,
} from './claims.dto';
import { ClaimsService } from './claims.service';

// P4.22 — finance/ops queue. Only finance admins may post refund money; any
// admin may close/reject a claim.
@ApiTags('admin')
@Roles(Role.Admin)
@Controller('admin')
export class AdminClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Get('claims')
  @ApiOperation({ summary: 'Hàng đợi khiếu nại (?status=&orderId=)' })
  list(@Query(new ZodValidationPipe(listAdminClaimsSchema)) query: ListAdminClaimsInput) {
    return this.claims.listForAdmin(query);
  }

  @Post('claims/:id/execute-refund')
  @HttpCode(HttpStatus.OK)
  @AdminGroups('admin_finance', 'admin_super')
  @ApiOperation({ summary: 'Hoàn tiền qua sổ cái (không vượt số đã thu)' })
  executeRefund(
    @CurrentUser() admin: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(executeRefundSchema)) body: ExecuteRefundInput,
  ) {
    return this.claims.executeRefund(admin, id, body);
  }

  @Post('claims/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Kết luận khiếu nại: chấp nhận đóng hoặc từ chối' })
  resolve(
    @CurrentUser() admin: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(resolveClaimSchema)) body: ResolveClaimInput,
  ) {
    return this.claims.resolve(admin, id, body);
  }
}
