import {
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateInvitationCodeDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la empresa invitada es requerido' })
  intendedCompanyName!: string;

  @IsOptional()
  @IsEmail({}, { message: 'El correo de contacto no es válido' })
  intendedContactEmail?: string;

  @IsOptional()
  @IsDateString({}, { message: 'La fecha de vencimiento no es válida' })
  expiresAt?: string;
}
