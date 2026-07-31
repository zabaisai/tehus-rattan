import {
  IsString,
  IsOptional,
  IsNumber,
  IsInt,
  IsIn,
  Min,
  Max,
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
}
