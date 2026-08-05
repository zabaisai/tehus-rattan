import { Logger } from '@nestjs/common';
import { MessageType } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { WhatsAppTokenCryptoService } from '../../../whatsapp-integration/whatsapp-token-crypto.service';
import { PuertoMensajeria } from '../flowbot.ports';
import {
  RespuestaEnvio,
  TransporteWhatsApp,
  esReintentable,
  politicaDeError,
  requiereAtencionHumana,
} from './flowbot.whatsapp.transport';
import { GuardarrailesWhatsApp } from './flowbot.whatsapp.guardarrailes';
import { RegistroPlantillas } from './flowbot.whatsapp.plantillas';
import type { ModoTransporte } from './flowbot.whatsapp.modo';

/**
 * Los tres transportes disponibles, ya construidos.
 *
 * EL ADAPTADOR NO LOS CREA: los recibe. Crearlos aquí significaría que el
 * adaptador decide cuál usar leyendo variables de entorno, y entonces la
 * decisión estaría repartida por tantos sitios como adaptadores haya. Aquí
 * solo se elige entre los que le dieron.
 */
export interface JuegoDeTransportes {
  falso: TransporteWhatsApp;
  dryRun: TransporteWhatsApp;
  real: TransporteWhatsApp;
}

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
    private readonly transportes: JuegoDeTransportes,
    private readonly cripto: WhatsAppTokenCryptoService,
    private readonly guardarrailes: GuardarrailesWhatsApp,
    private readonly plantillas: RegistroPlantillas,
    /**
     * La ejecución en curso. Sin ella no se puede comprobar si el bot sigue
     * publicado, si la versión es la vigente ni si la ejecución sigue viva, y
     * sin poder comprobarlo NO se envía de verdad.
     */
    private readonly executionId: string | null = null,
    /** Para contar por bot: un bot en bucle no puede gastar el cupo de todos. */
    private readonly flowBotId: string | null = null,
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
      // Se comprueba contra lo que el CRM sabe de la plantilla ANTES de
      // construir nada. Una plantilla desconocida o con otro número de
      // parámetros la rechaza Meta con un código que no dice cuál fue el
      // problema, y en cantidad degrada la calidad del número.
      plantilla: {
        nombre: input.plantilla,
        parametros: input.parametros.length,
      },
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
    /** Presente solo en envíos de plantilla, para poder verificarla. */
    plantilla?: { nombre: string; parametros: number };
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
    const dentroDeVentana = await this.dentroDeVentana(op);
    if (op.exigeVentana && !dentroDeVentana) {
      throw new ErrorDeEnvio('fuera-de-ventana', 'externo_definitivo');
    }

    // 3b. Plantilla: solo se manda lo que el CRM sabe aprobado.
    if (op.plantilla) {
      const estado = await this.plantillas.estado({
        companyId: this.companyId,
        whatsappIntegrationId: integracion.id,
        nombre: op.plantilla.nombre,
        idioma: this.idiomaPlantillas(),
        parametrosEnviados: op.plantilla.parametros,
      });
      if (!estado.aprobada) {
        this.logger.warn(
          `Plantilla bloqueada [nombre=${op.plantilla.nombre}]: ${estado.motivo ?? 'sin verificar'}`,
        );
        throw new ErrorDeEnvio('plantilla-no-verificada', 'externo_definitivo');
      }
    }

    // 3c. Guardarraíles. Se evalúan AQUÍ, con el número ya resuelto y el
    // destinatario conocido, y no al arrancar la ejecución: entre una cosa y
    // la otra pueden haber pausado el bot o entrado una persona a atender.
    const decision = await this.guardarrailes.evaluar({
      companyId: this.companyId,
      executionId: this.executionId,
      flowBotId: this.flowBotId,
      conversationId: op.conversationId,
      integrationId: integracion.id,
      phoneNumberId: integracion.phoneNumberId,
      destinatario: conversacion.contact.phone.replace(/^\+/, ''),
      integracionConectada: integracion.conectada,
      idempotencyKey: op.idempotencyKey,
      // Una plantilla ya validada vale fuera de la ventana; el texto libre no.
      ventanaOPlantilla: dentroDeVentana || !!op.plantilla,
    });

    // El límite interno NO es un fallo del envío: es el sistema haciendo su
    // trabajo. Se lanza ANTES de reservar la fila del mensaje —crear una fila
    // FALLIDA por algo que nunca llegó a intentarse ensucia el hilo del
    // cliente— y con `retryAfter` para que el motor reencole con espera en vez
    // de reintentar de inmediato, que es como se construye una tormenta.
    if (decision.limiteAlcanzado || decision.contadorIndisponible) {
      const error = new ErrorDeEnvio(
        decision.contadorIndisponible
          ? 'contador-no-disponible'
          : 'limite-interno',
        'externo_transitorio',
      );
      (error as { retryAfterSegundos?: number }).retryAfterSegundos =
        decision.retryAfterSegundos ?? 60;
      throw error;
    }

    const transporte = this.transporteDe(decision.modo);

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
      respuesta = await transporte.enviar({
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
      // EL MENSAJE YA SALIÓ. A partir de aquí, nada de lo que pase escribiendo
      // en la base puede convertirse en un error que el motor reintente:
      // reintentar significaría mandárselo al cliente por segunda vez.
      //
      // `wamid` es único en la tabla. Si Meta devolviera uno repetido —o si un
      // reenvío de otro camino ya lo hubiera guardado— la escritura chocaría.
      // Se guarda entonces sin él: se pierde la trazabilidad de ese mensaje,
      // que es infinitamente más barato que duplicarlo.
      try {
        await this.prisma.message.updateMany({
          where: { id: reservado.id },
          data: {
            status: 'SENT',
            sentAt: new Date(),
            wamid: respuesta.wamid ?? null,
          },
        });
      } catch {
        this.logger.warn(
          'No se pudo guardar el wamid; el mensaje queda enviado sin él',
        );
        await this.prisma.message
          .updateMany({
            where: { id: reservado.id },
            data: { status: 'SENT', sentAt: new Date() },
          })
          .catch(() => undefined);
      }
      if (integracion.id) {
        await this.guardarrailes.registrarExito(integracion.id);
      }
      return { wamid: respuesta.wamid };
    }

    const codigo = respuesta.errorCode ?? 'desconocido';
    await this.marcarFallo(reservado.id, codigo);

    // El breaker se entera del fallo; él decide si abre.
    if (integracion.id) {
      await this.guardarrailes.registrarFallo(integracion.id, codigo);
    }

    // AMBIGUO NO SE REINTENTA. No se sabe si el mensaje salió; reintentar es
    // jugarse mandárselo dos veces al cliente. Se marca para que alguien lo
    // mire, que es la única salida honesta.
    //
    // Y EL CUPO SE QUEDA CONSUMIDO: puede que el mensaje sí saliera, y
    // devolverlo permitiría que otro ocupara su sitio y salieran dos.
    if (respuesta.ambiguo) {
      throw new ErrorDeEnvio(codigo, 'atencion');
    }

    // Aquí SÍ se sabe que no salió —Meta contestó y dijo que no—, así que el
    // cupo vuelve: si no, un flujo mal configurado agota el presupuesto de la
    // empresa a base de rechazos.
    if (decision.cupoConsumido) {
      await this.guardarrailes.devolverCupo({
        companyId: this.companyId,
        integrationId: integracion.id,
        phoneNumberId: integracion.phoneNumberId,
        flowBotId: this.flowBotId,
        conversationId: op.conversationId,
        destinatario: conversacion.contact.phone.replace(/^\+/, ''),
      });
    }

    // La espera que pidió Meta viaja con el error para que el motor la
    // respete en vez de aplicar su exponencial genérico.
    if (respuesta.retryAfterSegundos) {
      const conEspera = new ErrorDeEnvio(codigo, 'externo_transitorio');
      (conEspera as { retryAfterSegundos?: number }).retryAfterSegundos =
        respuesta.retryAfterSegundos;
      throw conEspera;
    }

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
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        errorCode,
        // La frase que verá una persona, tomada de la política de esa clase de
        // error. NUNCA la respuesta de Meta: arrastra el teléfono y a veces el
        // mensaje entero. Sin esto, quien abre la conversación ve un código
        // como `limite-de-tasa` y tiene que preguntar qué significa.
        errorMessage: politicaDeError(errorCode).mensajeVisible,
      },
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
  ): Promise<{
    id: string | null;
    phoneNumberId: string;
    accessTokenEncrypted: string;
    conectada: boolean;
  }> {
    // EL NÚMERO DE LA CONVERSACIÓN MANDA. Es por donde escribió el cliente y
    // por donde espera la respuesta; contestarle desde otro número de la misma
    // empresa abre un hilo nuevo en su teléfono y pierde el contexto.
    if (
      deLaConversacion?.status === 'CONNECTED' &&
      deLaConversacion.accessTokenEncrypted
    ) {
      return {
        id: deLaConversacion.id,
        phoneNumberId: deLaConversacion.phoneNumberId,
        accessTokenEncrypted: deLaConversacion.accessTokenEncrypted,
        conectada: true,
      };
    }

    const principal = await this.prisma.whatsAppIntegration.findFirst({
      where: {
        companyId: this.companyId,
        status: 'CONNECTED',
        accessTokenEncrypted: { not: null },
      },
      // ORDEN TOTALMENTE DETERMINISTA. Sin `orderBy`, `findFirst` devuelve
      // «alguna» fila y la empresa con dos números vería sus mensajes salir
      // unas veces por uno y otras por otro sin patrón. Con el desempate por
      // `id` el resultado es siempre el mismo.
      orderBy: [{ isPrimary: 'desc' }, { order: 'asc' }, { id: 'asc' }],
      select: { id: true, phoneNumberId: true, accessTokenEncrypted: true },
    });

    if (!principal?.accessTokenEncrypted) {
      throw new ErrorDeEnvio('sin-numero-conectado', 'atencion');
    }
    return {
      id: principal.id,
      phoneNumberId: principal.phoneNumberId,
      accessTokenEncrypted: principal.accessTokenEncrypted,
      conectada: true,
    };
  }

  /**
   * De los tres transportes, el que dijo la decisión.
   *
   * Es un `switch` de tres líneas a propósito: la lógica de QUÉ modo toca vive
   * entera en `decidirModo`, y aquí solo se traduce. Repartir la decisión
   * entre los dos sitios es como acaban existiendo caminos por los que se
   * envía de verdad sin haber pasado por los guardarraíles.
   */
  private transporteDe(modo: ModoTransporte): TransporteWhatsApp {
    if (modo === 'real') return this.transportes.real;
    if (modo === 'dry-run') return this.transportes.dryRun;
    return this.transportes.falso;
  }

  private idiomaPlantillas(): string {
    const v = process.env.WHATSAPP_TEMPLATE_LANGUAGE?.trim();
    return v && /^[a-z]{2}(_[A-Z]{2})?$/.test(v) ? v : 'es';
  }
}
