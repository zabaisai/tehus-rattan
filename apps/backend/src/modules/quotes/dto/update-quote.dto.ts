import { IsString, IsOptional, IsNumber, IsDateString, IsEnum, Min } from 'class-validator';
import { QuoteStatus } from '@prisma/client';

export class UpdateQuoteDto {
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

  @IsOptional()
  @IsNumber({}, { message: 'El descuento debe ser un número' })
  @Min(0, { message: 'El descuento no puede ser negativo' })
  discount?: number;
}
