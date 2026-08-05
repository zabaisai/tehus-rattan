import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { buildRedisConnection } from '../../../../common/queue/queue.config';

/**
 * Cuántos mensajes puede mandar FlowBot y cada cuánto.
 *
 * POR QUÉ NO BASTA EL LÍMITE DE META. Meta responde 429 cuando ya has pasado su
 * umbral, y para entonces el daño está hecho: los rechazos cuentan contra la
 * calidad del número, y esa reputación tarda semanas en recuperarse. Este
 * contador es el que impide llegar ahí, y por eso corta ANTES de abrir la
 * conexión.
 *
 * SIETE DIMENSIONES, TRES VENTANAS. Un solo límite global no sirve: protege a
 * la plataforma y deja que una empresa con un bucle se coma el cupo de todas.
 * Un solo límite por empresa tampoco: deja que un bot mal configurado
 * bombardee a un único cliente sin superar el total. Se comprueban todas y
 * basta con que una se pase para bloquear.
 *
 * LA AUSENCIA DE CONFIGURACIÓN NO ES ILIMITADO. Los valores por defecto son
 * conservadores a propósito: es preferible que una prueba piloto choque contra
 * el techo y alguien lo suba a mano, que descubrir el techo cuando ya salieron
 * diez mil mensajes.
 */
export type Dimension =
  | 'global'
  | 'empresa'
  | 'integracion'
  | 'numero'
  | 'bot'
  | 'conversacion'
  | 'destinatario';

export type Ventana = 'minuto' | 'hora' | 'dia';

export const SEGUNDOS: Record<Ventana, number> = {
  minuto: 60,
  hora: 3_600,
  dia: 86_400,
};

/**
 * Techos por defecto. Deliberadamente bajos.
 *
 * Están pensados para una prueba piloto de un número, no para producción a
 * volumen: el runbook dice que hay que subirlos a mano, y ese acto manual es
 * justamente la revisión que queremos que ocurra.
 */
export const LIMITES_POR_DEFECTO: Record<Dimension, Record<Ventana, number>> = {
  global: { minuto: 60, hora: 600, dia: 5_000 },
  empresa: { minuto: 30, hora: 300, dia: 2_000 },
  integracion: { minuto: 20, hora: 200, dia: 1_000 },
  numero: { minuto: 20, hora: 200, dia: 1_000 },
  bot: { minuto: 20, hora: 200, dia: 1_000 },
  // Una conversación que recibe más de seis mensajes por minuto del bot es un
  // bucle, no una conversación.
  conversacion: { minuto: 6, hora: 60, dia: 200 },
  destinatario: { minuto: 6, hora: 60, dia: 200 },
};

export interface ClavesEnvio {
  companyId: string;
  integrationId: string | null;
  phoneNumberId: string;
  flowBotId: string | null;
  conversationId: string;
  /** Destinatario en E.164. NO se guarda: se guarda su huella. */
  destinatario: string;
}

export type ResultadoFrecuencia =
  | { permitido: true; consumido: true }
  | {
      permitido: false;
      /** Qué dimensión y ventana cortaron. Sin números de nadie. */
      dimension: Dimension;
      ventana: Ventana;
      limite: number;
      /** Segundos hasta que vuelva a haber cupo. */
      retryAfterSegundos: number;
      /** `true` si el cupo NO se consumió (siempre, al bloquear). */
      consumido: false;
    }
  | {
      permitido: false;
      /** Redis no está. Para el transporte real esto BLOQUEA. */
      indisponible: true;
      consumido: false;
    };

/**
 * Lee un límite del entorno con respaldo en el valor por defecto.
 *
 * `FLOWBOT_RATE_<DIMENSION>_<VENTANA>`, por ejemplo
 * `FLOWBOT_RATE_EMPRESA_MINUTO`. Un valor no numérico o negativo se ignora y
 * se usa el defecto: una variable mal escrita no puede subir el techo.
 *
 * `0` SÍ se respeta y significa «ninguno». Es la forma de cerrar una dimensión
 * del todo sin tocar código.
 */
export function limiteDe(
  dimension: Dimension,
  ventana: Ventana,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const clave = `FLOWBOT_RATE_${dimension.toUpperCase()}_${ventana.toUpperCase()}`;
  const bruto = env[clave]?.trim();
  if (bruto === undefined || bruto === '') {
    return LIMITES_POR_DEFECTO[dimension][ventana];
  }
  const n = Number(bruto);
  return Number.isInteger(n) && n >= 0
    ? n
    : LIMITES_POR_DEFECTO[dimension][ventana];
}

/**
 * Huella de un valor sensible para usarlo como clave.
 *
 * NO SE GUARDA EL TELÉFONO. Una clave de Redis como
 * `flowbot:rate:destinatario:573001112233:minuto` pone el número de un cliente
 * en un sistema que se inspecciona con `KEYS *`, se vuelca en soporte y no
 * tiene control de acceso por fila. Con la huella el contador funciona igual
 * y no hay nada que filtrar.
 *
 * Se usa SHA-256 truncado: no hace falta resistencia criptográfica completa
 * —no protege un secreto, solo evita escribir el dato— y 16 caracteres hacen
 * las colisiones irrelevantes al volumen de una empresa.
 */
export function huella(valor: string): string {
  // `require` en línea para no arrastrar `crypto` a los tipos del navegador.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require('crypto') as typeof import('crypto');
  return createHash('sha256').update(valor).digest('hex').slice(0, 16);
}

/**
 * El script que hace atómica la comprobación.
 *
 * POR QUÉ UN SCRIPT Y NO TRES COMANDOS. «Leer, comparar, incrementar» desde el
 * código deja una ventana entre la lectura y la escritura: dos workers leen 19
 * de un límite de 20, ambos deciden que caben, ambos incrementan, y salen 21
 * mensajes. Con más workers el exceso crece. Redis ejecuta un script entero
 * sin intercalar nada, así que la carrera no existe.
 *
 * PRIMERO SE COMPRUEBAN TODAS LAS VENTANAS, DESPUÉS SE INCREMENTAN TODAS. Si
 * se hiciera dimensión a dimensión, un bloqueo en la última dejaría las
 * anteriores ya consumidas: el envío no sale y el cupo se ha gastado igual.
 *
 * Devuelve `{0}` si permitió, o `{1, índice, ttl}` si bloqueó — el índice
 * identifica qué contador cortó, para poder explicarlo sin adivinar.
 */
export const SCRIPT_RESERVA = `
local n = #KEYS
-- Fase 1: comprobar TODOS los contadores sin tocar ninguno.
for i = 1, n do
  local limite = tonumber(ARGV[(i - 1) * 2 + 1])
  local actual = tonumber(redis.call('GET', KEYS[i]) or '0')
  if actual + 1 > limite then
    local ttl = redis.call('TTL', KEYS[i])
    if ttl < 0 then ttl = tonumber(ARGV[(i - 1) * 2 + 2]) end
    return {1, i, ttl}
  end
end
-- Fase 2: consumir. Solo se llega aquí si TODOS tenían hueco.
for i = 1, n do
  local ventana = tonumber(ARGV[(i - 1) * 2 + 2])
  local tras = redis.call('INCR', KEYS[i])
  -- El TTL se pone solo al crear la clave: renovarlo en cada incremento
  -- convertiría una ventana deslizante en una que nunca caduca.
  if tras == 1 then
    redis.call('EXPIRE', KEYS[i], ventana)
  end
end
return {0}
`;

/** Devuelve un cupo consumido. Solo para lo que se decidió no enviar. */
export const SCRIPT_DEVOLUCION = `
for i = 1, #KEYS do
  local actual = tonumber(redis.call('GET', KEYS[i]) or '0')
  -- Nunca por debajo de cero: una devolución duplicada no puede regalar cupo.
  if actual > 0 then
    redis.call('DECR', KEYS[i])
  end
end
return 1
`;

@Injectable()
export class ContadorFrecuencia {
  private readonly logger = new Logger(ContadorFrecuencia.name);
  private cliente: Redis | null = null;
  /** Promesa de la conexión en curso, para no lanzar dos. */
  private listo: Promise<unknown> | null = null;

  /** Todas las claves de un envío, en orden estable. */
  private claves(c: ClavesEnvio): Array<{
    dimension: Dimension;
    ventana: Ventana;
    clave: string;
    limite: number;
  }> {
    const partes: Array<[Dimension, string | null]> = [
      ['global', 'all'],
      ['empresa', c.companyId],
      ['integracion', c.integrationId],
      ['numero', c.phoneNumberId],
      ['bot', c.flowBotId],
      ['conversacion', c.conversationId],
      // Huella, nunca el teléfono.
      ['destinatario', huella(c.destinatario)],
    ];

    const salida: Array<{
      dimension: Dimension;
      ventana: Ventana;
      clave: string;
      limite: number;
    }> = [];

    for (const [dimension, id] of partes) {
      // Una dimensión sin identificador —un envío sin bot, por ejemplo— no se
      // cuenta en vez de agruparse bajo `null`, que mezclaría cosas distintas
      // en el mismo contador.
      if (!id) continue;
      for (const ventana of ['minuto', 'hora', 'dia'] as Ventana[]) {
        salida.push({
          dimension,
          ventana,
          clave: `flowbot:rate:${dimension}:${id}:${ventana}`,
          limite: limiteDe(dimension, ventana),
        });
      }
    }
    return salida;
  }

  /**
   * Cliente listo para recibir comandos.
   *
   * SE ESPERA A QUE LA CONEXIÓN ESTÉ ABIERTA antes de devolver. Con
   * `lazyConnect` y sin cola de espera, el primer comando salía mientras el
   * socket todavía se estaba abriendo y fallaba con «stream isn't writeable»:
   * el sistema informaba de «Redis no disponible» con Redis perfectamente
   * sano, y el primer envío de cada worker recién arrancado quedaba
   * bloqueado. Lo encontró la suite al correr de verdad, no el tipo.
   *
   * Se mantiene `enableOfflineQueue: false` a propósito: cuando Redis está
   * caído de verdad interesa fallar rápido y bloquear, no acumular comandos
   * que se ejecutarán solos cuando vuelva.
   */
  private async conectar(): Promise<Redis> {
    if (!this.cliente) {
      const cliente = new Redis({
        ...buildRedisConnection(),
        // Sin reintentos infinitos: si Redis no está, se quiere saber ya para
        // poder fallar cerrado, no esperar colgado.
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        lazyConnect: true,
        // `maxRetriesPerRequest` acota los COMANDOS, no la conexión: sin esto
        // ioredis reintenta abrir el socket indefinidamente y el primer envío
        // con Redis caído se queda colgado en vez de fallar cerrado. Devolver
        // `null` dice «no reintentes» y hace que `connect()` rechace.
        retryStrategy: () => null,
        connectTimeout: 3_000,
      });
      // Sin este manejador, un error de conexión tumba el proceso entero.
      cliente.on('error', () => undefined);
      this.cliente = cliente;
      this.listo = cliente.connect().catch((e: unknown) => {
        // Se suelta para que la próxima llamada vuelva a intentarlo, en vez de
        // quedarse con una promesa rechazada para siempre.
        this.cliente = null;
        this.listo = null;
        throw e;
      });
    }
    if (this.listo) await this.listo;
    return this.cliente;
  }

  /**
   * Reserva un envío.
   *
   * SE LLAMA JUSTO ANTES DE ENVIAR y después de todos los demás guardarraíles:
   * consumir cupo por un envío que el kill switch iba a bloquear de todas
   * formas gasta el presupuesto de la empresa sin que salga nada.
   */
  async reservar(c: ClavesEnvio): Promise<ResultadoFrecuencia> {
    const definiciones = this.claves(c);
    const keys = definiciones.map((d) => d.clave);
    const args = definiciones.flatMap((d) => [
      String(d.limite),
      String(SEGUNDOS[d.ventana]),
    ]);

    try {
      const r = (await (
        await this.conectar()
      ).eval(SCRIPT_RESERVA, keys.length, ...keys, ...args)) as [
        number,
        number?,
        number?,
      ];

      if (r[0] === 0) return { permitido: true, consumido: true };

      const cortada = definiciones[(r[1] ?? 1) - 1];
      return {
        permitido: false,
        consumido: false,
        dimension: cortada.dimension,
        ventana: cortada.ventana,
        limite: cortada.limite,
        retryAfterSegundos: Math.max(1, r[2] ?? SEGUNDOS[cortada.ventana]),
      };
    } catch (error) {
      // NO se asume cero. Sin contador no se puede afirmar que hay hueco, y el
      // transporte real trata esto como bloqueo. Quien decide qué hacer con
      // ello es el guardarraíl, no este método.
      this.logger.error(
        'No se pudo consultar el contador de frecuencia',
        error as Error,
      );
      return { permitido: false, consumido: false, indisponible: true };
    }
  }

  /**
   * Devuelve el cupo de un envío que al final no salió.
   *
   * SOLO para cuando se sabe con certeza que NO se envió nada. Si el resultado
   * fue ambiguo —timeout, socket cortado— el cupo se queda consumido: puede
   * que el mensaje sí saliera, y devolver el cupo permitiría que otro ocupara
   * su sitio y acabaran saliendo dos.
   */
  async devolver(c: ClavesEnvio): Promise<void> {
    const keys = this.claves(c).map((d) => d.clave);
    try {
      await (
        await this.conectar()
      ).eval(SCRIPT_DEVOLUCION, keys.length, ...keys);
    } catch {
      // Un fallo aquí solo consume cupo de más: es el lado seguro del error.
      this.logger.warn('No se pudo devolver el cupo de frecuencia');
    }
  }

  /** Lo configurado, para la pantalla de estado. Sin datos de nadie. */
  limitesConfigurados(): Array<{
    dimension: Dimension;
    minuto: number;
    hora: number;
    dia: number;
  }> {
    return (Object.keys(LIMITES_POR_DEFECTO) as Dimension[]).map((d) => ({
      dimension: d,
      minuto: limiteDe(d, 'minuto'),
      hora: limiteDe(d, 'hora'),
      dia: limiteDe(d, 'dia'),
    }));
  }

  /** ¿Responde Redis? Para el estado operativo y el health. */
  async disponible(): Promise<boolean> {
    try {
      await (await this.conectar()).ping();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Suelta la conexión.
   *
   * `quit()` espera a que Redis conteste; `disconnect()` corta los temporizadores
   * de reconexión que ioredis deja vivos. Hacen falta los dos: sin el segundo,
   * un proceso que termina —una suite de pruebas, un worker que se apaga— se
   * queda colgado esperando a un socket que nadie va a cerrar.
   */
  async cerrar(): Promise<void> {
    const c = this.cliente;
    this.cliente = null;
    this.listo = null;
    if (!c) return;
    await c.quit().catch(() => undefined);
    c.disconnect();
  }
}
