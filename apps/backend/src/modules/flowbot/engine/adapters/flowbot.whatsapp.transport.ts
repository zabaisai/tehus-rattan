import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

/**
 * Transporte hacia Meta.
 *
 * ES LA ÚNICA PIEZA QUE HABLA CON LA RED, y por eso es una interfaz. Todo lo
 * demás del adaptador —resolver el número, comprobar la ventana, no repetir un
 * envío, clasificar el error, persistir el mensaje— es lógica del CRM y se
 * prueba igual con el transporte real que con el falso.
 *
 * El falso NO es un mock cualquiera: implementa este mismo contrato, recibe
 * exactamente el mismo `SobreWhatsApp` y devuelve exactamente el mismo
 * `RespuestaEnvio`. Es lo que permite que una prueba diga algo sobre lo que
 * pasará en producción en vez de solo sobre sí misma.
 */

export interface SobreWhatsApp {
  /** Desde qué número sale. Ya resuelto y comprobado contra la empresa. */
  phoneNumberId: string;
  /** Token en claro. Vive en memoria el tiempo de la llamada, nunca se log. */
  accessToken: string;
  /** Destinatario en E.164 sin `+`, como lo espera Meta. */
  to: string;
  /** Cuerpo ya construido según la API de Meta. */
  cuerpo: Record<string, unknown>;
}

export interface RespuestaEnvio {
  ok: boolean;
  wamid?: string;
  /**
   * `true` cuando el envío se preparó pero no salió.
   *
   * Va en el contrato y no en el modo del transporte porque quien lee la
   * respuesta —el adaptador, la pantalla, el registro— necesita poder decir
   * «preparado» en vez de «enviado» sin preguntarle a nadie más en qué modo
   * estaba el sistema hace un segundo.
   */
  dryRun?: boolean;
  /**
   * `true` cuando NO se sabe si el mensaje salió: un `timeout` después de
   * escribir la petición, una respuesta ilegible, una conexión cortada a
   * mitad. Es la diferencia entre reintentar y mandarle el mismo mensaje dos
   * veces al cliente, así que viaja explícita en vez de deducirse del código.
   */
  ambiguo?: boolean;
  /**
   * Clasificador ya redactado. NUNCA el cuerpo de la respuesta de Meta, que
   * arrastra el teléfono del destinatario y a veces el mensaje entero.
   */
  errorCode?: string;
  /** Código numérico de Meta, que sí es seguro y sirve para clasificar. */
  metaCode?: number;
  httpStatus?: number;
  /** Lo que pidió Meta esperar, si lo pidió. Gana sobre el backoff propio. */
  retryAfterSegundos?: number;
}

export interface TransporteWhatsApp {
  enviar(sobre: SobreWhatsApp): Promise<RespuestaEnvio>;
}

export const TRANSPORTE_WHATSAPP = Symbol('TransporteWhatsApp');

/** Versión de la Graph API. Se resuelve una vez y se valida. */
function versionGraph(): string {
  const v = process.env.WHATSAPP_GRAPH_API_VERSION?.trim();
  return v && /^v\d+\.\d+$/.test(v) ? v : 'v21.0';
}

/**
 * A dónde se manda de verdad.
 *
 * EXISTE PARA PODER PROBAR EL CÓDIGO REAL SIN LLAMAR A META. La alternativa
 * —un `if (esPrueba)` dentro del transporte— dejaría sin ejercitar justo el
 * camino que importa: el que compone la URL, pone la cabecera y clasifica la
 * respuesta.
 *
 * SOLO ADMITE `localhost`/`127.0.0.1`. Con cualquier otro destino se ignora y
 * se usa Meta: así una variable mal puesta —o inyectada— no puede desviar los
 * mensajes de los clientes hacia un servidor de otro.
 */
function baseGraph(): string {
  const configurada = process.env.WHATSAPP_GRAPH_BASE_URL?.trim();
  if (!configurada) return 'https://graph.facebook.com';

  try {
    const url = new URL(configurada);
    const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    if (local) return configurada.replace(/\/$/, '');
  } catch {
    // Una URL ilegible se ignora, como cualquier otra cosa que no sea local.
  }
  return 'https://graph.facebook.com';
}

@Injectable()
export class TransporteWhatsAppReal implements TransporteWhatsApp {
  private readonly logger = new Logger(TransporteWhatsAppReal.name);

  async enviar(sobre: SobreWhatsApp): Promise<RespuestaEnvio> {
    const url = `${baseGraph()}/${versionGraph()}/${sobre.phoneNumberId}/messages`;

    try {
      const respuesta = await axios.post(
        url,
        { messaging_product: 'whatsapp', to: sobre.to, ...sobre.cuerpo },
        {
          headers: {
            Authorization: `Bearer ${sobre.accessToken}`,
            'Content-Type': 'application/json',
          },
          // Sin límite, una caída de Meta bloquearía un worker entero
          // esperando a un socket que nunca responde.
          timeout: 15_000,
        },
      );
      const wamid = respuesta.data?.messages?.[0]?.id as string | undefined;

      // 200 SIN identificador: Meta aceptó algo pero no dice qué. Puede haber
      // salido. Tratarlo como éxito perdería el rastro; tratarlo como fallo
      // reintentable lo mandaría dos veces. Es ambiguo y se dice.
      if (!wamid) {
        this.logger.warn('Meta respondió 200 sin identificador de mensaje');
        return {
          ok: false,
          ambiguo: true,
          httpStatus: respuesta.status,
          errorCode: 'respuesta-invalida',
        };
      }
      return { ok: true, wamid };
    } catch (error) {
      const status = axios.isAxiosError(error)
        ? error.response?.status
        : undefined;
      const metaCode = axios.isAxiosError(error)
        ? (error.response?.data?.error?.code as number | undefined)
        : undefined;

      // Del error solo se conservan el estado HTTP y el código de Meta. El
      // `error.message` de Meta puede incluir el número del destinatario y el
      // cuerpo del mensaje, y este valor acaba en logs y en la base.
      const ambiguo = esAmbiguo(error);
      const errorCode = ambiguo
        ? 'resultado-ambiguo'
        : clasificar(status, metaCode);

      this.logger.warn(
        `Envío de WhatsApp rechazado [http=${status ?? '-'} meta=${
          metaCode ?? '-'
        } clase=${errorCode}]`,
      );
      // `Retry-After` de Meta manda sobre el backoff propio: cuando el otro
      // extremo dice cuánto esperar, insistir antes solo empeora el 429.
      const retryAfter = axios.isAxiosError(error)
        ? Number(error.response?.headers?.['retry-after'])
        : NaN;

      return {
        ok: false,
        ambiguo,
        httpStatus: status,
        metaCode,
        errorCode,
        ...(Number.isFinite(retryAfter) && retryAfter > 0
          ? { retryAfterSegundos: retryAfter }
          : {}),
      };
    }
  }
}

/**
 * ¿No se sabe si el mensaje llegó a salir?
 *
 * ES LA DISTINCIÓN MÁS CARA DEL ADAPTADOR. Un fallo de DNS o un rechazo de
 * conexión ocurren ANTES de escribir nada: ahí no salió y reintentar es
 * gratis. Un `timeout` o una conexión cortada ocurren DESPUÉS de mandar la
 * petición: Meta pudo haberla procesado y estar respondiendo cuando se cortó,
 * y reintentar significa mandarle al cliente el mismo mensaje dos veces.
 *
 * Sin esta separación el timeout caía en «red» —reintentable— y el duplicado
 * era cuestión de tiempo.
 */
export function esAmbiguo(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  // Con respuesta no hay ambigüedad: Meta contestó y dijo qué pasó.
  if (error.response) return false;

  const codigo = error.code ?? '';
  // Estos ocurren antes de que la petición llegue a ningún sitio.
  if (['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN'].includes(codigo)) return false;

  // Lo demás —timeout, socket colgado, conexión reiniciada— es ambiguo. Y sin
  // código conocido también: no saber qué pasó ES la ambigüedad.
  return true;
}

/**
 * Traduce el fallo a un clasificador estable.
 *
 * SE CLASIFICA AQUÍ y no en el motor porque el significado de cada código lo
 * define Meta, y el motor solo necesita saber si reintentar. Los códigos
 * concretos vienen de la documentación de la Cloud API.
 */
export function clasificar(httpStatus?: number, metaCode?: number): string {
  // 131047: fuera de la ventana de 24 h. 131026: el número no puede recibir.
  // 132000-132015: problemas con la plantilla.
  if (metaCode === 131047) return 'fuera-de-ventana';
  if (metaCode === 131026) return 'destinatario-no-alcanzable';
  if (metaCode === 131051) return 'tipo-de-mensaje-no-soportado';
  if (metaCode !== undefined && metaCode >= 132000 && metaCode <= 132015) {
    return 'plantilla-invalida';
  }
  if (metaCode === 131031) return 'cuenta-restringida';
  if (metaCode === 131049 || metaCode === 131048) return 'calidad-del-numero';
  if (metaCode === 133010 || metaCode === 133005) {
    return 'integracion-desconectada';
  }
  if (metaCode === 190 || httpStatus === 401) return 'token-invalido';
  if (httpStatus === 403 || metaCode === 200 || metaCode === 10) {
    return 'sin-permiso';
  }
  if (httpStatus === 429 || metaCode === 130429 || metaCode === 131056) {
    return 'limite-de-tasa';
  }
  if (httpStatus !== undefined && httpStatus >= 500) return 'meta-caido';
  if (httpStatus !== undefined && httpStatus >= 400)
    return 'peticion-rechazada';
  return 'red';
}

/**
 * Política de cada clase de fallo.
 *
 * VIVE EN UNA TABLA Y NO EN CONDICIONES REPARTIDAS porque son quince clases y
 * cada una tiene cinco decisiones. Escritas como `if` allí donde se usan, la
 * respuesta a «¿esto reintenta?» hay que reconstruirla leyendo el código;
 * aquí se lee.
 *
 * `mensajeVisible` es lo que ve quien abre la ejecución en el CRM. No repite
 * el código técnico: quien lo lee necesita saber qué hacer, no cómo se llama
 * el error por dentro.
 */
export interface PoliticaError {
  reintentar: boolean;
  /** Espera base en ms. El motor le aplica su exponencial. */
  backoffMs: number;
  maxIntentos: number;
  /** Pasa la conversación a una persona. */
  handoff: boolean;
  /** Deja la ejecución esperando revisión humana. */
  necesitaAtencion: boolean;
  mensajeVisible: string;
}

const POR_DEFECTO: PoliticaError = {
  reintentar: false,
  backoffMs: 0,
  maxIntentos: 1,
  handoff: false,
  necesitaAtencion: true,
  mensajeVisible: 'El mensaje no se pudo enviar. Revísalo antes de reintentar.',
};

export const POLITICAS: Record<string, PoliticaError> = {
  // Transitorios: reintentar es correcto y además es lo único que lo arregla.
  red: {
    reintentar: true,
    backoffMs: 2_000,
    maxIntentos: 5,
    handoff: false,
    necesitaAtencion: false,
    mensajeVisible: 'Hubo un problema de red al enviar. Se reintentará solo.',
  },
  'meta-caido': {
    reintentar: true,
    backoffMs: 5_000,
    maxIntentos: 6,
    handoff: false,
    necesitaAtencion: false,
    mensajeVisible: 'WhatsApp no responde. Se reintentará solo.',
  },
  'limite-de-tasa': {
    reintentar: true,
    // Más largo a propósito: reintentar rápido un 429 lo empeora.
    backoffMs: 30_000,
    maxIntentos: 8,
    handoff: false,
    necesitaAtencion: false,
    mensajeVisible:
      'Se alcanzó el límite de envíos de WhatsApp. Se reintentará más tarde.',
  },

  // NO se reintenta: no se sabe si salió.
  'resultado-ambiguo': {
    reintentar: false,
    backoffMs: 0,
    maxIntentos: 1,
    handoff: false,
    necesitaAtencion: true,
    mensajeVisible:
      'No se pudo confirmar si el mensaje salió. No se reenvía solo para no duplicarlo: compruébalo en WhatsApp antes de decidir.',
  },
  'respuesta-invalida': {
    reintentar: false,
    backoffMs: 0,
    maxIntentos: 1,
    handoff: false,
    necesitaAtencion: true,
    mensajeVisible:
      'WhatsApp respondió algo que no se pudo interpretar. No se reenvía solo para no duplicarlo.',
  },

  // Configuración: reintentar no lo arregla, alguien tiene que actuar.
  'token-invalido': {
    reintentar: false,
    backoffMs: 0,
    maxIntentos: 1,
    handoff: false,
    necesitaAtencion: true,
    mensajeVisible:
      'La conexión con WhatsApp caducó. Hay que volver a conectar el número.',
  },
  'token-ilegible': {
    reintentar: false,
    backoffMs: 0,
    maxIntentos: 1,
    handoff: false,
    necesitaAtencion: true,
    mensajeVisible:
      'No se pudo leer la credencial guardada de WhatsApp. Hay que volver a conectar el número.',
  },
  'integracion-desconectada': {
    reintentar: false,
    backoffMs: 0,
    maxIntentos: 1,
    handoff: false,
    necesitaAtencion: true,
    mensajeVisible: 'El número de WhatsApp no está conectado.',
  },
  'sin-numero-conectado': {
    reintentar: false,
    backoffMs: 0,
    maxIntentos: 1,
    handoff: false,
    necesitaAtencion: true,
    mensajeVisible:
      'Esta empresa no tiene ningún número de WhatsApp conectado.',
  },
  'sin-permiso': {
    reintentar: false,
    backoffMs: 0,
    maxIntentos: 1,
    handoff: false,
    necesitaAtencion: true,
    mensajeVisible:
      'La cuenta de WhatsApp no tiene permiso para esta operación.',
  },
  'cuenta-restringida': {
    reintentar: false,
    backoffMs: 0,
    maxIntentos: 1,
    handoff: true,
    necesitaAtencion: true,
    mensajeVisible:
      'Meta restringió la cuenta de WhatsApp. Escríbele tú mientras se resuelve.',
  },
  'calidad-del-numero': {
    reintentar: false,
    backoffMs: 0,
    maxIntentos: 1,
    handoff: true,
    necesitaAtencion: true,
    mensajeVisible:
      'Meta limitó este número por calidad. Escríbele tú mientras se resuelve.',
  },
  'plantilla-invalida': {
    reintentar: false,
    backoffMs: 0,
    maxIntentos: 1,
    // Las dos cosas: alguien atiende AHORA a este cliente, y además queda
    // constancia de que la plantilla está rota para que alguien la arregle.
    // Solo lo primero deja el bot fallando igual mañana; solo lo segundo deja
    // al cliente esperando una respuesta que no va a llegar.
    handoff: true,
    necesitaAtencion: true,
    mensajeVisible:
      'La plantilla no es válida o no está aprobada para este número.',
  },
  'plantilla-no-verificada': {
    reintentar: false,
    backoffMs: 0,
    maxIntentos: 1,
    handoff: false,
    necesitaAtencion: true,
    mensajeVisible:
      'Esa plantilla no está registrada como aprobada en el CRM. Regístrala antes de usarla.',
  },

  // Del cliente o de la conversación: una persona lo resuelve mejor.
  'fuera-de-ventana': {
    reintentar: false,
    backoffMs: 0,
    maxIntentos: 1,
    handoff: true,
    necesitaAtencion: false,
    mensajeVisible:
      'Pasaron más de 24 h desde el último mensaje del cliente: WhatsApp solo permite plantillas.',
  },
  'destinatario-no-alcanzable': {
    reintentar: false,
    backoffMs: 0,
    maxIntentos: 1,
    handoff: true,
    necesitaAtencion: false,
    mensajeVisible: 'Ese número no puede recibir mensajes de WhatsApp.',
  },
  'tipo-de-mensaje-no-soportado': {
    reintentar: false,
    backoffMs: 0,
    maxIntentos: 1,
    handoff: false,
    necesitaAtencion: true,
    mensajeVisible: 'WhatsApp no admite ese tipo de mensaje para este número.',
  },

  // Bloqueado por un guardarraíl: no es un fallo, es el sistema haciendo su
  // trabajo. Ni se reintenta ni necesita que nadie lo mire.
  'envio-bloqueado': {
    reintentar: false,
    backoffMs: 0,
    maxIntentos: 1,
    handoff: false,
    necesitaAtencion: false,
    mensajeVisible:
      'El envío real está bloqueado por la configuración de seguridad.',
  },
  'peticion-rechazada': POR_DEFECTO,
};

export function politicaDeError(errorCode: string): PoliticaError {
  return POLITICAS[errorCode] ?? POR_DEFECTO;
}

/**
 * ¿Merece la pena reintentar este fallo?
 *
 * Reintentar un token inválido cinco veces no lo arregla y gasta cola; no
 * reintentar un 500 de Meta pierde un mensaje que habría salido al segundo
 * intento. La distinción es lo que hace que el backoff signifique algo.
 */
export function esReintentable(errorCode: string): boolean {
  return politicaDeError(errorCode).reintentar;
}

/**
 * ¿Es un fallo que ninguna máquina puede resolver?
 *
 * Un token inválido necesita que alguien reconecte el número. Reintentarlo
 * eternamente deja la ejecución girando y a nadie enterado.
 */
export function requiereAtencionHumana(errorCode: string): boolean {
  return politicaDeError(errorCode).necesitaAtencion;
}
