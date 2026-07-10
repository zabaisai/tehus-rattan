import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsImportService } from './products-import.service';
import { ProductsController } from './products.controller';

@Module({
  controllers: [ProductsController],
  providers: [ProductsService, ProductsImportService],
  exports: [ProductsService],
})
export class ProductsModule {}
