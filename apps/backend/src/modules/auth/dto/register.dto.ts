import { IsEmail, IsString, IsNotEmpty, IsOptional, MinLength } from 'class-validator';

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
  @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres' })
  password!: string;

  // Read directly off the raw request by OnboardingInviteGuard, not off this
  // validated instance — declared here only so ValidationPipe's
  // forbidNonWhitelisted doesn't reject a body that includes it.
  @IsOptional()
  @IsString()
  inviteCode?: string;
}
