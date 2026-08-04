import { Injectable, Logger } from '@nestjs/common';
import {
  RespuestaEnvio,
  SobreWhatsApp,
  TransporteWhatsApp,
} from './flowbot.whatsapp.transport';

/**
 * Transporte de PRUEBA: lo hace todo menos abrir la conexión.
 *
 * Llega aquí un sobre ya completo —número remitente resuelto, token
 * descifrado, destinatario, cuerpo exacto de la Cloud API—, es decir, después
 * de que se hayan ejecutado todas las comprobaciones que hace el adaptador. Lo
 * único que no ocurre es el `POST`.
 *
 * NO DEVUELVE UN `wamid` QUE PAREZCA DE META. Uno inventado con el formato de
 * los de verdad acabaría en la tabla de mensajes y en la pantalla, y a las dos
 * semanas alguien lo buscaría en el panel de Meta sin encontrarlo. El prefijo
 * `dryrun-` deja claro qué es al leerlo.
 *
 * EL SOBRE SE GUARDA REDACTADO. Sirve para revisar exactamente qué se habría
 * mandado, que es el motivo de que este modo exista; pero el token no entra —
 * ni siquiera truncado— y el destinatario se enmascara, porque estos registros
 * se leen en soporte y se pegan en capturas.
 */
export interface EnvioSimulado {
  phoneNumberId: string;
  /** Destinatario enmascarado: solo los últimos cuatro dígitos. */
  destinatarioEnmascarado: string;
  /** El cuerpo tal cual se habría mandado, sin credenciales. */
  cuerpo: Record<string, unknown>;
  en: Date;
}

@Injectable()
export class TransporteWhatsAppDryRun implements TransporteWhatsApp {
  private readonly logger = new Logger(TransporteWhatsAppDryRun.name);
  private readonly enviados: EnvioSimulado[] = [];
  private contador = 0;

  async enviar(sobre: SobreWhatsApp): Promise<RespuestaEnvio> {
    this.contador += 1;
    this.enviados.push({
      phoneNumberId: sobre.phoneNumberId,
      destinatarioEnmascarado: enmascarar(sobre.to),
      cuerpo: sobre.cuerpo,
      en: new Date(),
    });

    this.logger.log(
      `[DRY-RUN] no se envía nada a Meta [numero=${sobre.phoneNumberId} destino=${enmascarar(
        sobre.to,
      )} tipo=${tipoDe(sobre.cuerpo)}]`,
    );

    return {
      ok: true,
      // Marcado para que nadie lo confunda con un identificador de Meta.
      wamid: `dryrun-${Date.now()}-${this.contador}`,
      dryRun: true,
    };
  }

  /** Lo que se habría mandado. Para la pantalla de pruebas y el runbook. */
  get simulados(): readonly EnvioSimulado[] {
    return this.enviados;
  }

  limpiar(): void {
    this.enviados.length = 0;
  }
}

/**
 * El tipo del mensaje, solo si es un texto.
 *
 * `String(objeto)` da `[object Object]`, que en un registro es peor que no
 * poner nada: parece un valor y no lo es.
 */
function tipoDe(cuerpo: Record<string, unknown> | undefined): string {
  const tipo = cuerpo?.type;
  return typeof tipo === 'string' ? tipo : 'desconocido';
}

export function enmascarar(telefono: string): string {
  const digitos = telefono.replace(/\D/g, '');
  return digitos.length <= 4 ? '····' : `····${digitos.slice(-4)}`;
}
