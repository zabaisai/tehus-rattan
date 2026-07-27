import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

// Payload the browser posts to finish the Meta Embedded Signup flow.
// Everything here is untrusted client input: the `state` is validated against
// the single-use server record, and the `code` is exchanged server-side (never
// trusted as a token). Meta object IDs are numeric strings; validate their
// shape strictly. The DTO is whitelisted (ValidationPipe forbidNonWhitelisted),
// so `companyId`, `status`, tokens, etc. can never be injected from the client.
export class EmbeddedSignupCompleteDto {
  // 32 random bytes, hex-encoded (see WhatsAppEmbeddedSignupStateService).
  @IsString()
  @Matches(/^[a-f0-9]{64}$/, { message: 'state inválido' })
  state!: string;

  // Opaque, short-lived (30s) exchangeable code returned by FB.login.
  @IsString()
  @IsNotEmpty({ message: 'code es requerido' })
  @MaxLength(2048)
  code!: string;

  @IsString()
  @Matches(/^\d{1,32}$/, { message: 'phoneNumberId inválido' })
  phoneNumberId!: string;

  @IsString()
  @Matches(/^\d{1,32}$/, { message: 'wabaId inválido' })
  wabaId!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{1,32}$/, { message: 'businessId inválido' })
  businessId?: string;
}
