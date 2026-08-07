import { Module } from '@nestjs/common';
import { QuotesService } from './quotes.service';
import { QuotePdfService } from './quote-pdf.service';
import { QuoteCicloService } from './quote-ciclo.service';
import { QuotesController } from './quotes.controller';

@Module({
  controllers: [QuotesController],
  providers: [QuotesService, QuotePdfService, QuoteCicloService],
  exports: [QuotesService, QuotePdfService, QuoteCicloService],
})
export class QuotesModule {}
