import { Module } from '@nestjs/common';

import { AdminSourcingController } from './admin-sourcing.controller';
import { BuyerSourcingController } from './buyer-sourcing.controller';
import { QuoteSelectionService } from './quote-selection.service';
import { SourcingRequestsService } from './sourcing-requests.service';
import { SupplierQuotesController } from './supplier-quotes.controller';
import { SupplierQuotesService } from './supplier-quotes.service';

// RFQ + sales intake + supplier quoting + selection (P4.7–P4.10).
// NotificationsService is global.
@Module({
  controllers: [BuyerSourcingController, AdminSourcingController, SupplierQuotesController],
  providers: [SourcingRequestsService, SupplierQuotesService, QuoteSelectionService],
  exports: [SourcingRequestsService],
})
export class SourcingModule {}
