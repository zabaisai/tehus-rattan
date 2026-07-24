import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { WhatsAppIntegrationService } from '../whatsapp-integration/whatsapp-integration.service';
import { WhatsAppTokenCryptoService } from '../whatsapp-integration/whatsapp-token-crypto.service';
import { GRAPH_API_VERSION_FORMAT } from '../../common/config/env.validation';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private whatsappIntegrationService: WhatsAppIntegrationService,
    private tokenCryptoService: WhatsAppTokenCryptoService,
    private config: ConfigService,
  ) {}

  async sendMessage(
    companyId: string,
    to: string,
    message: string,
  ): Promise<string | undefined> {
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

    const graphVersion = this.resolveGraphApiVersion();
    const url = `https://graph.facebook.com/${graphVersion}/${integration.phoneNumberId}/messages`;

    try {
      const response = await axios.post(
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
      return response.data?.messages?.[0]?.id as string | undefined;
    } catch (error) {
      const status = axios.isAxiosError(error)
        ? error.response?.status
        : undefined;
      const details = axios.isAxiosError(error)
        ? error.response?.data
        : (error as Error)?.message;
      this.logger.error(
        `Error enviando mensaje de WhatsApp a ${to} (status: ${
          status ?? 'desconocido'
        }): ${JSON.stringify(details)}`,
      );
      throw new BadRequestException('No se pudo enviar el mensaje de WhatsApp');
    }
  }

  // The Graph API version is mandatory config with NO hardcoded fallback: the
  // operator must set a version verified against Meta's official docs. If it is
  // missing or malformed we refuse to call Meta and surface a controlled,
  // generic configuration error — never leaking the variable name or value.
  private resolveGraphApiVersion(): string {
    const version = this.config
      .get<string>('WHATSAPP_GRAPH_API_VERSION')
      ?.trim();

    if (!version || !GRAPH_API_VERSION_FORMAT.test(version)) {
      this.logger.error(
        'Versión de Graph API de WhatsApp no configurada o con formato inválido',
      );
      throw new InternalServerErrorException(
        'WhatsApp no está configurado correctamente',
      );
    }

    return version;
  }
}
