import { Module } from '@nestjs/common';

import { LedgerModule } from '../common/ledger/ledger.module';
import { FilesModule } from '../files/files.module';
import { WalletModule } from '../wallet/wallet.module';
import { AdminWithdrawalsController } from './admin-withdrawals.controller';
import { WithdrawalsController } from './withdrawals.controller';
import { WithdrawalsService } from './withdrawals.service';

// P4.26 — user withdrawals. WalletModule owns the hold/release/capture
// primitives; LedgerModule provides conservation checks; FilesModule exports
// S3Service for the payout-proof presigned link. Notifications/Settings/Prisma
// are global.
@Module({
  imports: [WalletModule, LedgerModule, FilesModule],
  controllers: [WithdrawalsController, AdminWithdrawalsController],
  providers: [WithdrawalsService],
  exports: [WithdrawalsService],
})
export class WithdrawalsModule {}
