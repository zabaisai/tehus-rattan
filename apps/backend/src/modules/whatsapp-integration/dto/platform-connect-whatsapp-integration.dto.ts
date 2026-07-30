import { IsNotEmpty, IsString } from 'class-validator';
import { ConnectWhatsAppIntegrationDto } from './connect-whatsapp-integration.dto';

// Same payload as the in-company manual connection, plus the support session
// the SUPER_ADMIN is acting under. The session is NOT trusted as sent: the
// server re-reads it, checks it is ACTIVE, unexpired and owned by the caller,
// and that its companyId matches the company in the route.
//
// Deliberately no companyId field: the target company travels in the URL path
// and is cross-checked against the session, so a body value could never widen
// the blast radius.
export class PlatformConnectWhatsAppIntegrationDto extends ConnectWhatsAppIntegrationDto {
  @IsString()
  @IsNotEmpty({ message: 'supportSessionId es requerido' })
  supportSessionId!: string;
}
