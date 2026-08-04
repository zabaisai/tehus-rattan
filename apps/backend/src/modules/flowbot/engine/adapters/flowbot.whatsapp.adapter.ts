import { Logger } from '@nestjs/common';
import { MessageType } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { WhatsAppTokenCryptoService } from '../../../whatsapp-integration/whatsapp-token-crypto.service';
import { PuertoMensajeria } from '../flowbot.ports';
import {
  RespuestaEnvio,
  TransporteWhatsApp,
  esReintentable,
  requiereAtencionHumana,
} from './flowbot.whatsapp.transport';

/**
 * Adaptador REAL de WhatsApp para FlowBot.
 *
 * Todo lo que no es «hablar con Meta» vive aquí y se prueba igual con el
 * transporte real que con el falso: resolver desde qué número sale, comprobar
 * la ventana de 24 h, no repetir un envío, persistir el mensaje en el hilo,
 * y clasificar el fallo para que el motor sepa si reintentar.
 *
 * EL `companyId` SE FIJA EN EL CONSTRUCTOR, igual que en el adaptador de CRM.
 * Un nodo no puede pedir que se envíe en nombre de otra empresa porque no
 * tiene forma de indicar cuál.
 *
 * NO REGISTRA NI TOKENS, NI EL APP SECRET, NI EL TELÉFONO COMPLETO, NI EL
 * CUERPO DEL MENSAJE. Los logs de un motor de bots se leen en soporte y se
 * envían a agregadores; lo que entre ahí sale del perímetro del CRM.
 */

/** Un fallo de envío que el motor debe poder clasificar. */
export class ErrorDeEnvio extends Error {
  constructor(
    readonly errorCode: string,
    readonly clase: 'externo_transitorio' | 'externo_definitivo' | 'atencion',
  ) {
    super(errorCode);
    this.name = 'ErrorDeEnvio';
  }
}

/** Cuánto dura la ventana de servicio de Meta. */
export const VENTANA_MS = 24 * 60 * 60_000;

export class WhatsappAdapter implements PuertoMensajeria {
  private readonly logger = new Logger(WhatsappAdapter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly companyId: string,
    private readonly transporte: TransporteWhatsApp,
    private readonly cripto: WhatsAppTokenCryptoService,
  ) {}

  // ── ventana de servicio ─────────────────────────────────────

  /**
   * ¿Se puede escribir texto libre ahora?
   *
   * La ventana se mide desde el ÚLTIMO MENSAJE ENTRANTE, no desde el último
   * mensaje de la conversación. Contarla desde uno saliente la mantendría
   * abierta para siempre: cada respuesta del bot renovaría su propio permiso.
   */
  async dentroDeVentana(input: { conversationId: string }): Promise<boolean> {
    const ultimo = await this.prisma.message.findFirst({
      where: {
        conversationId: input.conversationId,
        direction: 'INBOUND',
        conversation: { companyId: this.companyId },
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (!ultimo) return false;
    return Date.now() - ultimo.createdAt.getTime() < VENTANA_MS;
  }

  // ── envíos ──────────────────────────────────────────────────

  async enviarTexto(input: {
    conversationId: string;
    texto: string;
    idempotencyKey: string;
  }): Promise<{ wamid?: string }> {
    return this.enviar({
      conversationId: input.conversationId,
      idempotencyKey: input.idempotencyKey,
      tipo: 'TEXT',
      cuerpoMeta: { type: 'text', text: { body: input.texto } },
      cuerpoCrm: input.texto,
      exigeVentana: true,
    });
  }

  /**
   * Plantilla aprobada. NO exige ventana: es justo lo que se puede mandar
   * fuera de ella, y bloquearlo dejaría al cliente sin la única vía que Meta
   * permite para retomar el contacto.
   */
  async enviarPlantilla(input: {
    conversationId: string;
    plantilla: string;
    parametros: string[];
    idempotencyKey: string;
  }): Promise<{ wamid?: string }> {
    const componentes =
      input.parametros.length > 0
        ? [
            {
              type: 'body',
              parameters: input.parametros.map((p) => ({
                type: 'text',
                text: p,
              })),
            },
          ]
        : [];

    return this.enviar({
      conversationId: input.conversationId,
      idempotencyKey: input.idempotencyKey,
      tipo: 'TEMPLATE',
      cuerpoMeta: {
        type: 'template',
        template: {
          name: input.plantilla,
          // El idioma sale de la empresa, no del nodo: una plantilla aprobada
          // en `es` no existe en `en` y el envío fallaría con un código que
          // nadie sabría interpretar.
          language: { code: this.idiomaPlantillas() },
          ...(componentes.length > 0 ? { components: componentes } : {}),
        },
      },
      cuerpoCrm: `[plantilla:${input.plantilla}]`,
      exigeVentana: false,
    });
  }

  async enviarMedio(input: {
    conversationId: string;
    tipo: 'image' | 'document' | 'audio' | 'video';
    url: string;
    caption?: string;
    filename?: string;
    idempotencyKey: string;
  }): Promise<{ wamid?: string }> {
    // Solo HTTPS: Meta descarga el archivo desde esa URL, así que una `http`
    // expondría el contenido en claro por la red y una URL interna sería una
    // petición desde la infraestructura de Meta a nuestra red privada.
    if (!/^https:\/\//i.test(input.url)) {
      throw new ErrorDeEnvio('medio-url-insegura', 'externo_definitivo');
    }

    const medio: Record<string, unknown> = { link: input.url };
    if (input.caption && input.tipo !== 'audio') medio.caption = input.caption;
    if (input.filename && input.tipo === 'document') {
      medio.filename = input.filename;
    }

    const tipos: Record<string, MessageType> = {
      image: 'IMAGE',
      document: 'DOCUMENT',
      audio: 'AUDIO',
      video: 'VIDEO',
    };

    return this.enviar({
      conversationId: input.conversationId,
      idempotencyKey: input.idempotencyKey,
      tipo: tipos[input.tipo],
      cuerpoMeta: { type: input.tipo, [input.tipo]: medio },
      cuerpoCrm: input.caption ?? '',
      exigeVentana: true,
    });
  }

  /**
   * Botones o lista.
   *
   * LOS LÍMITES SON DE META Y SE APLICAN AQUÍ: 3 botones, 10 filas por lista,
   * 20 caracteres por título. Superarlos produce un rechazo con un código que
   * no dice cuál de los tres fue, así que se recorta y se avisa antes de
   * salir. Con más de 3 opciones se cambia a lista automáticamente en vez de
   * perder las que sobran.
   */
  async enviarOpciones(input: {
    conversationId: string;
    texto: string;
    opciones: string[];
    formato: 'buttons' | 'list';
    idempotencyKey: string;
  }): Promise<{ wamid?: string }> {
    const opciones = input.opciones.filter((o) => o && o.trim());
    if (opciones.length === 0) {
      throw new ErrorDeEnvio('menu-sin-opciones', 'externo_definitivo');
    }

    const formato =
      input.formato === 'buttons' && opciones.length > 3
        ? 'list'
        : input.formato;
    if (formato !== input.formato) {
      this.logger.warn(
        `Menú de ${opciones.length} opciones convertido a lista: Meta admite 3 botones`,
      );
    }

    const recortar = (s: string, n: number) =>
      s.length > n ? `${s.slice(0, n - 1)}…` : s;

    const interactive =
      formato === 'buttons'
        ? {
            type: 'button',
            body: { text: recortar(input.texto, 1024) },
            action: {
              buttons: opciones.slice(0, 3).map((o, i) => ({
                type: 'reply',
                reply: { id: `op_${i}`, title: recortar(o, 20) },
              })),
            },
          }
        : {
            type: 'list',
            body: { text: recortar(input.texto, 1024) },
            action: {
              button: 'Ver opciones',
              sections: [
                {
                  title: 'Opciones',
                  rows: opciones.slice(0, 10).map((o, i) => ({
                    id: `op_${i}`,
                    title: recortar(o, 24),
                  })),
                },
              ],
            },
          };

    return this.enviar({
      conversationId: input.conversationId,
      idempotencyKey: input.idempotencyKey,
      tipo: 'INTERACTIVE',
      cuerpoMeta: { type: 'interactive', interactive },
      cuerpoCrm: input.texto,
      exigeVentana: true,
    });
  }

  // ── el camino común ─────────────────────────────────────────

  /**
   * Todo envío pasa por aquí, y en este orden:
   *
   *   1. ¿ya se envió esto? → devolver lo de antes, sin llamar a Meta
   *   2. resolver conversación, contacto y número remitente
   *   3. comprobar ventana si el tipo la exige
   *   4. reservar la fila del mensaje (QUEUED) → es la marca de idempotencia
   *   5. enviar
   *   6. marcar SENT con el wamid, o FAILED con el clasificador
   *
   * LA FILA SE RESERVA ANTES DE ENVIAR. Al revés, morir entre el envío y la
   * escritura dejaría un mensaje entregado al cliente sin rastro en el hilo, y
   * el reintento se lo mandaría otra vez.
   */
  private async enviar(op: {
    conversationId: string;
    idempotencyKey: string;
    tipo: MessageType;
    cuerpoMeta: Record<string, unknown>;
    cuerpoCrm: string;
    exigeVentana: boolean;
  }): Promise<{ wamid?: string }> {
    // 1. Idempotencia. La clave del motor es `ejecución:nodo:paso`, así que
    // un reintento del mismo trabajo la reencuentra y no reenvía nada.
    const yaEnviado = await this.prisma.message.findFirst({
      where: {
        conversationId: op.conversationId,
        conversation: { companyId: this.companyId },
        externalKey: op.idempotencyKey,
      },
      select: { wamid: true, status: true },
    });
    if (yaEnviado) {
      // Incluso si quedó FAILED: reintentar el envío es decisión del motor a
      // través de su backoff, no de una segunda llamada al adaptador.
      return { wamid: yaEnviado.wamid ?? undefined };
    }

    // 2. Conversación, destinatario y remitente, todo acotado por empresa.
    const conversacion = await this.prisma.conversation.findFirst({
      where: { id: op.conversationId, companyId: this.companyId },
      select: {
        id: true,
        contact: { select: { phone: true } },
        whatsappIntegration: {
          select: {
            id: true,
            phoneNumberId: true,
            status: true,
            accessTokenEncrypted: true,
          },
        },
      },
    });
    if (!conversacion?.contact?.phone) {
      throw new ErrorDeEnvio(
        'conversacion-sin-destinatario',
        'externo_definitivo',
      );
    }

    const integracion = await this.remitente(conversacion.whatsappIntegration);

    // 3. Ventana.
    if (op.exigeVentana && !(await this.dentroDeVentana(op))) {
      throw new ErrorDeEnvio('fuera-de-ventana', 'externo_definitivo');
    }

    // 4. Reserva.
    const reservado = await this.prisma.message.create({
      data: {
        conversationId: op.conversationId,
        direction: 'OUTBOUND',
        type: op.tipo,
        body: op.cuerpoCrm || null,
        status: 'QUEUED',
        externalKey: op.idempotencyKey,
      },
      select: { id: true },
    });

    // 5. Envío. El token se descifra aquí y muere con la llamada.
    let respuesta: RespuestaEnvio;
    try {
      respuesta = await this.transporte.enviar({
        phoneNumberId: integracion.phoneNumberId,
        accessToken: this.cripto.decrypt(integracion.accessTokenEncrypted),
        to: conversacion.contact.phone.replace(/^\+/, ''),
        cuerpo: op.cuerpoMeta,
      });
    } catch {
      // Un fallo al descifrar el token no es un problema de red: alguien tiene
      // que reconectar el número.
      await this.marcarFallo(reservado.id, 'token-ilegible');
      throw new ErrorDeEnvio('token-ilegible', 'atencion');
    }

    // 6.
    if (respuesta.ok) {
      await this.prisma.message.updateMany({
        where: { id: reservado.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          wamid: respuesta.wamid ?? null,
        },
      });
      return { wamid: respuesta.wamid };
    }

    const codigo = respuesta.errorCode ?? 'desconocido';
    await this.marcarFallo(reservado.id, codigo);
    throw new ErrorDeEnvio(
      codigo,
      requiereAtencionHumana(codigo)
        ? 'atencion'
        : esReintentable(codigo)
          ? 'externo_transitorio'
          : 'externo_definitivo',
    );
  }

  private async marcarFallo(messageId: string, errorCode: string) {
    await this.prisma.message.updateMany({
      where: { id: messageId },
      // Solo el clasificador; `errorMessage` queda nulo a propósito para que
      // nadie caiga en la tentación de volcar ahí la respuesta de Meta.
      data: { status: 'FAILED', failedAt: new Date(), errorCode },
    });
  }

  /**
   * Desde qué número sale.
   *
   * PRIMERO EL DE LA CONVERSACIÓN. Con varios números, contestar desde el
   * principal manda la respuesta desde un número que el cliente no reconoce:
   * escribió a Soporte y le contesta Ventas.
   *
   * Si ese número está desconectado se cae al principal, y ahí el desempate es
   * EXPLÍCITO —`isPrimary`, luego `order`, luego `id`— nunca un `findFirst`
   * sin orden, que con dos números elegiría uno distinto según el día.
   */
  private async remitente(
    deLaConversacion: {
      id: string;
      phoneNumberId: string;
      status: string;
      accessTokenEncrypted: string | null;
    } | null,
  ): Promise<{ phoneNumberId: string; accessTokenEncrypted: string }> {
    if (
      deLaConversacion?.status === 'CONNECTED' &&
      deLaConversacion.accessTokenEncrypted
    ) {
      return {
        phoneNumberId: deLaConversacion.phoneNumberId,
        accessTokenEncrypted: deLaConversacion.accessTokenEncrypted,
      };
    }

    const principal = await this.prisma.whatsAppIntegration.findFirst({
      where: {
        companyId: this.companyId,
        status: 'CONNECTED',
        accessTokenEncrypted: { not: null },
      },
      orderBy: [{ isPrimary: 'desc' }, { order: 'asc' }, { id: 'asc' }],
      select: { phoneNumberId: true, accessTokenEncrypted: true },
    });

    if (!principal?.accessTokenEncrypted) {
      throw new ErrorDeEnvio('sin-numero-conectado', 'atencion');
    }
    return {
      phoneNumberId: principal.phoneNumberId,
      accessTokenEncrypted: principal.accessTokenEncrypted,
    };
  }

  private idiomaPlantillas(): string {
    const v = process.env.WHATSAPP_TEMPLATE_LANGUAGE?.trim();
    return v && /^[a-z]{2}(_[A-Z]{2})?$/.test(v) ? v : 'es';
  }
}
