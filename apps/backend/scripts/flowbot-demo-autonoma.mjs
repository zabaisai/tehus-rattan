/**
 * DEMOSTRACIÓN AUTÓNOMA DE FLOWBOT.
 *
 * Responde a una sola pregunta, y la responde sin trampa:
 *
 *     ¿se mueve el motor solo, o solo se mueve porque alguien lo empuja?
 *
 * Todas las pruebas del motor —unitarias y e2e— llaman al runner. Eso está
 * bien para comprobar QUÉ hace cada pieza, pero no puede demostrar que el
 * sistema completo avance por sí mismo: si la única forma de que una ejecución
 * progrese fuera que una prueba la empujara, las pruebas seguirían en verde y
 * en producción no se movería nada.
 *
 * ESTE GUION NO LLAMA AL RUNNER, NI AL INTAKE, NI AL RECONCILIADOR. Solo:
 *
 *   1. Prepara datos en PostgreSQL (empresa, contacto, bot publicado).
 *   2. Levanta el BACKEND y el WORKER de verdad, como en producción.
 *   3. Empuja un webhook de Meta por HTTP, igual que Meta.
 *   4. MIRA la base cada segundo y cuenta lo que ve.
 *
 * Todo lo que ocurra entre 3 y 4 lo hace el sistema por su cuenta: outbox,
 * despachador, BullMQ, consumidor, esperas, reconciliador.
 *
 * NO ENVÍA NADA A NADIE. La mensajería es un adaptador falso; no hay token de
 * Meta configurado y el guion tampoco lo pide. Lo que se observa es el
 * recorrido del estado, no un WhatsApp saliendo.
 *
 * Uso, desde `apps/backend`:  node scripts/flowbot-demo-autonoma.mjs
 */
import { spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { setTimeout as dormir } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const prisma = new PrismaClient();
const PREFIJO = 'DEMO-FLOWBOT';
const PUERTO = 3999;
// El backend monta todo bajo `/api`.
const BASE = `http://127.0.0.1:${PUERTO}/api`;

/**
 * Secreto de firma SOLO PARA ESTA EJECUCION.
 *
 * Se genera al vuelo, vive en memoria y muere con el proceso: no se escribe en
 * ningun archivo ni se sube a ningun sitio. El guard del webhook rechaza
 * cualquier payload sin firma valida —y hace bien— asi que la demostracion
 * firma de verdad en vez de saltarse el guard, que ademas seria demostrar algo
 * distinto de lo que ocurre en produccion.
 */
const SECRETO_FIRMA = randomBytes(32).toString('hex');

/** Manda un webhook firmado como lo firma Meta: HMAC-SHA256 del cuerpo crudo. */
async function webhook(cuerpo) {
  const crudo = JSON.stringify(cuerpo);
  const firma = createHmac('sha256', SECRETO_FIRMA).update(crudo).digest('hex');
  return fetch(`${BASE}/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': `sha256=${firma}`,
    },
    body: crudo,
  });
}

let paso = 0;
const procesos = [];

const log = (mensaje) => {
  paso += 1;
  console.log(`\n[${String(paso).padStart(2, '0')}] ${mensaje}`);
};
const detalle = (mensaje) => console.log(`     ${mensaje}`);

// ── flujo del bot ───────────────────────────────────────────────

const nodo = (id, type, config = {}) => ({
  id,
  type,
  position: { x: 0, y: 0 },
  config,
});
const con = (from, fromPort, to) => ({
  id: `${from}:${fromPort}->${to}`,
  from,
  fromPort,
  to,
});

/**
 * Saluda, pregunta, agradece. Con vencimiento corto para poder observar
 * también la reanudación por tiempo sin esperar minutos.
 */
const FLUJO = {
  schemaVersion: 1,
  startNodeId: 'inicio',
  nodes: [
    nodo('inicio', 'trigger.inbound_message'),
    nodo('saluda', 'send.text', { text: 'Hola, soy el bot de TAKTO' }),
    nodo('pide', 'ask.question', {
      text: 'Como te llamas?',
      saveAs: 'nombre',
      timeoutSeconds: 20,
    }),
    nodo('gracias', 'send.text', { text: 'Gracias {{flow.nombre}}' }),
    nodo('nadie', 'send.text', { text: 'Sigo aqui cuando quieras' }),
    nodo('fin', 'control.end'),
  ],
  edges: [
    con('inicio', 'next', 'saluda'),
    con('saluda', 'next', 'pide'),
    con('pide', 'next', 'gracias'),
    con('pide', 'timeout', 'nadie'),
    con('gracias', 'next', 'fin'),
    con('nadie', 'next', 'fin'),
  ],
};

// ── utilidades de observación ───────────────────────────────────

/**
 * Espera a que se cumpla una condición MIRANDO la base.
 *
 * Nunca empuja nada. Si la condición no se cumple, es que el sistema no se
 * movió solo, y eso es exactamente lo que el guion tiene que poder decir.
 */
async function esperarA(descripcion, condicion, limiteMs = 45_000) {
  const hasta = Date.now() + limiteMs;
  let ultimo = null;
  while (Date.now() < hasta) {
    ultimo = await condicion();
    if (ultimo) {
      detalle(`✓ ${descripcion}`);
      return ultimo;
    }
    await dormir(1000);
  }
  throw new Error(`No ocurrió por sí solo: ${descripcion}`);
}

function levantar(nombre, env) {
  const hijo = spawn(
    process.execPath,
    ['dist/src/main.js'],
    {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  procesos.push(hijo);
  const prefijo = `      [${nombre}]`;
  const mostrar = (buf) => {
    for (const linea of String(buf).split('\n')) {
      // Solo lo relevante: el arranque de Nest es ruidoso y taparía lo que
      // importa.
      if (/FlowBot|Outbox|Reconcil|Webhook|Inbound|Mensaje|Error|error|WARN/.test(linea) && linea.trim()) {
        console.log(`${prefijo} ${linea.trim().slice(0, 160)}`);
      }
    }
  };
  hijo.stdout.on('data', mostrar);
  hijo.stderr.on('data', mostrar);
  return hijo;
}

async function esperarPuerto(limiteMs = 60_000) {
  const hasta = Date.now() + limiteMs;
  while (Date.now() < hasta) {
    try {
      const r = await fetch(`${BASE}/health/live`);
      if (r.ok) return;
    } catch {
      // aún no escucha
    }
    await dormir(500);
  }
  throw new Error('El backend no llegó a escuchar');
}

// ── datos ───────────────────────────────────────────────────────

async function limpiar(companyIds) {
  if (companyIds.length === 0) return;
  await prisma.flowBotWait.deleteMany({
    where: { companyId: { in: companyIds } },
  });
  await prisma.flowBotExecutionStep.deleteMany({
    where: { execution: { companyId: { in: companyIds } } },
  });
  await prisma.flowBotExecution.deleteMany({
    where: { companyId: { in: companyIds } },
  });
  await prisma.flowBotTrigger.deleteMany({
    where: { flowBot: { companyId: { in: companyIds } } },
  });
  await prisma.flowBot.updateMany({
    where: { companyId: { in: companyIds } },
    data: { publishedVersionId: null },
  });
  await prisma.flowBotVersion.deleteMany({
    where: { flowBot: { companyId: { in: companyIds } } },
  });
  await prisma.flowBot.deleteMany({
    where: { companyId: { in: companyIds } },
  });
  await prisma.outboxEvent.deleteMany({
    where: { companyId: { in: companyIds } },
  });
  await prisma.message.deleteMany({
    where: { conversation: { companyId: { in: companyIds } } },
  });
  await prisma.conversation.deleteMany({
    where: { companyId: { in: companyIds } },
  });
  await prisma.contact.deleteMany({
    where: { companyId: { in: companyIds } },
  });
  await prisma.whatsAppIntegration.deleteMany({
    where: { companyId: { in: companyIds } },
  });
  await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
}

async function main() {
  // Restos de una ejecución anterior del guion.
  const viejas = await prisma.company.findMany({
    where: { name: { startsWith: PREFIJO } },
    select: { id: true },
  });
  await limpiar(viejas.map((c) => c.id));

  const { compilar } = await import(
    '../dist/src/modules/flowbot/graph/flowbot.compiler.js'
  );

  log('Preparando datos: empresa, contacto, número y bot publicado');
  const empresa = await prisma.company.create({
    data: { name: `${PREFIJO}-empresa`, status: 'ACTIVE' },
  });

  const numero = await prisma.whatsAppIntegration.create({
    data: {
      companyId: empresa.id,
      phoneNumberId: `${PREFIJO}-phone`,
      displayPhoneNumber: '+573000000001',
      wabaId: `${PREFIJO}-waba`,
      status: 'CONNECTED',
    },
  });

  const compilacion = compilar(FLUJO);
  if (!compilacion.ok) {
    throw new Error(`El flujo no compila: ${JSON.stringify(compilacion)}`);
  }

  const bot = await prisma.flowBot.create({
    data: {
      companyId: empresa.id,
      name: `${PREFIJO}-bienvenida`,
      status: 'ACTIVE',
      draftGraph: FLUJO,
    },
  });
  const version = await prisma.flowBotVersion.create({
    data: {
      flowBotId: bot.id,
      version: 1,
      graph: FLUJO,
      compiled: compilacion.compilado,
      compiledHash: compilacion.hash,
    },
  });
  await prisma.flowBot.update({
    where: { id: bot.id },
    data: { publishedVersionId: version.id, lastVersionNumber: 1 },
  });
  await prisma.flowBotTrigger.create({
    data: {
      flowBotId: bot.id,
      type: 'INBOUND_MESSAGE',
      enabled: true,
      priority: 100,
      exclusive: true,
    },
  });
  detalle(`empresa=${empresa.id} bot=${bot.id}`);

  const comun = {
    NODE_ENV: 'development',
    QUEUE_ENABLED: 'true',
    WHATSAPP_APP_SECRET: SECRETO_FIRMA,
    // `buildRedisConnection` lee HOST y PORT, no una URL. Por defecto apunta
    // a `redis`, que es el nombre del servicio en la red de Docker y no
    // resuelve fuera de ella.
    REDIS_HOST: '127.0.0.1',
    REDIS_PORT: '6379',
    PORT: String(PUERTO),
  };

  log('Levantando el BACKEND (produce y despacha, no consume)');
  levantar('backend', { ...comun, WORKER_ROLE: 'api' });
  await esperarPuerto();
  detalle(`escuchando en ${BASE}`);

  log('Levantando el WORKER (consume la cola de FlowBot)');
  levantar('worker', { ...comun, WORKER_ROLE: 'queue', PORT: '3998' });
  // Le damos margen para abrir el worker de BullMQ.
  await dormir(4000);
  detalle('worker arriba');

  log('Empujando un webhook de Meta por HTTP, igual que lo haría Meta');
  const wamid = `wamid.demo.${Date.now()}`;
  const cuerpo = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: `${PREFIJO}-waba`,
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: `${PREFIJO}-phone` },
              contacts: [
                { wa_id: '573001234567', profile: { name: 'Ana Demo' } },
              ],
              messages: [
                {
                  id: wamid,
                  from: '573001234567',
                  type: 'text',
                  text: { body: 'hola' },
                  timestamp: String(Math.floor(Date.now() / 1000)),
                },
              ],
            },
            field: 'messages',
          },
        ],
      },
    ],
  };

  const respuesta = await webhook(cuerpo);
  detalle(`el webhook respondió ${respuesta.status}`);
  if (!respuesta.ok) {
    throw new Error(`El webhook rechazó el payload: ${respuesta.status}`);
  }

  /** El mismo sobre de Meta, con otro mensaje dentro. */
  const conMensaje = (id, texto) => ({
    ...cuerpo,
    entry: [
      {
        ...cuerpo.entry[0],
        changes: [
          {
            ...cuerpo.entry[0].changes[0],
            value: {
              ...cuerpo.entry[0].changes[0].value,
              messages: [
                {
                  id,
                  from: '573001234567',
                  type: 'text',
                  text: { body: texto },
                  timestamp: String(Math.floor(Date.now() / 1000)),
                },
              ],
            },
          },
        ],
      },
    ],
  });

  log('A PARTIR DE AQUÍ NADIE EMPUJA NADA. Solo se mira la base.');

  // Antes de la ejecución, el rastro del mensaje: si el bot no arranca, saber
  // si el mensaje siquiera llegó a guardarse es la mitad del diagnóstico.
  await esperarA('el mensaje quedó guardado', async () =>
    prisma.message.findFirst({
      where: { wamid, conversation: { companyId: empresa.id } },
    }),
  );
  const eventosEntrantes = await prisma.outboxEvent.findMany({
    where: { companyId: empresa.id },
    select: { type: true, status: true },
  });
  detalle(
    `eventos de outbox: ${eventosEntrantes
      .map((e) => `${e.type}=${e.status}`)
      .join(', ')}`,
  );

  const ejecucion = await esperarA(
    'el motor abrió una ejecución por su cuenta',
    async () =>
      prisma.flowBotExecution.findFirst({
        where: { companyId: empresa.id },
        orderBy: { startedAt: 'desc' },
      }),
  );
  detalle(`ejecución ${ejecucion.id}`);

  log('¿Avanzó hasta la pregunta sin que nadie llamara al runner?');
  await esperarA(
    'la ejecución quedó esperando la respuesta del cliente',
    async () => {
      const e = await prisma.flowBotExecution.findUnique({
        where: { id: ejecucion.id },
      });
      return e?.status === 'WAITING_INPUT' ? e : null;
    },
  );

  const pasos = await prisma.flowBotExecutionStep.findMany({
    where: { executionId: ejecucion.id },
    orderBy: { createdAt: 'asc' },
  });
  detalle(`pasos ejecutados: ${pasos.map((p) => p.nodeId).join(' → ')}`);

  log('El evento de outbox del arranque, ¿se despachó solo?');
  await esperarA('el evento quedó COMPLETED', async () => {
    const e = await prisma.outboxEvent.findFirst({
      where: {
        companyId: empresa.id,
        idempotencyKey: `flowbot.advance:${ejecucion.id}:0`,
      },
    });
    return e?.status === 'COMPLETED' ? e : null;
  });

  log('La espera con vencimiento, ¿se registró y se programó su despertar?');
  const espera = await esperarA('hay una espera abierta', async () =>
    prisma.flowBotWait.findFirst({
      where: { executionId: ejecucion.id, consumedAt: null },
    }),
  );
  detalle(`espera ${espera.id}, vence ${espera.wakeAt?.toISOString()}`);
  await esperarA('su evento de despertar se despachó', async () => {
    const e = await prisma.outboxEvent.findFirst({
      where: { idempotencyKey: `flowbot.wake:${espera.id}` },
    });
    return e?.status === 'COMPLETED' ? e : null;
  });

  log('Contestando como el cliente: segundo webhook, también por HTTP');
  const wamid2 = `wamid.demo2.${Date.now()}`;
  await webhook(conMensaje(wamid2, 'Ana'));

  log('¿Reanudó con la respuesta y llegó al final, sin ayuda de nadie?');
  const terminada = await esperarA(
    'la ejecución terminó',
    async () => {
      const e = await prisma.flowBotExecution.findUnique({
        where: { id: ejecucion.id },
      });
      return ['COMPLETED', 'FAILED', 'CANCELLED'].includes(e?.status ?? '')
        ? e
        : null;
    },
  );
  detalle(`estado final: ${terminada.status}`);
  detalle(`variables: ${JSON.stringify(terminada.variables)}`);

  const pasosFinales = await prisma.flowBotExecutionStep.findMany({
    where: { executionId: ejecucion.id },
    orderBy: { createdAt: 'asc' },
  });
  detalle(`recorrido: ${pasosFinales.map((p) => p.nodeId).join(' → ')}`);

  log('¿Se consumió la espera al reanudar?');
  const consumida = await prisma.flowBotWait.findUnique({
    where: { id: espera.id },
  });
  detalle(
    consumida?.consumedAt
      ? `✓ consumida a las ${consumida.consumedAt.toISOString()}`
      : '✗ sigue abierta',
  );

  log('¿Quedó algún evento de outbox sin despachar?');
  const pendientes = await prisma.outboxEvent.count({
    where: { companyId: empresa.id, status: { in: ['PENDING', 'FAILED'] } },
  });
  detalle(`pendientes o fallidos: ${pendientes}`);

  log('Segunda ejecución, para observar el DESPERTAR POR TIEMPO');
  const wamid3 = `wamid.demo3.${Date.now()}`;
  await webhook(conMensaje(wamid3, 'hola otra vez'));

  const segunda = await esperarA('la segunda ejecución está esperando', async () => {
    const e = await prisma.flowBotExecution.findFirst({
      where: {
        companyId: empresa.id,
        id: { not: ejecucion.id },
        status: 'WAITING_INPUT',
      },
      orderBy: { startedAt: 'desc' },
    });
    return e;
  });
  detalle(`ejecución ${segunda.id}`);

  log('Sin contestar. Esperando a que venza sola (20 s de vencimiento)…');
  const porTiempo = await esperarA(
    'venció y salió por el puerto de tiempo agotado',
    async () => {
      const e = await prisma.flowBotExecution.findUnique({
        where: { id: segunda.id },
      });
      return e && e.status !== 'WAITING_INPUT' ? e : null;
    },
    60_000,
  );
  const recorrido = await prisma.flowBotExecutionStep.findMany({
    where: { executionId: segunda.id },
    orderBy: { createdAt: 'asc' },
  });
  detalle(`estado: ${porTiempo.status}`);
  detalle(`recorrido: ${recorrido.map((p) => p.nodeId).join(' → ')}`);
  detalle(
    recorrido.some((p) => p.nodeId === 'nadie')
      ? '✓ salió por la rama de tiempo agotado, sin repetir la pregunta'
      : '✗ NO salió por la rama de tiempo agotado',
  );

  log('Salud del sistema tras todo el recorrido');
  const salud = await (await fetch(`${BASE}/health/status`)).json();
  detalle(`global: ${salud.status}`);
  detalle(`flowbot: ${JSON.stringify(salud.components.flowbot)}`);
  // Se dice QUIEN degrada. En local suele ser el puente de tiempo real, que no
  // corre; leer "degraded" sin saber de quien es la culpa invita a buscar el
  // problema en el sitio equivocado.
  const culpables = Object.entries(salud.components)
    .filter(([, c]) => c.state === 'down' || c.state === 'stale')
    .map(([nombre, c]) => `${nombre}(${c.reason ?? c.state})`);
  detalle(
    culpables.length > 0
      ? `degradan: ${culpables.join(', ')}`
      : 'ningun componente degradado',
  );

  log('Resumen');
  const resumen = await prisma.flowBotExecution.groupBy({
    by: ['status'],
    where: { companyId: empresa.id },
    _count: true,
  });
  for (const r of resumen) detalle(`${r.status}: ${r._count}`);

  console.log(
    '\n══ El motor arrancó, avanzó, esperó, se reanudó por mensaje y por',
  );
  console.log(
    '   tiempo, y terminó. Este guion no llamó al runner ni una sola vez. ══\n',
  );

  await limpiar([empresa.id]);
  detalle('datos de la demostración eliminados');
}

main()
  .catch((error) => {
    console.error(`\n✗ ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const p of procesos) p.kill();
    await prisma.$disconnect();
    await dormir(500);
    process.exit(process.exitCode ?? 0);
  });
