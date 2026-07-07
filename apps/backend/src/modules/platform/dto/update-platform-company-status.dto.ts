import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { CompanyStatus } from '@prisma/client';

export class UpdatePlatformCompanyStatusDto {
  @IsNotEmpty({ message: 'status es requerido' })
  @IsEnum(CompanyStatus, {
    message: 'status debe ser ACTIVE, SUSPENDED o DELETED',
  })
  status!: CompanyStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'reason no puede superar 500 caracteres' })
  reason?: string;
}
