import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  IsObject,
  IsNumber,
  IsIn,
} from 'class-validator';

export class UpdateAutomationDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @IsIn(['message_received', 'keyword', 'first_message'], {
    message: 'Disparador no válido',
  })
  trigger?: string;

  @IsOptional()
  @IsObject()
  conditions?: any;

  @IsOptional()
  @IsArray()
  actions?: any[];

  @IsOptional()
  @IsNumber()
  order?: number;
}
