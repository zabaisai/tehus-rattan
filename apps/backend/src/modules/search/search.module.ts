import { Module } from '@nestjs/common';
import { CompaniesModule } from '../companies/companies.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [CompaniesModule],
  controllers: [SearchController],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
