import { IsString, IsOptional, IsDateString, IsEnum } from 'class-validator';
import { QuoteStatus } from '@prisma/client';
import { EconomiaDeCotizacionDto } from './economia-cotizacion.dto';

export class UpdateQuoteDto extends EconomiaDeCotizacionDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsEnum(QuoteStatus, {
    message: 'status debe ser DRAFT, SENT, ACCEPTED, REJECTED o EXPIRED',
  })
  status?: QuoteStatus;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsDateString({}, { message: 'La fecha de vigencia no es válida' })
  validUntil?: string;
}
