import { Module } from '@nestjs/common';

import { OrdersModule } from '../orders/orders.module';
import { OrderShipmentsController, ShipmentsController } from './shipments.controller';
import { ShipmentsService } from './shipments.service';

// P4.19 C/D — OrdersModule supplies the SHIPPING → RECEIVED transition.
@Module({
  imports: [OrdersModule],
  controllers: [OrderShipmentsController, ShipmentsController],
  providers: [ShipmentsService],
  exports: [ShipmentsService],
})
export class ShipmentsModule {}
