import { Module } from '@nestjs/common';

import { LedgerModule } from '../common/ledger/ledger.module';
import { AdminPayoutsController } from './admin-payouts.controller';
import { PayoutsController } from './payouts.controller';
import { PayoutsService } from './payouts.service';

// P4.20 — manual supplier payouts. LedgerModule posts the double entry once on
// mark-paid; Notifications/Realtime/Prisma are global.
@Module({
  imports: [LedgerModule],
  controllers: [AdminPayoutsController, PayoutsController],
  providers: [PayoutsService],
  exports: [PayoutsService],
})
export class PayoutsModule {}
