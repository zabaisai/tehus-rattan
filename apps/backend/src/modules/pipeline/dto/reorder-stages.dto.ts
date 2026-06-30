import { IsArray, ValidateNested, IsString, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

class StageOrderItem {
  @IsString()
  id!: string;

  @IsNumber()
  order!: number;
}

export class ReorderStagesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StageOrderItem)
  stages!: StageOrderItem[];
}
