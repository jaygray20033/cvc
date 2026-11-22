import { Module } from '@nestjs/common';

import { CustomerInfoController } from './customer-info.controller';
import { CustomerInfoService } from './customer-info.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

// P4.16 — order state machine API. P4.18 adds the legal customer snapshot.
// Notifications/Realtime/Prisma are global.
@Module({
  controllers: [OrdersController, CustomerInfoController],
  providers: [OrdersService, CustomerInfoService],
  exports: [OrdersService, CustomerInfoService],
})
export class OrdersModule {}
