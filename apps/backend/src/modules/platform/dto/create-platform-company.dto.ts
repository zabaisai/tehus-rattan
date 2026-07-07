import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class CreatePlatformCompanyDto {
  @IsString()
  @IsNotEmpty({ message: 'companyName es requerido' })
  companyName!: string;

  @IsOptional()
  @IsString()
  companyPhone?: string;

  @IsString()
  @IsNotEmpty({ message: 'adminName es requerido' })
  adminName!: string;

  @IsEmail({}, { message: 'adminEmail no es válido' })
  adminEmail!: string;

  @IsString()
  @MinLength(6, { message: 'adminPassword debe tener al menos 6 caracteres' })
  adminPassword!: string;
}
