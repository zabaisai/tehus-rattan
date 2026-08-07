import { IsString, IsOptional, IsDateString } from 'class-validator';
import { EconomiaDeCotizacionDto } from './economia-cotizacion.dto';

/**
 * Hereda los campos economicos en vez de repetirlos.
 *
 * Repetirlos es como empezo este defecto: el dominio soportaba transporte,
 * impuesto y ajuste, y los DTO se quedaron atras porque eran otra lista escrita
 * a mano. Una sola definicion no puede desviarse de si misma.
 */
export class CreateQuoteFromLeadDto extends EconomiaDeCotizacionDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsDateString({}, { message: 'La fecha de vigencia no es válida' })
  validUntil?: string;
}
