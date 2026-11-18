import { Global, Module } from '@nestjs/common';

import { FilesModule } from '../files/files.module';
import { SourcingModule } from '../sourcing/sourcing.module';
import { DistributedLockService } from './distributed-lock.service';
import { JobsAdminController } from './jobs-admin.controller';
import { QueueProcessor } from './queue.processor';
import { QueueService } from './queue.service';

// BullMQ queues + workers + admin API (P2.19). Global: business services can
// enqueue without importing this module. Workers start in every process that
// boots AppModule (api container, worker container, tests). FilesModule is
// imported for the file post-process handler.
@Global()
@Module({
  imports: [FilesModule, SourcingModule],
  controllers: [JobsAdminController],
  providers: [QueueService, DistributedLockService, QueueProcessor],
  exports: [QueueService, DistributedLockService],
})
export class QueueModule {}
