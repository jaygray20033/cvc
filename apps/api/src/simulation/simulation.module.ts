import { Module } from '@nestjs/common';

import { ClaimsModule } from '../claims/claims.module';
import { ProductionModule } from '../production/production.module';
import { ShipmentsModule } from '../shipments/shipments.module';
import { SimulationController } from './simulation.controller';
import { SimulationService } from './simulation.service';

// P4.21 — test/staging-only automation. Routes stay registered but every
// handler 404s unless ENABLE_SIMULATION=true (checked in the service).
@Module({
  imports: [ClaimsModule, ProductionModule, ShipmentsModule],
  controllers: [SimulationController],
  providers: [SimulationService],
})
export class SimulationModule {}
