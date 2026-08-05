import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

class OrdenDePipeline {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  id!: string;

  @IsInt()
  @Min(0)
  order!: number;
}

export class ReordenarPipelinesDto {
  // Un tope alto pero real: sin el, una peticion con cien mil entradas se
  // convierte en cien mil escrituras dentro de una transaccion.
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => OrdenDePipeline)
  pipelines!: OrdenDePipeline[];
}
