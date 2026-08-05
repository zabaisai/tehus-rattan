import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { buildRedisConnection } from '../../../../common/queue/queue.config';

/**
 * Corta los envíos de UN número cuando ese número está fallando.
 *
 * POR QUÉ POR INTEGRACIÓN Y NO GLOBAL. Un breaker global es peor que ninguno:
 * el número de una empresa se queda sin token, empieza a fallar, y el sistema
 * deja de mandar los mensajes de todas las demás. El fallo de un cliente no
 * puede convertirse en una caída de la plataforma.
 *
 * QUÉ LO ABRE Y QUÉ NO. Solo los fallos que indican que el CANAL está mal:
 * timeouts, conexiones cortadas, 429, 5xx, respuestas ilegibles. Un
 * destinatario inválido o una plantilla mal aprobada son fallos del CONTENIDO
 * —volverán a fallar igual con otro número— y abrir el breaker por ellos
 * dejaría a la empresa sin bot por un flujo mal configurado.
 *
 * REDIS GUARDA EL ESTADO OPERATIVO; POSTGRESQL, LA EXPLICACIÓN. Si Redis se
 * reinicia se pierde el contador, no la historia: cada apertura y cada cierre
 * quedan en la auditoría, que es donde se mira para entender qué pasó ayer.
 *
 * AL PERDER EL ESTADO SE VUELVE A `CLOSED`, y es deliberado. La alternativa
 * —quedarse abierto— dejaría a una empresa sin bot tras un reinicio rutinario
 * de Redis sin que nadie hubiera fallado. Lo que protege de verdad es que el
 * primer fallo real vuelve a abrirlo en segundos, y que el envío pasa antes
 * por el contador de frecuencia, que sí falla cerrado.
 */
export type EstadoBreaker = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface FotoBreaker {
  estado: EstadoBreaker;
  fallosConsecutivos: number;
  /** Cuándo se abrió la última vez. */
  abiertoEn: string | null;
  /** A partir de cuándo se admite una prueba. */
  proximoIntento: string | null;
  /** Clasificador del último fallo. Nunca el mensaje de Meta. */
  ultimaCausa: string | null;
  ultimoExito: string | null;
  /** Cuántas veces se ha abierto desde que existe el contador. */
  aperturas: number;
}

/** Cuántos fallos seguidos abren el breaker. */
export const FALLOS_PARA_ABRIR = 5;
/** Cuánto permanece abierto antes de admitir una prueba. */
export const MS_ABIERTO = 60_000;
/** Cuánto vive el estado en Redis sin actividad. */
const TTL_SEGUNDOS = 24 * 3_600;

/**
 * Fallos que indican que el canal está mal.
 *
 * `resultado-ambiguo` cuenta: un timeout es exactamente la señal de que el
 * otro extremo no está respondiendo bien, aunque no se sepa si el mensaje
 * salió.
 */
export const ABREN_EL_BREAKER = new Set([
  'red',
  'meta-caido',
  'limite-de-tasa',
  'resultado-ambiguo',
  'respuesta-invalida',
]);

/**
 * Fallos que BLOQUEAN la integración: nadie los arregla reintentando.
 *
 * Se separan de los que abren el breaker porque el breaker se cierra solo tras
 * un minuto y estos no deben: un token caducado sigue caducado dentro de una
 * hora. Reintentarlo cada minuto es una tormenta silenciosa contra Meta.
 */
export const BLOQUEAN_LA_INTEGRACION = new Set([
  'token-invalido',
  'token-ilegible',
  'sin-permiso',
  'integracion-desconectada',
  'cuenta-restringida',
]);

/**
 * Toma una prueba en HALF_OPEN, para uno solo.
 *
 * `SET NX` es la operación que impide la estampida: cuando el minuto termina,
 * los veinte trabajos en cola llegan a la vez y todos verían «ya se puede
 * probar». Con esto solo el primero se lleva el permiso y los demás siguen
 * bloqueados hasta que ese diga qué pasó.
 */
export const SCRIPT_TOMAR_PRUEBA = `
local estado = redis.call('HGET', KEYS[1], 'estado')
if estado ~= 'OPEN' and estado ~= 'HALF_OPEN' then
  return 0
end
local proximo = tonumber(redis.call('HGET', KEYS[1], 'proximoIntento') or '0')
local ahora = tonumber(ARGV[1])
if ahora < proximo then
  return 0
end
-- El permiso es una clave aparte con caducidad: si quien lo tomó muere sin
-- reportar, caduca y otro puede probar, en vez de dejar el breaker abierto
-- para siempre.
local tomado = redis.call('SET', KEYS[2], '1', 'NX', 'EX', ARGV[2])
if not tomado then
  return 0
end
redis.call('HSET', KEYS[1], 'estado', 'HALF_OPEN')
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 1
`;

@Injectable()
export class CircuitBreakerWhatsApp {
  private readonly logger = new Logger(CircuitBreakerWhatsApp.name);
  private cliente: Redis | null = null;
  /** Promesa de la conexión en curso, para no lanzar dos. */
  private listo: Promise<unknown> | null = null;

  private clave(integracion: string): string {
    return `flowbot:breaker:${integracion}`;
  }

  private clavePrueba(integracion: string): string {
    return `flowbot:breaker:${integracion}:prueba`;
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
   * ¿Puede pasar este envío?
   *
   * Devuelve además POR QUÉ no, para que la explicación no haya que deducirla
   * del estado.
   */
  async permitir(integracion: string): Promise<{
    permitido: boolean;
    estado: EstadoBreaker;
    /** Segundos hasta el próximo intento, si está cerrado el paso. */
    retryAfterSegundos?: number;
    /** `true` si este envío es la prueba de HALF_OPEN. */
    esPrueba?: boolean;
    motivo?: string;
  }> {
    try {
      const r = await this.conectar();
      const datos = await r.hgetall(this.clave(integracion));

      const estado = (datos.estado as EstadoBreaker) || 'CLOSED';
      if (estado === 'CLOSED') return { permitido: true, estado: 'CLOSED' };

      // La integración bloqueada se marca con una bandera y NO con un estado
      // propio: los tres estados del breaker son los del patrón, y añadir un
      // cuarto obligaría a tratarlo en cada sitio que hoy hace `=== 'OPEN'`.
      if (datos.bloqueada === '1') {
        return {
          permitido: false,
          estado: 'OPEN',
          motivo:
            'El número está bloqueado por un problema de credenciales o permisos. Hay que revisarlo a mano.',
        };
      }

      const ahora = Date.now();
      const tomada = (await r.eval(
        SCRIPT_TOMAR_PRUEBA,
        2,
        this.clave(integracion),
        this.clavePrueba(integracion),
        String(ahora),
        // El permiso caduca en 30 s: más que un envío y menos que la ventana.
        '30',
        String(TTL_SEGUNDOS),
      )) as number;

      if (tomada === 1) {
        return { permitido: true, estado: 'HALF_OPEN', esPrueba: true };
      }

      const proximo = Number(datos.proximoIntento ?? 0);
      return {
        permitido: false,
        estado: estado === 'HALF_OPEN' ? 'HALF_OPEN' : 'OPEN',
        retryAfterSegundos: Math.max(
          1,
          Math.ceil((proximo - ahora) / 1000) || 1,
        ),
        motivo:
          'Hubo varios fallos seguidos con este número y los envíos están en pausa.',
      };
    } catch {
      // Sin Redis no hay estado que consultar. Se deja pasar y que decida el
      // contador de frecuencia, que SÍ falla cerrado: dos guardarraíles
      // fallando cerrado por el mismo motivo bloquearían el producto entero
      // cada vez que Redis parpadea.
      return { permitido: true, estado: 'CLOSED', motivo: 'sin-estado' };
    }
  }

  /** El envío salió. Cierra el breaker y limpia el contador. */
  async registrarExito(integracion: string): Promise<void> {
    try {
      const r = await this.conectar();
      await r
        .multi()
        .hset(this.clave(integracion), {
          estado: 'CLOSED',
          fallosConsecutivos: '0',
          ultimoExito: new Date().toISOString(),
          proximoIntento: '0',
        })
        .hdel(this.clave(integracion), 'bloqueada')
        .del(this.clavePrueba(integracion))
        .expire(this.clave(integracion), TTL_SEGUNDOS)
        .exec();
    } catch {
      this.logger.warn('No se pudo registrar el éxito en el breaker');
    }
  }

  /**
   * El envío falló.
   *
   * Devuelve si el breaker se abrió con este fallo, para poder auditarlo una
   * sola vez en vez de en cada intento.
   */
  async registrarFallo(
    integracion: string,
    errorCode: string,
  ): Promise<{ abierto: boolean; bloqueada: boolean; estado: EstadoBreaker }> {
    // Un fallo de contenido no toca el breaker: el canal está bien.
    if (
      !ABREN_EL_BREAKER.has(errorCode) &&
      !BLOQUEAN_LA_INTEGRACION.has(errorCode)
    ) {
      return { abierto: false, bloqueada: false, estado: 'CLOSED' };
    }

    try {
      const r = await this.conectar();
      const clave = this.clave(integracion);

      if (BLOQUEAN_LA_INTEGRACION.has(errorCode)) {
        // No se reintenta sola: un token caducado sigue caducado dentro de una
        // hora, y reintentarlo cada minuto es una tormenta silenciosa.
        await r
          .multi()
          .hset(clave, {
            estado: 'OPEN',
            bloqueada: '1',
            ultimaCausa: errorCode,
            abiertoEn: new Date().toISOString(),
            // Sin próximo intento: solo lo levanta una persona.
            proximoIntento: String(Number.MAX_SAFE_INTEGER),
          })
          .hincrby(clave, 'aperturas', 1)
          .del(this.clavePrueba(integracion))
          .expire(clave, TTL_SEGUNDOS)
          .exec();
        return { abierto: true, bloqueada: true, estado: 'OPEN' };
      }

      // Un fallo en HALF_OPEN reabre inmediatamente: la prueba dijo que no.
      const estadoPrevio = await r.hget(clave, 'estado');
      const fallos = await r.hincrby(clave, 'fallosConsecutivos', 1);
      const debeAbrir =
        estadoPrevio === 'HALF_OPEN' || fallos >= FALLOS_PARA_ABRIR;

      if (debeAbrir) {
        await r
          .multi()
          .hset(clave, {
            estado: 'OPEN',
            ultimaCausa: errorCode,
            abiertoEn: new Date().toISOString(),
            proximoIntento: String(Date.now() + MS_ABIERTO),
          })
          .hincrby(clave, 'aperturas', 1)
          .del(this.clavePrueba(integracion))
          .expire(clave, TTL_SEGUNDOS)
          .exec();
        return { abierto: true, bloqueada: false, estado: 'OPEN' };
      }

      await r
        .multi()
        .hset(clave, { ultimaCausa: errorCode })
        .expire(clave, TTL_SEGUNDOS)
        .exec();
      return { abierto: false, bloqueada: false, estado: 'CLOSED' };
    } catch {
      this.logger.warn('No se pudo registrar el fallo en el breaker');
      return { abierto: false, bloqueada: false, estado: 'CLOSED' };
    }
  }

  /** Foto del estado, para la pantalla y para el health. */
  async foto(integracion: string): Promise<FotoBreaker> {
    try {
      const d = await (await this.conectar()).hgetall(this.clave(integracion));
      const proximo = Number(d.proximoIntento ?? 0);
      return {
        estado: (d.estado as EstadoBreaker) || 'CLOSED',
        fallosConsecutivos: Number(d.fallosConsecutivos ?? 0),
        abiertoEn: d.abiertoEn ?? null,
        proximoIntento:
          proximo > 0 && proximo < Number.MAX_SAFE_INTEGER
            ? new Date(proximo).toISOString()
            : null,
        ultimaCausa: d.ultimaCausa ?? null,
        ultimoExito: d.ultimoExito ?? null,
        aperturas: Number(d.aperturas ?? 0),
      };
    } catch {
      return {
        estado: 'CLOSED',
        fallosConsecutivos: 0,
        abiertoEn: null,
        proximoIntento: null,
        ultimaCausa: null,
        ultimoExito: null,
        aperturas: 0,
      };
    }
  }

  /**
   * Levanta el breaker a mano.
   *
   * NO SALTA NINGÚN OTRO GUARDARRAÍL: cerrar el breaker solo dice «vuelve a
   * intentarlo». El kill switch, las listas de permitidos y el contador de
   * frecuencia siguen exactamente donde estaban.
   */
  async reiniciar(integracion: string): Promise<void> {
    try {
      await (
        await this.conectar()
      ).del(this.clave(integracion), this.clavePrueba(integracion));
    } catch {
      this.logger.warn('No se pudo reiniciar el breaker');
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
