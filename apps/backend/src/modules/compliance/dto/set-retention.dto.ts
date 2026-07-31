import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { RETENCION_MINIMA_MESES } from '../compliance.service';

/**
 * `companyId` NO aparece: sale del token. Aceptarlo permitiria cambiar la
 * politica de retencion -y por tanto borrar datos- de otra empresa.
 */
export class SetRetentionDto {
  /** `null` = conservar indefinidamente, que es el valor por defecto. */
  @IsOptional()
  @IsInt()
  @Min(RETENCION_MINIMA_MESES)
  // 10 anos: por encima, el plazo no es una politica, es "nunca" escrito raro.
  @Max(120)
  retentionMonths?: number | null;

  @IsOptional()
  @IsBoolean()
  retentionPurgeEnabled?: boolean;
}
