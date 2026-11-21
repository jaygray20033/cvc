import { Module } from '@nestjs/common';

import { OrderSamplesController } from './order-samples.controller';
import { SamplesController } from './samples.controller';
import { SamplesService } from './samples.service';

// P4.17 — production samples, manual carrier tracking and revision rounds.
@Module({
  controllers: [OrderSamplesController, SamplesController],
  providers: [SamplesService],
  exports: [SamplesService],
})
export class SamplesModule {}
