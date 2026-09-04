import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { CHALLENGE_CODE_LENGTH } from '../device-verification/device-verification.constants';

/**
 * Verificación del reto de dispositivo.
 *
 * No acepta `userId`, `email`, `companyId` ni nada que identifique a la
 * persona: la cuenta se deduce del reto, que solo existe porque alguien
 * acertó la contraseña. Con la whitelist global, cualquier clave extra hace
 * fallar la petición con 400 antes de tocar la base.
 */
export class VerifyDeviceDto {
  @IsString()
  @IsNotEmpty({ message: 'Falta el identificador de la verificación' })
  @MaxLength(64)
  challengeId!: string;

  // Solo dígitos y longitud exacta. Se recortan espacios porque pegar el
  // código desde el correo suele arrastrarlos.
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/\s+/g, '') : value,
  )
  @IsString()
  @Matches(new RegExp(`^\\d{${CHALLENGE_CODE_LENGTH}}$`), {
    message: `El código son ${CHALLENGE_CODE_LENGTH} dígitos`,
  })
  code!: string;

  /**
   * Recordar este dispositivo. Ausente significa NO: confiar es una decisión
   * explícita de la persona, nunca un valor por defecto del cliente.
   */
  @IsOptional()
  @IsBoolean()
  trustDevice?: boolean;
}

/** Reenvío del código del reto en curso. */
export class ResendDeviceVerificationDto {
  @IsString()
  @IsNotEmpty({ message: 'Falta el identificador de la verificación' })
  @MaxLength(64)
  challengeId!: string;
}
