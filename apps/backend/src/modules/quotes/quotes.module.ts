import { Module } from '@nestjs/common';
import { QuotesService } from './quotes.service';
import { QuotePdfService } from './quote-pdf.service';
import { QuotesController } from './quotes.controller';

@Module({
  controllers: [QuotesController],
  providers: [QuotesService, QuotePdfService],
  exports: [QuotesService, QuotePdfService],
})
export class QuotesModule {}
