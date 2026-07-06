import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import axios from 'axios';
import { WhatsAppIntegrationService } from '../whatsapp-integration/whatsapp-integration.service';
import { WhatsAppTokenCryptoService } from '../whatsapp-integration/whatsapp-token-crypto.service';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private whatsappIntegrationService: WhatsAppIntegrationService,
    private tokenCryptoService: WhatsAppTokenCryptoService,
  ) {}

  async sendMessage(
    companyId: string,
    to: string,
    message: string,
  ): Promise<void> {
    const integration =
      await this.whatsappIntegrationService.findConnectedByCompanyId(
        companyId,
      );

    if (!integration) {
      throw new NotFoundException('WhatsApp no conectado para esta empresa');
    }

    if (!integration.accessTokenEncrypted) {
      throw new NotFoundException('WhatsApp no conectado para esta empresa');
    }

    let accessToken: string;
    try {
      accessToken = this.tokenCryptoService.decrypt(
        integration.accessTokenEncrypted,
      );
    } catch {
      throw new BadRequestException(
        'No se pudo descifrar el token de WhatsApp de esta empresa',
      );
    }

    const url = `https://graph.facebook.com/v19.0/${integration.phoneNumberId}/messages`;

    try {
      await axios.post(
        url,
        {
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: message },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );
      this.logger.log(`Mensaje enviado a ${to}`);
    } catch (error) {
      this.logger.error(`Error enviando mensaje a ${to}`, error);
    }
  }
}
