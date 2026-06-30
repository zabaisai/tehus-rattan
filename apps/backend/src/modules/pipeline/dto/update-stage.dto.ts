import { IsString, IsOptional, IsNumber } from 'class-validator';

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
}
