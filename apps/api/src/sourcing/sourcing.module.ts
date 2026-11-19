import { Module } from '@nestjs/common';

import { AdminConciergeController } from './admin-concierge.controller';
import { AdminSourcingController } from './admin-sourcing.controller';
import { BuyerSourcingController } from './buyer-sourcing.controller';
import { ConciergeService } from './concierge.service';
import { QuoteSelectionService } from './quote-selection.service';
import { SourcingRequestsService } from './sourcing-requests.service';
import { SupplierQuotesController } from './supplier-quotes.controller';
import { SupplierQuotesService } from './supplier-quotes.service';

// RFQ + sales intake + supplier quoting + selection + CVC concierge
// (P4.7–P4.11). NotificationsService is global.
@Module({
  controllers: [
    BuyerSourcingController,
    AdminSourcingController,
    SupplierQuotesController,
    AdminConciergeController,
  ],
  providers: [
    SourcingRequestsService,
    SupplierQuotesService,
    QuoteSelectionService,
    ConciergeService,
  ],
  exports: [SourcingRequestsService],
})
export class SourcingModule {}
