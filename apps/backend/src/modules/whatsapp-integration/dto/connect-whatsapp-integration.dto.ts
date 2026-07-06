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

  @IsOptional()
  @IsString()
  wabaId?: string;
}
