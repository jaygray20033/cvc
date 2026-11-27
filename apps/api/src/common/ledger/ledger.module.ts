import { Module } from '@nestjs/common';

import { AdminLedgerController } from './admin-ledger.controller';
import { ConservationService } from './conservation.service';
import { LedgerService } from './ledger.service';

// Shared by money flows (payments P4.19, payouts P4.20, claims P4.22, wallet
// P4.24) and by the finance read API / conservation checks (P4.23/P4.25).
@Module({
  controllers: [AdminLedgerController],
  providers: [LedgerService, ConservationService],
  exports: [LedgerService, ConservationService],
})
export class LedgerModule {}
