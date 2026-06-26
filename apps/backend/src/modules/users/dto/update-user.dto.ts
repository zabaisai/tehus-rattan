import { IsString, IsOptional, IsIn, IsBoolean } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  @IsIn(['ADMIN', 'AGENT'], { message: 'Rol no válido' })
  role?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
