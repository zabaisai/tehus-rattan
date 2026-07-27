import { IsEmail, IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { IsStrongPassword } from '../../../common/password/password-policy';

export class RegisterDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la empresa es requerido' })
  companyName!: string;

  @IsString()
  @IsNotEmpty({ message: 'El nombre es requerido' })
  name!: string;

  @IsEmail({}, { message: 'El email no es válido' })
  email!: string;

  @IsString()
  @IsStrongPassword()
  password!: string;

  // Read directly off the raw request by OnboardingInviteGuard, not off this
  // validated instance — declared here only so ValidationPipe's
  // forbidNonWhitelisted doesn't reject a body that includes it.
  @IsOptional()
  @IsString()
  inviteCode?: string;
}
