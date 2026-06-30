import { IsString, IsOptional, IsNumber, IsDateString } from 'class-validator';

export class UpdateLeadDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsNumber()
  value?: number;

  @IsOptional()
  @IsDateString({}, { message: 'La fecha probable de cierre no es válida' })
  expectedCloseDate?: string;

  @IsOptional()
  @IsString()
  assignedTo?: string;
}
