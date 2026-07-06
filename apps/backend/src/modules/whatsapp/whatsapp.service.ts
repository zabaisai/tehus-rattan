import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { createDecipheriv, createHash } from 'node:crypto';
import { WhatsAppIntegrationService } from '../whatsapp-integration/whatsapp-integration.service';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private whatsappIntegrationService: WhatsAppIntegrationService,
    private configService: ConfigService,
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
      accessToken = this.decryptAccessToken(integration.accessTokenEncrypted);
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

  // accessTokenEncrypted format: "<ivHex>:<authTagHex>:<cipherTextHex>",
  // AES-256-GCM with a 12-byte IV, key = sha256(WHATSAPP_TOKEN_ENCRYPTION_KEY).
  private decryptAccessToken(accessTokenEncrypted: string): string {
    const rawKey = this.configService.get<string>(
      'WHATSAPP_TOKEN_ENCRYPTION_KEY',
    );

    if (!rawKey?.trim()) {
      throw new Error('WHATSAPP_TOKEN_ENCRYPTION_KEY no está configurada');
    }

    const [ivHex, authTagHex, cipherTextHex] =
      accessTokenEncrypted.split(':');

    if (!ivHex || !authTagHex || !cipherTextHex) {
      throw new Error('Formato de accessTokenEncrypted inválido');
    }

    const key = createHash('sha256').update(rawKey).digest();
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(ivHex, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(cipherTextHex, 'hex')),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }
}
