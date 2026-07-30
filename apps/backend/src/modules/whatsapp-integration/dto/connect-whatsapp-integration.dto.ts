import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ConnectWhatsAppIntegrationDto {
  @IsString()
  @IsNotEmpty({ message: 'phoneNumberId es requerido' })
  phoneNumberId!: string;

  @IsString()
  @IsNotEmpty({ message: 'accessToken es requerido' })
  accessToken!: string;

  @IsOptional()
  @IsString()
  displayPhoneNumber?: string;

  // Required (it used to be optional): the manual flow now validates that the
  // phoneNumberId really belongs to this WABA and subscribes the app to it, and
  // neither is possible without it.
  @IsString()
  @IsNotEmpty({ message: 'wabaId es requerido' })
  wabaId!: string;
}
