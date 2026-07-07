import { IsEnum, IsNotEmpty } from 'class-validator';
import { CompanyStatus } from '@prisma/client';

export class UpdatePlatformCompanyStatusDto {
  @IsNotEmpty({ message: 'status es requerido' })
  @IsEnum(CompanyStatus, {
    message: 'status debe ser ACTIVE, SUSPENDED o DELETED',
  })
  status!: CompanyStatus;
}
