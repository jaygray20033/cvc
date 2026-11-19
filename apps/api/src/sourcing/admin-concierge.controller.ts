import { Role } from '@cvc/shared';
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { type AccessPayload, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ConciergeService } from './concierge.service';
import {
  AdminConciergeRequestInput,
  adminConciergeRequestSchema,
  OpenConciergeRoomInput,
  openConciergeRoomSchema,
} from './sourcing-requests.dto';

// P4.11 — CVC concierge. Sales files sourcing requests for walk-in customers
// and opens a private Deal Room with the matched or chosen supplier.
@ApiTags('admin-concierge')
@Roles(Role.Admin, Role.Sales)
@Controller('admin/concierge')
export class AdminConciergeController {
  constructor(private readonly concierge: ConciergeService) {}

  @Post('requests')
  @ApiOperation({ summary: 'Tạo yêu cầu tìm nguồn thay khách (postConciergeRequest)' })
  createRequest(
    @CurrentUser() user: AccessPayload,
    @Body(new ZodValidationPipe(adminConciergeRequestSchema)) body: AdminConciergeRequestInput,
  ) {
    return this.concierge.createRequest(user, body);
  }

  @Post('rooms')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mở phòng giới thiệu NCC + tạo đơn (openConciergeRoom)' })
  openRoom(
    @CurrentUser() user: AccessPayload,
    @Body(new ZodValidationPipe(openConciergeRoomSchema)) body: OpenConciergeRoomInput,
  ) {
    return this.concierge.openRoom(user, body);
  }
}
