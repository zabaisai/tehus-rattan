/**
 * PRUEBA DE CARGA CONTROLADA — contador y breaker bajo concurrencia.
 *
 * Lanza N clientes simultáneos contra Redis REAL, como harían N workers, y
 * comprueba que el sistema aguanta las tres propiedades que importan:
 *
 *   1. no se supera el límite;
 *   2. los contadores coinciden exactamente con los permisos concedidos;
 *   3. en HALF_OPEN pasa una sola prueba, sin estampida.
 *
 * NO LLAMA A META. No hay transporte por ningún lado: esto mide los
 * guardarraíles, que es donde vive la carrera.
 *
 * Uso:  node scripts/flowbot-carga-concurrente.mjs [concurrencia] [rondas]
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
process.env.REDIS_HOST = process.env.REDIS_HOST?.trim() || '127.0.0.1';

const CONCURRENCIA = Number(process.argv[2] ?? 50);
const RONDAS = Number(process.argv[3] ?? 4);

const { ContadorFrecuencia } = require('../dist/src/modules/flowbot/engine/adapters/flowbot.whatsapp.frecuencia.js');
const { CircuitBreakerWhatsApp, FALLOS_PARA_ABRIR } = require('../dist/src/modules/flowbot/engine/adapters/flowbot.whatsapp.breaker.js');
const { buildRedisConnection } = require('../dist/src/common/queue/queue.config.js');
const Redis = require('ioredis');

const redis = new Redis({ ...buildRedisConnection(), maxRetriesPerRequest: 2 });

const resultados = [];
function comprobar(titulo, ok, detalle = '') {
  resultados.push({ titulo, ok, detalle });
  console.log(
    `${ok ? 'OK   ' : 'FALLO'} ${titulo}${detalle ? ` — ${detalle}` : ''}`,
  );
}

async function limpiar() {
  const claves = await redis.keys('flowbot:*');
  if (claves.length > 0) await redis.del(...claves);
}

async function main() {
  await limpiar();
  console.log(
    `Concurrencia ${CONCURRENCIA}, ${RONDAS} rondas. Redis real, Meta NO.\n`,
  );

  // ── 1. El límite no se supera, con muchos clientes a la vez ────
  const LIMITE = 25;
  process.env.FLOWBOT_RATE_EMPRESA_MINUTO = String(LIMITE);
  process.env.FLOWBOT_RATE_CONVERSACION_MINUTO = '100000';
  process.env.FLOWBOT_RATE_DESTINATARIO_MINUTO = '100000';
  process.env.FLOWBOT_RATE_GLOBAL_MINUTO = '100000';
  process.env.FLOWBOT_RATE_INTEGRACION_MINUTO = '100000';
  process.env.FLOWBOT_RATE_NUMERO_MINUTO = '100000';
  process.env.FLOWBOT_RATE_BOT_MINUTO = '100000';

  // Un contador por "worker": cada uno con su propia conexión, como en
  // producción. Compartir una sola instancia no probaría nada.
  const contadores = Array.from(
    { length: CONCURRENCIA },
    () => new ContadorFrecuencia(),
  );

  const claves = {
    companyId: 'carga-emp',
    integrationId: 'carga-int',
    phoneNumberId: 'carga-num',
    flowBotId: 'carga-bot',
    conversationId: 'carga-conv',
    destinatario: '573001112233',
  };

  let permitidosTotal = 0;
  for (let ronda = 0; ronda < RONDAS; ronda++) {
    const r = await Promise.all(
      contadores.map((c) => c.reservar(claves)),
    );
    permitidosTotal += r.filter((x) => x.permitido).length;
  }

  const enRedis = Number(
    (await redis.get('flowbot:rate:empresa:carga-emp:minuto')) ?? '0',
  );

  comprobar(
    'no se supera el límite con ' + CONCURRENCIA * RONDAS + ' intentos a la vez',
    permitidosTotal === LIMITE,
    `${permitidosTotal} permitidos de un techo de ${LIMITE}`,
  );
  comprobar(
    'las métricas coinciden con los resultados',
    enRedis === permitidosTotal,
    `contador=${enRedis} permisos=${permitidosTotal}`,
  );
  comprobar(
    'no hay duplicados: ni un permiso de más',
    permitidosTotal <= LIMITE,
  );

  // ── 2. HALF_OPEN sin estampida ─────────────────────────────────
  await limpiar();
  const breakers = Array.from(
    { length: CONCURRENCIA },
    () => new CircuitBreakerWhatsApp(),
  );
  const INTEGRACION = 'carga-integracion';

  for (let k = 0; k < FALLOS_PARA_ABRIR; k++) {
    await breakers[0].registrarFallo(INTEGRACION, 'red');
  }
  // Se adelanta el momento del próximo intento: probar esperando 60 s no
  // añadiría información y haría la prueba inutilizable.
  await redis.hset(`flowbot:breaker:${INTEGRACION}`, 'proximoIntento', '1');

  const puertas = await Promise.all(
    breakers.map((b) => b.permitir(INTEGRACION)),
  );
  const pasaron = puertas.filter((p) => p.permitido).length;

  comprobar(
    'en HALF_OPEN pasa UNA sola prueba entre ' + CONCURRENCIA + ' simultáneas',
    pasaron === 1,
    `${pasaron} pasaron`,
  );

  // ── 3. Ni conexiones desbocadas ni reintentos infinitos ────────
  const clientes = await redis.info('clients');
  const conectados = Number(
    /connected_clients:(\d+)/.exec(clientes)?.[1] ?? '0',
  );
  comprobar(
    'las conexiones a Redis no se desbocan',
    conectados < CONCURRENCIA * 4,
    `${conectados} conexiones abiertas`,
  );

  const inicio = Date.now();
  await Promise.all(contadores.map((c) => c.reservar(claves)));
  const duracion = Date.now() - inicio;
  comprobar(
    'una ronda bloqueada resuelve rápido: no hay reintentos infinitos',
    duracion < 5_000,
    `${duracion} ms`,
  );

  // ── cierre ─────────────────────────────────────────────────────
  await Promise.all(contadores.map((c) => c.cerrar()));
  await Promise.all(breakers.map((b) => b.cerrar()));
  await limpiar();
  await redis.quit().catch(() => undefined);
  redis.disconnect();

  const fallos = resultados.filter((r) => !r.ok);
  console.log(
    `\n${resultados.length - fallos.length}/${resultados.length} comprobaciones OK`,
  );
  process.exit(fallos.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
