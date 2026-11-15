import { Global, Module } from '@nestjs/common';

import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

// Notification engine (P2.18). Global so any domain service can emit events;
// MailService is global; channel providers (sms/zns/push) and BullMQ delivery
// land with P2.19/P5 integrations.
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
