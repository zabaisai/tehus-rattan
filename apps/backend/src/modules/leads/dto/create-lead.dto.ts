import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsDateString,
} from 'class-validator';

export class CreateLeadDto {
  @IsString()
  @IsNotEmpty({ message: 'El título del lead es requerido' })
  title!: string;

  @IsString()
  @IsNotEmpty({ message: 'El contacto es requerido' })
  contactId!: string;

  @IsString()
  @IsNotEmpty({ message: 'El pipeline es requerido' })
  pipelineId!: string;

  @IsString()
  @IsNotEmpty({ message: 'La etapa es requerida' })
  stageId!: string;

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
