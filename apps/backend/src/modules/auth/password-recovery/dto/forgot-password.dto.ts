import { Transform } from 'class-transformer';
import { IsEmail } from 'class-validator';

export class ForgotPasswordDto {
  // Trim before validating so a copy-pasted address with surrounding spaces is
  // accepted; the service additionally lowercases for the lookup.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail({}, { message: 'Correo inválido' })
  email!: string;
}
