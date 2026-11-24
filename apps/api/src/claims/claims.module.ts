import { Module } from '@nestjs/common';

import { LedgerModule } from '../common/ledger/ledger.module';
import { AdminClaimsController } from './admin-claims.controller';
import { ClaimsController, OrderClaimsController } from './claims.controller';
import { ClaimsService } from './claims.service';

// P4.22 — claims, evidence, returns and ledger-backed refunds.
// Notifications/Realtime/Prisma/Settings are global.
@Module({
  imports: [LedgerModule],
  controllers: [OrderClaimsController, ClaimsController, AdminClaimsController],
  providers: [ClaimsService],
  exports: [ClaimsService],
})
export class ClaimsModule {}
