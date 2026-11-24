import { Module } from '@nestjs/common';

import { LedgerModule } from '../common/ledger/ledger.module';
import { AdminPaymentsController } from './admin-payments.controller';
import { OrderPaymentsController, PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

// P4.19 A — manual P2P payments. Notifications/Realtime/Prisma are global.
@Module({
  imports: [LedgerModule],
  controllers: [OrderPaymentsController, PaymentsController, AdminPaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
