import { Module } from '@nestjs/common';

import { LedgerModule } from '../common/ledger/ledger.module';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

// P4.24 — wallet read APIs + guarded debit/hold primitives used by withdrawals.
@Module({
  imports: [LedgerModule],
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
