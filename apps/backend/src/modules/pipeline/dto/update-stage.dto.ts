import {
  IsString,
  IsOptional,
  IsNumber,
  IsInt,
  IsIn,
  Min,
  Max,
  IsBoolean,
} from 'class-validator';

export class UpdateStageDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  order?: number;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  probability?: number;

  @IsOptional()
  @IsIn(['OPEN', 'WON', 'LOST'], {
    message: 'type debe ser OPEN, WON o LOST',
  })
  type?: 'OPEN' | 'WON' | 'LOST';

  /**
   * La etapa por la que entra un cliente nuevo.
   *
   * Se marca a mano y no se adivina por el nombre: llamarla «Nuevo lead» es
   * una costumbre, no una regla, y una empresa que llame a la suya «Primer
   * contacto» tiene el mismo derecho a que sus leads caigan donde toca.
   */
  @IsOptional()
  @IsBoolean()
  isInitial?: boolean;
}
