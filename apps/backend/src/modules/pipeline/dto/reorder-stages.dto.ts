import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { STAGE_LIMITS } from '../../companies/company-settings';

class StageOrderItem {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  id!: string;

  @IsInt()
  @Min(0)
  order!: number;
}

/**
 * Orden COMPLETO del embudo: todas sus etapas, cada una con su posición. El
 * servicio exige que sean exactamente las del embudo y que las posiciones
 * sean 0..n-1 sin huecos.
 */
export class ReorderStagesDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'El orden debe incluir las etapas del pipeline' })
  @ArrayMaxSize(STAGE_LIMITS.maxCount)
  @ValidateNested({ each: true })
  @Type(() => StageOrderItem)
  stages!: StageOrderItem[];
}
