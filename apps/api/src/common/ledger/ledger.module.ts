import { Module } from '@nestjs/common';

import { LedgerService } from './ledger.service';

// Shared by the money flows (payments P4.19, supplier payouts P4.20).
@Module({
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
