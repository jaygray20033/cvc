import { Global, Module } from '@nestjs/common';

import { LedgerModule } from '../common/ledger/ledger.module';
import { FilesModule } from '../files/files.module';
import { PaymentsModule } from '../payments/payments.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { ShipmentsModule } from '../shipments/shipments.module';
import { SourcingModule } from '../sourcing/sourcing.module';
import { DistributedLockService } from './distributed-lock.service';
import { JobsAdminController } from './jobs-admin.controller';
import { QueueProcessor } from './queue.processor';
import { QueueService } from './queue.service';

// BullMQ queues + workers + admin API (P2.19). Global: business services can
// enqueue without importing this module. Workers start in every process that
// boots AppModule (api container, worker container, tests). FilesModule is
// imported for the file post-process handler, LedgerModule for P4.25.
@Global()
@Module({
  imports: [
    FilesModule,
    SourcingModule,
    PaymentsModule,
    ShipmentsModule,
    PayoutsModule,
    LedgerModule,
  ],
  controllers: [JobsAdminController],
  providers: [QueueService, DistributedLockService, QueueProcessor],
  exports: [QueueService, DistributedLockService],
})
export class QueueModule {}
