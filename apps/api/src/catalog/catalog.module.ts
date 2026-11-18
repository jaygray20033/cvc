import { Module } from '@nestjs/common';

import { SearchModule } from '../search/search.module';
import { AdminProductsController } from './admin-products.controller';
import { ProductsService } from './products.service';
import { PublicCatalogController } from './public-catalog.controller';
import { PublicCatalogService } from './public-catalog.service';

// Catalog module (P4A.1): admin product CRUD + public catalog + sourcing
// cases. SearchModule is not global, so it is imported for SearchService.
@Module({
  imports: [SearchModule],
  controllers: [AdminProductsController, PublicCatalogController],
  providers: [ProductsService, PublicCatalogService],
  exports: [PublicCatalogService],
})
export class CatalogModule {}
