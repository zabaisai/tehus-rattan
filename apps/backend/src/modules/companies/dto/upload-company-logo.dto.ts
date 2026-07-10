import { IsIn, IsOptional } from 'class-validator';

export class UploadCompanyLogoDto {
  @IsOptional()
  @IsIn(['primary', 'secondary'], {
    message: 'type debe ser "primary" o "secondary"',
  })
  type?: 'primary' | 'secondary';
}
