/**
 * DEMOSTRACIÓN DE LA API ADMINISTRATIVA DE FLOWBOT.
 *
 * Responde a una pregunta concreta: ¿puede un administrador gobernar FlowBot
 * ENTERO sin escribir JSON a mano en la base?
 *
 * Habla por HTTP con el backend real, con un token real, exactamente como
 * hablará el constructor visual. No importa ningún servicio: si algo solo
 * funciona llamando al servicio por dentro, aquí falla.
 *
 * WhatsApp, HTTP externo e IA siguen siendo falsos. Nada sale a la red.
 *
 * Uso, desde `apps/backend`:  node scripts/flowbot-demo-admin.mjs
 */
import { spawn } from 'node:child_process';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { setTimeout as dormir } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import 'dotenv/config';

const prisma = new PrismaClient();
const PREFIJO = 'DEMO-ADMIN';
const PUERTO = 3995;
const BASE = `http://127.0.0.1:${PUERTO}/api`;

const procesos = [];
let paso = 0;
let fallos = 0;

const log = (m) => {
  paso += 1;
  console.log(`\n[${String(paso).padStart(2, '0')}] ${m}`);
};
const detalle = (m) => console.log(`     ${m}`);

/**
 * Comprueba y CUENTA. Una demostración que solo imprime no demuestra nada:
 * hay que poder mirar el final y saber si pasó o no.
 */
function comprobar(descripcion, condicion, extra = '') {
  if (condicion) {
    console.log(`     PASS  ${descripcion}${extra ? ` · ${extra}` : ''}`);
  } else {
    fallos += 1;
    console.log(`     FAIL  ${descripcion}${extra ? ` · ${extra}` : ''}`);
  }
}

/** Solo los últimos seis caracteres: un id completo en una captura es ruido. */
const corto = (id) => (id ? `…${String(id).slice(-6)}` : '(ninguno)');

// ── arranque del backend ────────────────────────────────────────

function levantar(nombre, env) {
  const hijo = spawn(process.execPath, ['dist/src/main.js'], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  procesos.push(hijo);
  const mostrar = (buf) => {
    for (const linea of String(buf).split('\n')) {
      if (/ERROR|Error:/.test(linea) && linea.trim()) {
        console.log(`      [${nombre}] ${linea.trim().slice(0, 160)}`);
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

// ── cliente HTTP ────────────────────────────────────────────────

let token = '';

async function api(metodo, ruta, cuerpo, tokenPropio) {
  const r = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: {
      authorization: `Bearer ${tokenPropio ?? token}`,
      ...(cuerpo ? { 'content-type': 'application/json' } : {}),
    },
    ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
  });
  const texto = await r.text();
  let datos = null;
  try {
    datos = texto ? JSON.parse(texto) : null;
  } catch {
    datos = { crudo: texto.slice(0, 200) };
  }
  return { estado: r.status, datos };
}

// ── limpieza ────────────────────────────────────────────────────

async function limpiar(ids) {
  if (ids.length === 0) return;
  const w = { companyId: { in: ids } };
  await prisma.conversationHandoff.deleteMany({ where: w });
  await prisma.flowBotWait.deleteMany({ where: w });
  await prisma.flowBotExecutionStep.deleteMany({
    where: { execution: w },
  });
  await prisma.flowBotExecution.deleteMany({ where: w });
  await prisma.flowBotTrigger.deleteMany({ where: { flowBot: w } });
  await prisma.flowBot.updateMany({ where: w, data: { publishedVersionId: null } });
  await prisma.flowBotVersion.deleteMany({ where: { flowBot: w } });
  await prisma.flowBot.deleteMany({ where: w });
  await prisma.outboxEvent.deleteMany({ where: w });
  await prisma.auditLog.deleteMany({ where: { affectedCompanyId: { in: ids } } });
  await prisma.message.deleteMany({ where: { conversation: w } });
  await prisma.conversation.deleteMany({ where: w });
  await prisma.lead.deleteMany({ where: w });
  await prisma.contact.deleteMany({ where: w });
  await prisma.companyLeadSettings.deleteMany({ where: w });
  await prisma.pipelineStage.deleteMany({ where: { pipeline: w } });
  await prisma.pipeline.deleteMany({ where: w });
  await prisma.whatsAppIntegration.deleteMany({ where: w });
  await prisma.userSession.deleteMany({ where: w });
  await prisma.user.deleteMany({ where: w });
  await prisma.company.deleteMany({ where: { id: { in: ids } } });
}

async function main() {
  const viejas = await prisma.company.findMany({
    where: { name: { startsWith: PREFIJO } },
    select: { id: true },
  });
  await limpiar(viejas.map((c) => c.id));

  // ── datos ──
  log('Preparando empresa, usuarios, número y pipeline');
  const empresa = await prisma.company.create({
    data: { name: `${PREFIJO}-empresa`, status: 'ACTIVE' },
  });

  const admin = await prisma.user.create({
    data: {
      companyId: empresa.id,
      email: `demo-admin-${Date.now()}@ejemplo.test`,
      password: 'no-se-usa',
      name: 'Administradora',
      role: 'ADMIN',
    },
  });
  const agente = await prisma.user.create({
    data: {
      companyId: empresa.id,
      email: `demo-agente-${Date.now()}@ejemplo.test`,
      password: 'no-se-usa',
      name: 'Asesor',
      role: 'AGENT',
    },
  });

  await prisma.whatsAppIntegration.create({
    data: {
      companyId: empresa.id,
      phoneNumberId: `${PREFIJO}-phone`,
      status: 'CONNECTED',
      accessTokenEncrypted: cifrarFalso('token-de-demostracion'),
      isPrimary: true,
    },
  });

  const pipeline = await prisma.pipeline.create({
    data: { companyId: empresa.id, name: `${PREFIJO}-pipeline`, order: 0 },
  });
  await prisma.pipelineStage.create({
    data: {
      pipelineId: pipeline.id,
      name: 'Bandeja de entrada',
      order: 0,
      isInitial: true,
    },
  });
  detalle(`empresa=${corto(empresa.id)} admin=${corto(admin.id)}`);

  // ── backend ──
  log('Levantando el BACKEND real');
  levantar('backend', {
    NODE_ENV: 'development',
    QUEUE_ENABLED: 'false',
    PORT: String(PUERTO),
    WORKER_ROLE: 'api',
  });
  await esperarPuerto();

  const secreto = process.env.JWT_SECRET;
  if (!secreto) throw new Error('Falta JWT_SECRET en .env');

  /**
   * Un token SIN sesion se rechaza: la revocacion tiene que ser inmediata y
   * eso solo funciona si cada token apunta a una fila que se puede matar. Asi
   * que la demostracion crea la sesion de verdad, igual que un login, y de
   * paso ejercita ese camino en vez de saltarselo.
   */
  const firmar = async (u) => {
    const sesion = await prisma.userSession.create({
      data: {
        userId: u.id,
        companyId: u.companyId,
        deviceIdHash: createHash('sha256').update(`demo-${u.id}`).digest('hex'),
        refreshTokenHash: randomBytes(24).toString('hex'),
        status: 'ACTIVE',
      },
    });
    return jwt.sign(
      {
        sub: u.id,
        email: u.email,
        role: u.role,
        companyId: u.companyId,
        sid: sesion.id,
      },
      secreto,
      { expiresIn: '10m' },
    );
  };
  token = await firmar(admin);
  const tokenAgente = await firmar(agente);
  detalle(`escuchando en ${BASE}`);

  // ── 1. catálogo y plantillas ──
  log('El catálogo de nodos y las plantillas los sirve la API');
  const catalogo = await api('GET', '/flowbots/catalog');
  const plantillas = await api('GET', '/flowbots/templates');
  if (catalogo.estado !== 200) {
    // Diagnóstico inmediato: sin catálogo no hay nada que demostrar, y saber
    // POR QUÉ falla ahorra media hora de adivinar.
    detalle(`respuesta: ${catalogo.estado} ${JSON.stringify(catalogo.datos)}`);
  }
  comprobar('catálogo disponible', catalogo.estado === 200);
  comprobar(
    'todos los nodos declaran si están disponibles',
    catalogo.datos?.nodos?.every((x) => typeof x.disponible === 'boolean'),
    `${catalogo.datos?.nodos?.length ?? 0} nodos`,
  );
  comprobar('hay ocho plantillas', plantillas.datos?.length === 8);

  // ── 2. crear desde plantilla ──
  log('Creando un bot desde una plantilla');
  const sinPendientes = plantillas.datos.find(
    (p) => p.camposPorCompletar.length === 0,
  );
  const creado = await api(
    'POST',
    `/flowbots/templates/${sinPendientes.clave}/use`,
    { nombre: `${PREFIJO}-bot` },
  );
  const botId = creado.datos?.id;
  comprobar('bot creado', creado.estado === 201 && Boolean(botId));
  comprobar('nace en DRAFT', creado.datos?.status === 'DRAFT', corto(botId));

  // ── 3. guardar borrador ──
  log('Guardando el borrador');
  const borrador = await api('GET', `/flowbots/${botId}/draft`);
  const guardado = await api('POST', `/flowbots/${botId}/draft`, {
    graph: borrador.datos.graph,
    revision: borrador.datos.revision,
  });
  comprobar('guardado', guardado.estado === 201);
  comprobar('la revisión subió', guardado.datos?.revision === 1);

  // ── 4. conflicto optimista ──
  log('Provocando un conflicto: dos administradores sobre la misma revisión');
  const conflicto = await api('POST', `/flowbots/${botId}/draft`, {
    graph: borrador.datos.graph,
    // La revisión VIEJA: es lo que tendría abierto el segundo administrador.
    revision: borrador.datos.revision,
  });
  comprobar('responde 409, no sobrescribe', conflicto.estado === 409);
  comprobar(
    'el 409 trae el grafo actual para poder comparar',
    Boolean(conflicto.datos?.message?.graphActual ?? conflicto.datos?.graphActual),
  );

  // ── 5. corregirlo ──
  log('Corrigiendo el conflicto con la revisión buena');
  const actual = await api('GET', `/flowbots/${botId}/draft`);
  const corregido = await api('POST', `/flowbots/${botId}/draft`, {
    graph: actual.datos.graph,
    revision: actual.datos.revision,
  });
  comprobar('ahora sí guarda', corregido.estado === 201);
  comprobar('revisión 2', corregido.datos?.revision === 2);

  // ── 6. validar ──
  log('Validando el borrador');
  const validacion = await api('POST', '/flowbots/validate', {
    graph: actual.datos.graph,
  });
  comprobar('se puede publicar', validacion.datos?.sePuedePublicar === true);
  comprobar('devuelve huella del compilado', Boolean(validacion.datos?.compiledHash));

  log('Un grafo roto devuelve problemas ESTRUCTURADOS');
  const roto = await api('POST', '/flowbots/validate', {
    graph: { ...actual.datos.graph, edges: [] },
  });
  comprobar('no se puede publicar', roto.datos?.sePuedePublicar === false);
  comprobar(
    'cada problema lleva código estable',
    roto.datos?.problemas?.every((p) => typeof p.codigo === 'string' && p.codigo),
    `${roto.datos?.problemas?.length ?? 0} problemas`,
  );

  // ── 7. simular ──
  log('Simulando SIN efectos reales');
  const antes = await contarOperativas(empresa.id);
  const simulacion = await api('POST', '/flowbots/simulate', {
    graph: actual.datos.graph,
    mensajeInicial: 'hola',
    respuestas: ['Ana', 'Ana'],
  });
  const despues = await contarOperativas(empresa.id);

  comprobar('la simulación corrió', simulacion.estado === 201);
  comprobar(
    'devuelve la ruta recorrida',
    (simulacion.datos?.ruta?.length ?? 0) > 0,
    (simulacion.datos?.ruta ?? []).join(' → '),
  );
  comprobar(
    'explica cada decisión',
    simulacion.datos?.decisiones?.every((d) => d.explicacion?.length > 0),
  );
  comprobar(
    'NO escribió ni una fila operativa',
    JSON.stringify(antes) === JSON.stringify(despues),
    JSON.stringify(despues),
  );

  // ── 8. publicar ──
  log('Publicando');
  const publicada = await api('POST', `/flowbots/${botId}/publish`, {
    nota: 'primera versión',
  });
  comprobar('publicada', publicada.estado === 201);
  comprobar('es la versión 1', publicada.datos?.version === 1);

  const trasPublicar = await api('GET', `/flowbots/${botId}`);
  comprobar(
    'publicar NO activa el bot',
    trasPublicar.datos?.estado === 'DRAFT',
    'publicar y activar son decisiones distintas',
  );

  // ── 9. inmutabilidad ──
  log('Comprobando que la versión publicada es INMUTABLE');
  const v1 = await api(
    'GET',
    `/flowbots/${botId}/versions/${publicada.datos.versionId}`,
  );
  const antesDeEditar = JSON.stringify(v1.datos.graph);

  const b2 = await api('GET', `/flowbots/${botId}/draft`);
  const modificado = JSON.parse(JSON.stringify(b2.datos.graph));
  modificado.nodes[1].config = { ...modificado.nodes[1].config, text: 'CAMBIADO' };
  await api('POST', `/flowbots/${botId}/draft`, {
    graph: modificado,
    revision: b2.datos.revision,
  });

  const v1otraVez = await api(
    'GET',
    `/flowbots/${botId}/versions/${publicada.datos.versionId}`,
  );
  comprobar(
    'el grafo congelado NO cambió al editar el borrador',
    JSON.stringify(v1otraVez.datos.graph) === antesDeEditar,
  );

  // ── 10. activar ──
  log('Activando el bot y configurando su disparador');
  const activado = await api('POST', `/flowbots/${botId}/status`, {
    estado: 'ACTIVE',
  });
  comprobar('activado', activado.estado === 201);

  const disparador = await api('POST', `/flowbots/${botId}/triggers`, {
    tipo: 'INBOUND_MESSAGE',
    prioridad: 100,
    exclusivo: true,
  });
  comprobar('disparador creado', disparador.estado === 201);
  comprobar('es exclusivo', disparador.datos?.exclusivo === true);

  // ── 11. ejecución ──
  log('Creando una ejecución y consultando el historial');
  const contacto = await prisma.contact.create({
    data: {
      companyId: empresa.id,
      phone: '+573001234567',
      name: 'Cliente de prueba',
    },
  });
  const conversacion = await prisma.conversation.create({
    data: {
      companyId: empresa.id,
      contactId: contacto.id,
      assignedTo: agente.id,
    },
  });
  const ejecucion = await prisma.flowBotExecution.create({
    data: {
      companyId: empresa.id,
      flowBotId: botId,
      versionId: publicada.datos.versionId,
      conversationId: conversacion.id,
      contactId: contacto.id,
      idempotencyKey: `${PREFIJO}-${Date.now()}`,
      correlationId: `corr-${Date.now()}`,
      status: 'RUNNING',
      steps: 1,
    },
  });

  const historial = await api('GET', '/flowbots/executions/list?limite=10');
  comprobar('el historial la incluye', historial.datos?.items?.length >= 1);
  comprobar(
    'el teléfono NO sale completo',
    !JSON.stringify(historial.datos).includes('573001234567'),
  );

  // ── 12. pausar ──
  log('Pausando la ejecución');
  const pausada = await api(
    'POST',
    `/flowbots/executions/${ejecucion.id}/pause`,
  );
  comprobar('pausada', pausada.estado === 201);

  // ── 13. reanudar ──
  log('Reanudando');
  const reanudada = await api(
    'POST',
    `/flowbots/executions/${ejecucion.id}/resume`,
  );
  comprobar('reanudada', reanudada.estado === 201);

  const evento = await prisma.outboxEvent.findFirst({
    where: {
      companyId: empresa.id,
      idempotencyKey: { contains: `${ejecucion.id}:reanudar` },
    },
  });
  comprobar(
    'reanudar escribió un evento de outbox',
    Boolean(evento),
    'no encola a pelo: si el proceso muere, el despachador lo publica',
  );

  // ── 14. handoff ──
  log('Entregando la conversación a una persona');
  const handoff = await api(
    'POST',
    `/flowbots/executions/${ejecucion.id}/handoff`,
    { asignarA: agente.id, motivo: 'lo pidió el cliente' },
  );
  comprobar('entrega creada', handoff.estado === 201);

  const trasHandoff = await prisma.flowBotExecution.findUnique({
    where: { id: ejecucion.id },
  });
  const conv = await prisma.conversation.findUnique({
    where: { id: conversacion.id },
  });
  comprobar('la ejecución queda HANDED_OFF', trasHandoff?.status === 'HANDED_OFF');
  comprobar('la conversación queda en pausa', conv?.isPaused === true);

  // ── 15. permisos ──
  log('Comprobando permisos: un AGENT no puede publicar ni crear');
  const agenteCrea = await api('POST', '/flowbots', { nombre: 'x' }, tokenAgente);
  const agentePublica = await api(
    'POST',
    `/flowbots/${botId}/publish`,
    {},
    tokenAgente,
  );
  const agenteSimula = await api(
    'POST',
    '/flowbots/simulate',
    { graph: actual.datos.graph },
    tokenAgente,
  );
  comprobar('AGENT no crea bots', agenteCrea.estado === 403);
  comprobar('AGENT no publica', agentePublica.estado === 403);
  comprobar('AGENT SÍ puede simular', agenteSimula.estado === 201);

  const agenteLista = await api(
    'GET',
    '/flowbots/executions/list',
    undefined,
    tokenAgente,
  );
  comprobar(
    'AGENT ve solo lo suyo',
    agenteLista.estado === 200 &&
      agenteLista.datos.items.every((x) => x.asignadoA === agente.id),
    `${agenteLista.datos?.items?.length ?? 0} ejecuciones`,
  );

  // ── 16. métricas ──
  log('Consultando métricas');
  const metricas = await api('GET', '/flowbots/metrics/summary');
  comprobar('métricas disponibles', metricas.estado === 200);
  comprobar(
    'sin PII',
    !JSON.stringify(metricas.datos).includes('573001234567') &&
      !JSON.stringify(metricas.datos).includes('Cliente de prueba'),
  );
  detalle(
    `iniciadas=${metricas.datos?.totales?.iniciadas} entregadas=${metricas.datos?.totales?.entregadas}`,
  );

  // ── 17. restaurar versión ──
  log('Restaurando la versión 1 como borrador nuevo');
  const restaurada = await api(
    'POST',
    `/flowbots/${botId}/versions/${publicada.datos.versionId}/restore`,
  );
  comprobar('restaurada', restaurada.estado === 201);

  const detalleFinal = await api('GET', `/flowbots/${botId}`);
  comprobar(
    'restaurar NO republica: la versión sigue siendo la 1',
    detalleFinal.datos?.versionPublicada === 1,
  );
  comprobar(
    'sigue habiendo UNA sola versión',
    detalleFinal.datos?.versiones?.length === 1,
  );

  // ── 18. auditoría ──
  log('Auditoría');
  const auditoria = await prisma.auditLog.count({
    where: { affectedCompanyId: empresa.id },
  });
  comprobar('las operaciones quedaron auditadas', auditoria > 0, `${auditoria} registros`);

  // ── resumen ──
  log('Resumen');
  detalle(`bot=${corto(botId)} ejecución=${corto(ejecucion.id)}`);
  console.log(
    `\n══ ${fallos === 0 ? 'PASS' : 'FAIL'}: ${fallos} comprobación(es) fallida(s) ══\n`,
  );

  await limpiar([empresa.id]);
  detalle('datos de la demostración eliminados');
  if (fallos > 0) process.exitCode = 1;
}

/** Cuenta las filas que el simulador NUNCA debe tocar. */
async function contarOperativas(companyId) {
  const [ejecuciones, contactos, leads, tareas, mensajes, handoffs] =
    await Promise.all([
      prisma.flowBotExecution.count({ where: { companyId } }),
      prisma.contact.count({ where: { companyId } }),
      prisma.lead.count({ where: { companyId } }),
      prisma.task.count({ where: { companyId } }),
      prisma.message.count({ where: { conversation: { companyId } } }),
      prisma.conversationHandoff.count({ where: { companyId } }),
    ]);
  return { ejecuciones, contactos, leads, tareas, mensajes, handoffs };
}

/**
 * Cifra como `WhatsAppTokenCryptoService`: AES-256-GCM con `sha256` de la
 * clave del entorno. El contenido es la cadena "token-de-demostracion"; no hay
 * ningún token de Meta en este guion.
 */
function cifrarFalso(texto) {
  const secreto = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY;
  if (!secreto) throw new Error('Falta WHATSAPP_TOKEN_ENCRYPTION_KEY en .env');
  const clave = createHash('sha256').update(secreto).digest();
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', clave, iv);
  const cifrado = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return [
    iv.toString('hex'),
    c.getAuthTag().toString('hex'),
    cifrado.toString('hex'),
  ].join(':');
}

main()
  .catch((e) => {
    console.error(`\n✗ ${e.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const p of procesos) p.kill();
    await prisma.$disconnect();
    await dormir(500);
    process.exit(process.exitCode ?? 0);
  });
