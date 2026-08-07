import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class EnviarCotizacionDto {
  /**
   * OBLIGATORIA. Reintentar un envio —porque la red fallo, porque alguien
   * pulso dos veces— no puede mandarle al cliente la misma cotizacion dos
   * veces. La genera quien llama y se conserva en la fila.
   */
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey!: string;
}

export class DecisionCotizacionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}
