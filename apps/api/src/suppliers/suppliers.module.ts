import { Module } from '@nestjs/common';

import { CatalogModule } from '../catalog/catalog.module';
import { SearchModule } from '../search/search.module';
import { AdminSuppliersController } from './admin-suppliers.controller';
import { SupplierPortalController } from './supplier-portal.controller';
import { SuppliersService } from './suppliers.service';

// Supplier portal + admin supplier accounts (P4.4/P4.5). PublicCatalogService
// comes from CatalogModule to bust the public cache on listing changes.
@Module({
  imports: [SearchModule, CatalogModule],
  controllers: [SupplierPortalController, AdminSuppliersController],
  providers: [SuppliersService],
})
export class SuppliersModule {}
