import { IsString, IsIn, IsOptional, ValidateIf } from 'class-validator';

export class ChangeStatusDto {
  @IsString()
  @IsIn(['WON', 'LOST'], { message: 'El estado debe ser WON o LOST' })
  status!: 'WON' | 'LOST';

  @ValidateIf((o) => o.status === 'LOST')
  @IsString()
  @IsOptional()
  lostReason?: string;
}
