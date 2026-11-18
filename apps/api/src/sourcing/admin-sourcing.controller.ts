import { Role } from '@cvc/shared';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { type AccessPayload, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  AddSourcingNoteInput,
  addSourcingNoteSchema,
  AdminSourcingRequestQueryInput,
  adminSourcingRequestQuerySchema,
  AssignSourcingRequestInput,
  assignSourcingRequestSchema,
} from './sourcing-requests.dto';
import { SourcingRequestsService } from './sourcing-requests.service';

// Sales intake (P4.8): triage list, assignment with SLA, internal notes.
// Internal notes are never returned by the buyer endpoints.
@ApiTags('admin-sourcing-requests')
@Roles(Role.Admin, Role.Sales)
@Controller('admin/sourcing-requests')
export class AdminSourcingController {
  constructor(private readonly requests: SourcingRequestsService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách yêu cầu (lọc status, assignee)' })
  list(
    @Query(new ZodValidationPipe(adminSourcingRequestQuerySchema))
    query: AdminSourcingRequestQueryInput,
  ) {
    return this.requests.listAdmin(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết yêu cầu (kèm ghi chú nội bộ)' })
  detail(@Param('id') id: string) {
    return this.requests.getAdmin(id);
  }

  @Post(':id/assign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Phân công sales + hạn xử lý (SLA)' })
  assign(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(assignSourcingRequestSchema)) body: AssignSourcingRequestInput,
  ) {
    return this.requests.assign(user, id, body);
  }

  @Post(':id/notes')
  @ApiOperation({ summary: 'Ghi chú nội bộ (khách không thấy)' })
  addNote(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addSourcingNoteSchema)) body: AddSourcingNoteInput,
  ) {
    return this.requests.addNote(user, id, body);
  }
}
