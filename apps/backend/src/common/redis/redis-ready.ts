import type { Redis } from 'ioredis';

/**
 * Esperar a que un cliente de Redis esté LISTO antes de usarlo.
 *
 * VIVE AQUÍ, EN UN SOLO SITIO, PORQUE TENERLO DUPLICADO YA COSTÓ UN
 * DESPLIEGUE. El puente de tiempo real hacía `ping()` justo después de
 * construir el cliente; ioredis conecta de forma asíncrona, así que con
 * `enableOfflineQueue: false` el comando se rechazaba en el acto con
 * «Stream isn't writeable» y el puente quedaba apagado contra una Redis sana.
 *
 * El sondeo de la cola tenía EXACTAMENTE el mismo fallo por otro camino: con
 * `lazyConnect: true` el estado inicial de ioredis es `'wait'`, y solo se
 * llamaba a `connect()` si el estado era `'end'` o `'close'`. El primer
 * sondeo tras arrancar pingueaba un socket sin abrir y devolvía «cola caída»
 * sobre una Redis perfectamente disponible.
 *
 * Dos copias de esta lógica son dos oportunidades de repetir el mismo fallo.
 */

/**
 * Cuánto se espera a Redis antes de darla por no disponible.
 *
 * Tres segundos sobran para una Redis en la misma red de Docker, y a cambio
 * una máquina sin Redis arranca igual, solo que degradada. Un proceso que no
 * llega a escuchar es mucho peor que uno sin cola.
 */
export const ESPERA_MAXIMA_REDIS_MS = 3_000;

/**
 * Resuelve a `false` si la tarea no termina a tiempo, en vez de esperar
 * indefinidamente. El temporizador se limpia siempre: dejarlo vivo mantendría
 * el proceso despierto y un `docker stop` acabaría en SIGKILL.
 */
export async function conTiempoLimite(
  tarea: Promise<unknown>,
  ms = ESPERA_MAXIMA_REDIS_MS,
): Promise<boolean> {
  let temporizador: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      tarea,
      new Promise((_, rechazar) => {
        temporizador = setTimeout(
          () => rechazar(new Error('timeout')),
          ms,
        ).unref?.();
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (temporizador) clearTimeout(temporizador);
  }
}

/**
 * Espera a que el cliente acepte comandos.
 *
 * Con `lazyConnect` hay que pedir la conexión explícitamente: el estado
 * inicial es `'wait'` y sin `connect()` nadie la abre nunca.
 *
 * Los escuchadores se retiran SIEMPRE al salir. Sin eso, cada intento fallido
 * dejaría un `once('ready')` vivo sobre un cliente que ioredis sigue
 * reintentando, y una reconexión posterior resolvería una promesa que ya no
 * mira nadie.
 */
export function esperarListo(cliente: Redis): Promise<void> {
  if (cliente.status === 'ready') return Promise.resolve();

  // `wait` es el estado de un cliente perezoso que nadie ha arrancado; `end`
  // y `close` son conexiones caídas que hay que reabrir. En ambos casos, sin
  // pedir la conexión la espera se agotaría por tiempo sin motivo.
  if (
    cliente.status === 'wait' ||
    cliente.status === 'end' ||
    cliente.status === 'close'
  ) {
    // `connect()` rechaza si otro llamador ya la abrió: no es un fallo.
    void Promise.resolve(cliente.connect()).catch(() => undefined);
  }

  return new Promise<void>((resolver, rechazar) => {
    const limpiar = () => {
      cliente.removeListener('ready', alListo);
      cliente.removeListener('end', alCerrar);
    };
    const alListo = () => {
      limpiar();
      resolver();
    };
    // 'end' es el final de la vía: ioredis ya no reintenta. Sin escucharlo, la
    // espera se agotaría por tiempo cuando la respuesta ya se conoce.
    const alCerrar = () => {
      limpiar();
      rechazar(new Error('conexión cerrada'));
    };
    cliente.once('ready', alListo);
    cliente.once('end', alCerrar);
  });
}

/**
 * Espera a estar listo y solo entonces hace PING, todo dentro del mismo
 * límite de tiempo. Lanza si no se pudo: quien llama decide qué significa.
 */
export async function pingCuandoListo(
  cliente: Redis,
  ms = ESPERA_MAXIMA_REDIS_MS,
): Promise<string> {
  const listo = await conTiempoLimite(esperarListo(cliente), ms);
  if (!listo) throw new Error('RedisNoDisponibleError');
  return cliente.ping();
}

/**
 * Comprobación del par de clientes que exige el adaptador de socket.io:
 * ambos listos y ambos respondiendo, dentro del mismo límite.
 */
export async function puenteUtilizable(
  pub: Redis,
  sub: Redis,
  ms = ESPERA_MAXIMA_REDIS_MS,
): Promise<boolean> {
  return conTiempoLimite(
    (async () => {
      await Promise.all([esperarListo(pub), esperarListo(sub)]);
      await Promise.all([pub.ping(), sub.ping()]);
    })(),
    ms,
  );
}
