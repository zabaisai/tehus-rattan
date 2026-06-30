import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsObject,
  IsNumber,
  IsIn,
} from 'class-validator';

export class CreateAutomationDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre es requerido' })
  name!: string;

  @IsString()
  @IsIn(['message_received', 'keyword', 'first_message'], {
    message: 'Disparador no válido',
  })
  trigger!: string;

  @IsOptional()
  @IsObject()
  conditions?: any;

  @IsArray({ message: 'Las acciones deben ser una lista' })
  actions!: any[];

  @IsOptional()
  @IsNumber()
  order?: number;
}
