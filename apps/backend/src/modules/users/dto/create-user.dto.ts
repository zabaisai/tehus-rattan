import {
  IsString,
  IsNotEmpty,
  IsEmail,
  IsOptional,
  IsIn,
} from 'class-validator';
import { IsStrongPassword } from '../../../common/password/password-policy';

export class CreateUserDto {
  @IsEmail({}, { message: 'El email no es válido' })
  email!: string;

  @IsString()
  @IsStrongPassword()
  password!: string;

  @IsString()
  @IsNotEmpty({ message: 'El nombre es requerido' })
  name!: string;

  @IsOptional()
  @IsString()
  @IsIn(['ADMIN', 'AGENT'], { message: 'Rol no válido' })
  role?: string;
}
