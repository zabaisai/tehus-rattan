import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { MapeoDeColumnas } from './mapeo-columnas';

export class SubirImportacionDto {
  /**
   * Reintentar la MISMA subida no arranca dos importaciones. Opcional: sin
   * ella, cada subida es una importacion nueva, que es lo que espera quien
   * sube dos archivos distintos seguidos.
   */
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey?: string;
}

class Campos {
  [campo: string]: number;
}

export class FijarMapeoDto {
  // Se valida como objeto y el CONTENIDO lo comprueba `validarMapeo`, que sabe
  // cuantas columnas tiene el archivo. `class-validator` no puede saberlo.
  @IsObject()
  mapeo!: MapeoDeColumnas;
}

export class LimiteDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  limite?: number;
}

export { Campos };
