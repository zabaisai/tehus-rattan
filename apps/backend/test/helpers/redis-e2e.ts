import Redis from 'ioredis';
import { buildRedisConnection } from '../../src/common/queue/queue.config';

/**
 * Clientes de Redis para las pruebas E2E.
 *
 * POR QUÉ NO SE USA `buildRedisConnection` A SECAS. Esa configuración está
 * pensada para BullMQ en producción: lleva `maxRetriesPerRequest: null`
 * —comandos que reintentan para siempre— y la estrategia de reconexión por
 * defecto de ioredis, que reintenta abrir el socket indefinidamente. En
 * producción eso es lo correcto: un corte de Redis no debe tirar el worker.
 *
 * En una suite es exactamente lo contrario de lo que hace falta, y el CI lo
 * demostró: sin Redis, los comandos fallaban y el proceso se quedaba con un
 * socket reintentando para siempre. Jest terminaba las pruebas en dos minutos,
 * no podía salir, y GitHub cancelaba el job a los veinticinco.
 *
 * NO SE CAMBIA LA RESILIENCIA DE PRODUCCIÓN para que pase el CI: se acota
 * SOLO aquí, en el código de pruebas.
 */

/** Espera máxima para decidir que Redis no está. Corta a propósito. */
export const ESPERA_CONEXION_MS = 2_000;

export function crearClienteE2E(): Redis {
  return new Redis({
    ...buildRedisConnection(),
    // Los comandos no reintentan indefinidamente...
    maxRetriesPerRequest: 2,
    // ...y la CONEXIÓN tampoco. Son dos límites distintos y el segundo es el
    // que dejaba el proceso vivo: `maxRetriesPerRequest` acota los comandos,
    // no los intentos de abrir el socket.
    retryStrategy: () => null,
    connectTimeout: ESPERA_CONEXION_MS,
    // Con la cola de espera activada, el primer comando espera a que la
    // conexión esté lista en vez de fallar por llegar medio segundo antes.
    enableOfflineQueue: true,
    lazyConnect: true,
  });
}

/**
 * Abre la conexión y espera a que esté lista.
 *
 * Se llama en `beforeAll`: así, cuando Redis no está, la suite falla en dos
 * segundos con un mensaje que se entiende, en vez de fallar test a test con
 * `MaxRetriesPerRequestError` y dejar el proceso colgado.
 */
export async function conectarE2E(cliente: Redis): Promise<void> {
  const donde = `${buildRedisConnection().host}:${buildRedisConnection().port}`;
  try {
    await cliente.connect();
    await cliente.ping();
  } catch (causa) {
    // El error crudo de ioredis es «Connection is closed», que no dice ni
    // dónde intentó conectar ni qué hacer. Quien vea esto en un CI rojo tiene
    // que poder arreglarlo sin abrir el código.
    throw new Error(
      `No hay Redis en ${donde}. Estas pruebas lo necesitan de verdad: ` +
        'levántalo (`docker compose up -d redis`) o define REDIS_HOST/REDIS_PORT. ' +
        `Causa: ${causa instanceof Error ? causa.message : String(causa)}`,
    );
  }
}

/**
 * Cierra el cliente de forma IDEMPOTENTE.
 *
 * `quit()` espera a que Redis conteste —y falla si ya no hay conexión—;
 * `disconnect()` corta los temporizadores de reconexión que ioredis deja
 * vivos. Hacen falta los dos, y en este orden.
 *
 * El `catch` cubre solo el caso de «ya estaba cerrado», que no es un fallo:
 * NO esconde un cierre que no ocurrió, porque `disconnect()` va después y ese
 * es el que suelta el handle.
 */
export async function cerrarClienteE2E(cliente: Redis | null): Promise<void> {
  if (!cliente) return;
  if (cliente.status !== 'end') {
    await cliente.quit().catch(() => undefined);
  }
  cliente.disconnect();
}

/**
 * Borra SOLO las claves de esta suite.
 *
 * SE FILTRA POR PREFIJO en vez de barrer `flowbot:*`, y desde luego en vez de
 * `FLUSHALL`: dos suites que se limpiaran entre sí se pisarían los contadores,
 * y un `FLUSHALL` se llevaría por delante los datos de quien esté usando el
 * mismo Redis para otra cosa —en local, el del propio desarrollador—.
 *
 * Se usa `scanStream` y no `KEYS` porque `KEYS` bloquea el servidor entero
 * mientras recorre.
 *
 * LA EXCEPCIÓN HONESTA: el contador `global` no lleva identificador de nadie
 * —su clave es `flowbot:rate:global:all:*`— así que no puede llevar prefijo de
 * suite. Es estado genuinamente compartido. Se limpia igual porque, si no, la
 * segunda suite arranca con el cupo global medio gastado por la primera; y es
 * seguro hacerlo porque las E2E corren con `--runInBand`, es decir, en serie.
 * Si algún día se paralelizan, ESTA es la línea que hay que revisar.
 */
export async function limpiarClavesDeSuite(
  cliente: Redis,
  /**
   * Trozos de clave que identifican a esta suite.
   *
   * Se pasan los IDENTIFICADORES REALES, no el nombre de la suite: las claves
   * del contador se construyen con `companyId`, `conversationId` y demás, que
   * en varias suites son cuid generados por la base y no contienen el prefijo
   * legible. Filtrar por «E2E-ENV» no encontraba nada y la limpieza no
   * limpiaba: se descubrió contando las claves que quedaban al terminar.
   */
  marcadores: string | readonly string[],
): Promise<number> {
  const buscados = (
    typeof marcadores === 'string' ? [marcadores] : marcadores
  ).filter(Boolean);
  const encontradas: string[] = [];

  await new Promise<void>((resolve, reject) => {
    const flujo = cliente.scanStream({ match: 'flowbot:*', count: 200 });
    flujo.on('data', (lote: string[]) => {
      for (const clave of lote) {
        const esDeLaSuite = buscados.some((m) => clave.includes(m));
        const esGlobalCompartida = clave.startsWith('flowbot:rate:global:');
        if (esDeLaSuite || esGlobalCompartida) encontradas.push(clave);
      }
    });
    flujo.on('end', () => resolve());
    flujo.on('error', reject);
  });

  if (encontradas.length > 0) await cliente.del(...encontradas);
  return encontradas.length;
}
