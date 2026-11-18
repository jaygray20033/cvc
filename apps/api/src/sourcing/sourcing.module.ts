import { Module } from '@nestjs/common';

import { AdminSourcingController } from './admin-sourcing.controller';
import { BuyerSourcingController } from './buyer-sourcing.controller';
import { SourcingRequestsService } from './sourcing-requests.service';

// RFQ + sales intake (P4.7/P4.8). NotificationsService is global.
@Module({
  controllers: [BuyerSourcingController, AdminSourcingController],
  providers: [SourcingRequestsService],
  exports: [SourcingRequestsService],
})
export class SourcingModule {}
