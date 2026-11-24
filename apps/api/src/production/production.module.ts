import { Module } from '@nestjs/common';

import { OrdersModule } from '../orders/orders.module';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';

// P4.19 B — needs OrdersModule to auto-move PRODUCTION → QC on ready.
@Module({
  imports: [OrdersModule],
  controllers: [ProductionController],
  providers: [ProductionService],
  exports: [ProductionService],
})
export class ProductionModule {}
