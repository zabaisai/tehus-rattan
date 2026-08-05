import { Injectable, Logger } from '@nestjs/common';
import {
  RespuestaEnvio,
  SobreWhatsApp,
  TransporteWhatsApp,
  clasificar,
} from './flowbot.whatsapp.transport';

/**
 * Transporte FALSO, contractual.
 *
 * NO ES UN MOCK CUALQUIERA. Implementa el mismo `TransporteWhatsApp`, recibe
 * el mismo `SobreWhatsApp` y devuelve el mismo `RespuestaEnvio` que el real,
 * así que todo el adaptador —resolver el número, la ventana, la idempotencia,
 * la persistencia, la clasificación de errores— se ejercita EXACTAMENTE igual
 * que en producción. Lo único que no ocurre es la petición HTTP.
 *
 * Es lo que permite que estas pruebas digan algo sobre lo que pasará de
 * verdad, en vez de solo sobre sí mismas.
 *
 * SE USA HOY EN PRODUCCIÓN A PROPÓSITO. FlowBot todavía no debe escribirle a
 * clientes reales: cambiar a WhatsApp de verdad es cambiar UNA línea en la
 * fábrica de efectos, no quitar una bandera repartida por veinte sitios.
 */

/** Lo que se envió, tal como lo habría recibido Meta. */
export interface EnvioSimulado {
  phoneNumberId: string;
  /** Enmascarado: ni siquiera en una prueba hace falta el número entero. */
  to: string;
  tipo: string;
  cuerpo: Record<string, unknown>;
  en: Date;
}

/** Fallo programado para la siguiente llamada, para probar el camino malo. */
export interface FalloProgramado {
  httpStatus?: number;
  metaCode?: number;
  /** Cuántas llamadas seguidas fallan. `Infinity` para siempre. */
  veces?: number;
}

/**
 * Sufijo único por proceso. Dos instancias del doble —o dos suites— no pueden
 * generar el mismo identificador, igual que no lo harían dos números de Meta.
 */
const PROCESO = Math.random().toString(36).slice(2, 8);

@Injectable()
export class TransporteWhatsAppFalso implements TransporteWhatsApp {
  private readonly logger = new Logger(TransporteWhatsAppFalso.name);

  readonly enviados: EnvioSimulado[] = [];
  private fallo: FalloProgramado | null = null;
  private restantes = 0;
  private contador = 0;

  /** Hace fallar los siguientes envíos, para ejercitar la clasificación. */
  programarFallo(fallo: FalloProgramado): void {
    this.fallo = fallo;
    this.restantes = fallo.veces ?? 1;
  }

  /**
   * Olvida lo enviado. NO reinicia el contador de identificadores: los wamid
   * de Meta son únicos para siempre, no por sesión, y reiniciarlo hacía que
   * dos pruebas seguidas intentaran guardar el mismo y chocaran contra el
   * índice único de la tabla.
   */
  limpiar(): void {
    this.enviados.length = 0;
    this.fallo = null;
    this.restantes = 0;
  }

  /** Cuántos envíos de un tipo. Para aserciones legibles. */
  vecesDe(tipo: string): number {
    return this.enviados.filter((e) => e.tipo === tipo).length;
  }

  ultimo(): EnvioSimulado | undefined {
    return this.enviados[this.enviados.length - 1];
  }

  async enviar(sobre: SobreWhatsApp): Promise<RespuestaEnvio> {
    // El token NO se guarda ni se registra, ni siquiera aquí. Un doble que
    // conserva secretos acaba volcándolos en la salida de una prueba fallida.
    if (!sobre.accessToken) {
      return { ok: false, httpStatus: 401, errorCode: clasificar(401, 190) };
    }

    if (this.fallo && this.restantes > 0) {
      this.restantes -= 1;
      const f = this.fallo;
      if (this.restantes <= 0) this.fallo = null;
      return {
        ok: false,
        httpStatus: f.httpStatus,
        metaCode: f.metaCode,
        errorCode: clasificar(f.httpStatus, f.metaCode),
      };
    }

    this.contador += 1;
    this.enviados.push({
      phoneNumberId: sobre.phoneNumberId,
      to: enmascarar(sobre.to),
      tipo: tipoDe(sobre.cuerpo),
      cuerpo: sobre.cuerpo,
      en: new Date(),
    });

    // Con el prefijo `sim-`: si uno acabara donde no debe, se reconoce a
    // simple vista en vez de parecer un identificador legítimo de Meta.
    return { ok: true, wamid: `sim-wamid-${PROCESO}-${this.contador}` };
  }
}

/**
 * El `type` del cuerpo, solo si de verdad es una cadena.
 *
 * `String(x)` sobre un `unknown` que resulte ser un objeto escribe
 * "[object Object]" y la prueba pasaría comparando basura contra basura. Es la
 * cuarta vez que esta regla del linter evita ese mismo error en el repositorio.
 */
function tipoDe(cuerpo: Record<string, unknown>): string {
  return typeof cuerpo.type === 'string' ? cuerpo.type : 'desconocido';
}

/** Deja los últimos cuatro dígitos, como el resto del CRM. */
function enmascarar(telefono: string): string {
  return telefono.length <= 4 ? '****' : `****${telefono.slice(-4)}`;
}
