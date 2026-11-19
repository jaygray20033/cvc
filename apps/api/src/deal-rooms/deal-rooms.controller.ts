import { Role } from '@cvc/shared';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { type AccessPayload, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  AddDealRoomMemberInput,
  addDealRoomMemberSchema,
  ListDealRoomMessagesInput,
  listDealRoomMessagesSchema,
  MarkDealRoomReadInput,
  markDealRoomReadSchema,
  SendDealRoomMessageInput,
  sendDealRoomMessageSchema,
} from './deal-rooms.dto';
import { DealRoomsService } from './deal-rooms.service';
import { DealRoomMessagesService } from './messages.service';

// P4.12 — Deal Room reads/administration. Routes are open to any authenticated
// role; the service enforces actual room membership (outsiders get 404).
@ApiTags('deal-rooms')
@Roles(
  Role.Buyer,
  Role.Participant,
  Role.Retailer,
  Role.Supplier,
  Role.Sales,
  Role.Inspector,
  Role.Admin,
)
@Controller('deal-rooms')
export class DealRoomsController {
  constructor(
    private readonly rooms: DealRoomsService,
    private readonly messages: DealRoomMessagesService,
  ) {}

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết phòng thương lượng (chỉ thành viên)' })
  detail(@CurrentUser() user: AccessPayload, @Param('id') id: string) {
    return this.rooms.getRoom(user, id);
  }

  @Get(':id/members')
  @ApiOperation({ summary: 'Danh sách thành viên phòng' })
  members(@CurrentUser() user: AccessPayload, @Param('id') id: string) {
    return this.rooms.listMembers(user, id);
  }

  @Post(':id/members')
  @Roles(Role.Sales, Role.Admin)
  @ApiOperation({ summary: 'Sales mời thêm thành viên vào phòng' })
  addMember(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addDealRoomMemberSchema)) body: AddDealRoomMemberInput,
  ) {
    return this.rooms.addMember(user, id, body);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'Tin nhắn phòng (phân trang cursor)' })
  listMessages(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(listDealRoomMessagesSchema)) query: ListDealRoomMessagesInput,
  ) {
    return this.messages.list(user, id, query);
  }

  @Post(':id/messages')
  @ApiOperation({ summary: 'Gửi tin nhắn (văn bản + tệp đính kèm)' })
  sendMessage(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(sendDealRoomMessageSchema)) body: SendDealRoomMessageInput,
  ) {
    return this.messages.send(user, id, body);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đánh dấu đã đọc tới một tin nhắn' })
  markRead(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(markDealRoomReadSchema)) body: MarkDealRoomReadInput,
  ) {
    return this.messages.markRead(user, id, body);
  }

  @Get(':id/attachments/:attachmentId/download')
  @ApiOperation({ summary: 'Tải tệp đính kèm (chỉ thành viên phòng)' })
  downloadAttachment(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.messages.downloadAttachment(user, id, attachmentId);
  }
}
