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
   * Clasificador ya redactado. NUNCA el cuerpo de la respuesta de Meta, que
   * arrastra el teléfono del destinatario y a veces el mensaje entero.
   */
  errorCode?: string;
  /** Código numérico de Meta, que sí es seguro y sirve para clasificar. */
  metaCode?: number;
  httpStatus?: number;
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

@Injectable()
export class TransporteWhatsAppReal implements TransporteWhatsApp {
  private readonly logger = new Logger(TransporteWhatsAppReal.name);

  async enviar(sobre: SobreWhatsApp): Promise<RespuestaEnvio> {
    const url = `https://graph.facebook.com/${versionGraph()}/${sobre.phoneNumberId}/messages`;

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
      return {
        ok: true,
        wamid: respuesta.data?.messages?.[0]?.id as string | undefined,
      };
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
      this.logger.warn(
        `Envío de WhatsApp rechazado [http=${status ?? '-'} meta=${metaCode ?? '-'}]`,
      );
      return {
        ok: false,
        httpStatus: status,
        metaCode,
        errorCode: clasificar(status, metaCode),
      };
    }
  }
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
  if (metaCode === 190 || httpStatus === 401) return 'token-invalido';
  if (httpStatus === 429 || metaCode === 130429) return 'limite-de-tasa';
  if (httpStatus !== undefined && httpStatus >= 500) return 'meta-caido';
  if (httpStatus !== undefined && httpStatus >= 400)
    return 'peticion-rechazada';
  return 'red';
}

/**
 * ¿Merece la pena reintentar este fallo?
 *
 * Reintentar un token inválido cinco veces no lo arregla y gasta cola; no
 * reintentar un 500 de Meta pierde un mensaje que habría salido al segundo
 * intento. La distinción es lo que hace que el backoff signifique algo.
 */
export function esReintentable(errorCode: string): boolean {
  return (
    errorCode === 'red' ||
    errorCode === 'meta-caido' ||
    errorCode === 'limite-de-tasa'
  );
}

/**
 * ¿Es un fallo que ninguna máquina puede resolver?
 *
 * Un token inválido necesita que alguien reconecte el número. Reintentarlo
 * eternamente deja la ejecución girando y a nadie enterado.
 */
export function requiereAtencionHumana(errorCode: string): boolean {
  return errorCode === 'token-invalido';
}
