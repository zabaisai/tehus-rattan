import { IsNotEmpty, IsString } from 'class-validator';
import { IsStrongPassword } from '../../../../common/password/password-policy';

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'El token es requerido' })
  token!: string;

  @IsString()
  @IsStrongPassword()
  password!: string;

  @IsString()
  @IsNotEmpty({ message: 'Confirma la contraseña' })
  passwordConfirmation!: string;
}
