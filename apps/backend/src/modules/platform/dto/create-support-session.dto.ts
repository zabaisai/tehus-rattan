import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateSupportSessionDto {
  @IsString()
  @IsNotEmpty({ message: 'companyId es requerido' })
  companyId!: string;

  @IsString()
  @IsNotEmpty({ message: 'reason es requerido' })
  @MaxLength(500, { message: 'reason no puede superar 500 caracteres' })
  reason!: string;
}
