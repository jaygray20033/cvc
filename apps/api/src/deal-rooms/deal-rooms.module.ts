import { Module } from '@nestjs/common';

import { FilesModule } from '../files/files.module';
import { DealRoomsController } from './deal-rooms.controller';
import { DealRoomsService } from './deal-rooms.service';
import { DealRoomMessagesService } from './messages.service';

// P4.12/P4.13 — private Deal Room reads, member invitations and chat.
// Prisma/Realtime/Redis are global; FilesModule provides the attachment gate.
@Module({
  imports: [FilesModule],
  controllers: [DealRoomsController],
  providers: [DealRoomsService, DealRoomMessagesService],
  exports: [DealRoomsService, DealRoomMessagesService],
})
export class DealRoomsModule {}
