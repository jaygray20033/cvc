import { Module } from '@nestjs/common';

import { FilesModule } from '../files/files.module';
import { DealRoomsController } from './deal-rooms.controller';
import { DealRoomsService } from './deal-rooms.service';
import { MessagesController } from './messages.controller';
import { DealRoomMessagesService } from './messages.service';
import { OffersController } from './offers.controller';
import { OffersService } from './offers.service';
import { StubTranslationProvider, TRANSLATION_PROVIDER } from './translation.provider';
import { TranslationsService } from './translations.service';

// P4.12–P4.15 — private Deal Room reads, invitations, chat, message
// translation, offers/counter-offers and locked terms.
// Prisma/Realtime/Redis/Settings are global; FilesModule provides the
// attachment gate. P5.22 swaps the TRANSLATION_PROVIDER binding.
@Module({
  imports: [FilesModule],
  controllers: [DealRoomsController, MessagesController, OffersController],
  providers: [
    DealRoomsService,
    DealRoomMessagesService,
    OffersService,
    TranslationsService,
    { provide: TRANSLATION_PROVIDER, useClass: StubTranslationProvider },
  ],
  exports: [DealRoomsService, DealRoomMessagesService, OffersService, TranslationsService],
})
export class DealRoomsModule {}
