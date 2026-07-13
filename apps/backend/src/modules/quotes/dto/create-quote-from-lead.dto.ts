import { IsString, IsOptional, IsNumber, IsDateString, Min } from 'class-validator';

export class CreateQuoteFromLeadDto {
  @IsOptional()
  @IsString()
  title?: string;

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
