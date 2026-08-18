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
import { maskPhone } from '../../common/logging/redact';
import { ModoDemoService } from '../../common/demo/modo-demo.service';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private whatsappIntegrationService: WhatsAppIntegrationService,
    private tokenCryptoService: WhatsAppTokenCryptoService,
    private config: ConfigService,
    private readonly modoDemo: ModoDemoService,
  ) {}

  // `fromPhoneNumberId` permite al asesor elegir desde que numero responde
  // cuando la empresa tiene varios. Omitirlo usa la integracion PRINCIPAL, no
  // una cualquiera: el desempate vive en findConnectedByCompanyId.
  //
  // El numero indicado se resuelve SIEMPRE acotado a la empresa del contexto,
  // de modo que un phoneNumberId de otro tenant nunca pueda usarse para
  // enviar en su nombre.
  /**
   * Envia respondiendo POR DONDE ENTRO la conversacion.
   *
   * Existe para que ningun automatismo tenga que acordarse de resolver el
   * numero. Un chatbot o una automatizacion que llame a `sendMessage` a secas
   * contesta desde el principal, y con varios numeros eso significa que el
   * cliente que escribio a Soporte recibe la respuesta desde Ventas.
   */
  async sendFromConversation(
    companyId: string,
    conversationId: string,
    to: string,
    message: string,
  ): Promise<string | undefined> {
    const desde =
      await this.whatsappIntegrationService.findPhoneNumberIdForConversation(
        companyId,
        conversationId,
      );
    return this.sendMessage(companyId, to, message, desde);
  }

  async sendMessage(
    companyId: string,
    to: string,
    message: string,
    fromPhoneNumberId?: string,
  ): Promise<string | undefined> {
    // MODO DEMO: se corta ANTES de resolver la integracion y de descifrar
    // ningun token. Este es el unico camino de salida del CRM hacia Meta
    // —respuesta manual del asesor, chatbot y automatizaciones pasan por
    // aqui—, asi que basta con cerrarlo una vez. No depende de las banderas
    // de entorno: pregunta por la EMPRESA.
    await this.modoDemo.bloquearSiDemo(companyId, 'enviar un WhatsApp');

    const integration = fromPhoneNumberId
      ? await this.whatsappIntegrationService.findConnectedByCompanyAndPhoneNumberId(
          companyId,
          fromPhoneNumberId,
        )
      : await this.whatsappIntegrationService.findConnectedByCompanyId(
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
      this.logger.log(`Mensaje enviado a ${maskPhone(to)}`);
      return response.data?.messages?.[0]?.id as string | undefined;
    } catch (error) {
      const status = axios.isAxiosError(error)
        ? error.response?.status
        : undefined;
      const details = axios.isAxiosError(error)
        ? error.response?.data
        : (error as Error)?.message;
      // Diagnostico util SIN PII: el telefono va enmascarado y de la respuesta
      // de Meta se extrae solo el mensaje de error, no el cuerpo entero. El
      // payload completo puede incluir datos del destinatario, y serializarlo
      // era el hallazgo de privacidad de la auditoria.
      const metaMessage =
        typeof details === 'string'
          ? details
          : ((details as { error?: { message?: string } })?.error?.message ??
            'sin detalle');

      this.logger.error(
        `Error enviando mensaje de WhatsApp a ${maskPhone(to)} (status: ${
          status ?? 'desconocido'
        }): ${String(metaMessage).slice(0, 200)}`,
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
