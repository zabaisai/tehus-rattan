import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { OutboxService } from '../src/common/outbox/outbox.service';
import { FlowBotRunnerService } from '../src/modules/flowbot/engine/flowbot.runner';
import { FlowBotQueueService } from '../src/modules/flowbot/engine/flowbot.queue';
import { EfectosFalsos } from '../src/modules/flowbot/engine/flowbot.fake-effects';
import { compilar } from '../src/modules/flowbot/graph/flowbot.compiler';
import {
  ConexionFlow,
  GrafoFlow,
  NodoFlow,
} from '../src/modules/flowbot/graph/flowbot.graph';

/**
 * Runner durable — contra la base REAL.
 *
 * Estas pruebas existen porque el riesgo no está en la lógica: el intérprete
 * ya está probado en memoria. El riesgo está en la persistencia y en las
 * carreras, y eso solo se responde con filas de verdad y constraints activos.
 *
 * Crea y limpia sus propios datos, todos con el prefijo E2E-RUNNER. La cola
 * va deshabilitada (`QUEUE_ENABLED=false`), así que nada se encola de verdad:
 * lo que se comprueba es lo que queda escrito en PostgreSQL.
 */
const prisma = new PrismaClient();
const PREFIJO = 'E2E-RUNNER';

const nodo = (
  id: string,
  type: NodoFlow['type'],
  config: Record<string, unknown> = {},
): NodoFlow => ({ id, type, position: { x: 0, y: 0 }, config });

const con = (from: string, fromPort: string, to: string): ConexionFlow => ({
  id: `${from}:${fromPort}->${to}`,
  from,
  fromPort,
  to,
});

const grafo = (nodes: NodoFlow[], edges: ConexionFlow[]): GrafoFlow => ({
  schemaVersion: 1,
  startNodeId: 'inicio',
  nodes,
  edges,
});

/** Saluda, pregunta y espera: cubre efecto externo y espera durable. */
const FLUJO = grafo(
  [
    nodo('inicio', 'trigger.inbound_message'),
    nodo('saluda', 'send.text', { text: 'Hola' }),
    nodo('pide', 'ask.question', { text: 'Tu nombre?', saveAs: 'nombre' }),
    nodo('gracias', 'send.text', { text: 'Gracias {{flow.nombre}}' }),
    nodo('fin', 'control.end'),
  ],
  [
    con('inicio', 'next', 'saluda'),
    con('saluda', 'next', 'pide'),
    con('pide', 'next', 'gracias'),
    con('gracias', 'next', 'fin'),
  ],
);

describe('runner durable de FlowBot (e2e, base real)', () => {
  let runner: FlowBotRunnerService;
  let empresaA: string;
  let empresaB: string;
  let botA: string;
  let versionA: string;
  let conversacionA: string;

  const compiladoDe = async (versionId: string) => {
    const v = await prisma.flowBotVersion.findUnique({
      where: { id: versionId },
      select: { compiled: true },
    });
    return v ? (v.compiled as never) : null;
  };

  beforeAll(async () => {
    // Sin cola: estas pruebas miden lo que queda en PostgreSQL.
    process.env.QUEUE_ENABLED = 'false';

    const servicioPrisma = prisma as unknown as PrismaService;
    runner = new FlowBotRunnerService(
      servicioPrisma,
      new OutboxService(servicioPrisma),
      new FlowBotQueueService(),
    );

    const a = await prisma.company.create({
      data: { name: `${PREFIJO}-A`, status: 'ACTIVE' },
    });
    const b = await prisma.company.create({
      data: { name: `${PREFIJO}-B`, status: 'ACTIVE' },
    });
    empresaA = a.id;
    empresaB = b.id;

    const contacto = await prisma.contact.create({
      data: {
        companyId: empresaA,
        name: `${PREFIJO}-contacto`,
        phone: '+573001110000',
      },
    });
    const conv = await prisma.conversation.create({
      data: { companyId: empresaA, contactId: contacto.id },
    });
    conversacionA = conv.id;

    const compilacion = compilar(FLUJO);
    expect(compilacion.ok).toBe(true);

    const bot = await prisma.flowBot.create({
      data: {
        companyId: empresaA,
        name: `${PREFIJO}-bot`,
        status: 'ACTIVE',
        draftGraph: FLUJO as never,
      },
    });
    botA = bot.id;

    const version = await prisma.flowBotVersion.create({
      data: {
        flowBotId: botA,
        version: 1,
        graph: FLUJO as never,
        compiled: compilacion.compilado as never,
        compiledHash: compilacion.hash!,
      },
    });
    versionA = version.id;
    await prisma.flowBot.update({
      where: { id: botA },
      data: { publishedVersionId: versionA, lastVersionNumber: 1 },
    });
  });

  afterAll(async () => {
    const empresas = [empresaA, empresaB];
    await prisma.flowBotWait.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.flowBotExecutionStep.deleteMany({
      where: { execution: { companyId: { in: empresas } } },
    });
    await prisma.flowBotExecution.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.flowBot.updateMany({
      where: { companyId: { in: empresas } },
      data: { publishedVersionId: null },
    });
    await prisma.flowBotVersion.deleteMany({
      where: { flowBot: { companyId: { in: empresas } } },
    });
    await prisma.flowBot.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.outboxEvent.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.conversation.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.contact.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.company.deleteMany({ where: { id: { in: empresas } } });
    await prisma.$disconnect();
  });

  const arrancar = (eventKey: string) =>
    runner.arrancar({
      companyId: empresaA,
      flowBotId: botA,
      versionId: versionA,
      eventKey,
      conversationId: conversacionA,
      correlationId: `corr-${eventKey}`,
    });

  describe('creación idempotente', () => {
    it('crea la ejecución y escribe el evento de outbox EN LA MISMA transacción', async () => {
      const r = await arrancar('wamid-1');

      expect(r.creada).toBe(true);
      const outbox = await prisma.outboxEvent.findFirst({
        where: { idempotencyKey: `flowbot.advance:${r.executionId}:0` },
      });
      // Si el proceso muere tras el commit y antes de encolar, el despachador
      // publica igual: por eso el trabajo no puede perderse.
      expect(outbox).not.toBeNull();
    });

    it('el mismo evento NO crea una segunda ejecución', async () => {
      const primera = await arrancar('wamid-repetido');
      const segunda = await arrancar('wamid-repetido');

      expect(segunda.creada).toBe(false);
      expect(segunda.executionId).toBe(primera.executionId);
    });

    it('DOS ARRANQUES SIMULTÁNEOS producen UNA sola ejecución', async () => {
      // La unicidad la da el constraint, no un "buscar y si no existe crear":
      // con dos workers, ambos leerian "no existe" antes de que ninguno
      // escribiera.
      const [uno, dos, tres] = await Promise.all([
        arrancar('wamid-carrera'),
        arrancar('wamid-carrera'),
        arrancar('wamid-carrera'),
      ]);

      const ids = new Set([uno.executionId, dos.executionId, tres.executionId]);
      expect(ids.size).toBe(1);
      expect(
        [uno.creada, dos.creada, tres.creada].filter(Boolean),
      ).toHaveLength(1);

      const cuantas = await prisma.flowBotExecution.count({
        where: {
          companyId: empresaA,
          triggerMessageId: null,
          idempotencyKey: { contains: 'wamid-carrera' },
        },
      });
      expect(cuantas).toBe(1);
    });

    it('la clave incluye la versión: republicar permite arrancar de nuevo', async () => {
      const otraVersion = await prisma.flowBotVersion.create({
        data: {
          flowBotId: botA,
          version: 2,
          graph: FLUJO as never,
          compiled: compilar(FLUJO).compilado as never,
          compiledHash: 'otro-hash',
        },
      });

      const v1 = await arrancar('wamid-version');
      const v2 = await runner.arrancar({
        companyId: empresaA,
        flowBotId: botA,
        versionId: otraVersion.id,
        eventKey: 'wamid-version',
        conversationId: conversacionA,
        correlationId: 'corr-v2',
      });

      expect(v2.creada).toBe(true);
      expect(v2.executionId).not.toBe(v1.executionId);
    });
  });

  describe('avance y persistencia', () => {
    it('persiste cada paso, las variables y deja la ejecución esperando', async () => {
      const { executionId } = await arrancar('wamid-avance');
      const efectos = new EfectosFalsos();

      const r = await runner.avanzarEjecucion(
        executionId,
        efectos,
        compiladoDe,
      );

      expect(r.estado).toBe('WAITING_INPUT');

      const pasos = await prisma.flowBotExecutionStep.findMany({
        where: { executionId },
        orderBy: { createdAt: 'asc' },
      });
      expect(pasos.map((p) => p.nodeId)).toEqual(['inicio', 'saluda', 'pide']);

      const ejecucion = await prisma.flowBotExecution.findUnique({
        where: { id: executionId },
      });
      expect(ejecucion!.status).toBe('WAITING_INPUT');
      expect(ejecucion!.currentNodeId).toBe('pide');
      expect(ejecucion!.steps).toBe(3);
      // El lease se libera al terminar, con éxito o con error.
      expect(ejecucion!.leaseOwner).toBeNull();
    });

    it('crea la espera durable EN PostgreSQL', async () => {
      const { executionId } = await arrancar('wamid-espera');
      await runner.avanzarEjecucion(
        executionId,
        new EfectosFalsos(),
        compiladoDe,
      );

      const espera = await prisma.flowBotWait.findFirst({
        where: { executionId, consumedAt: null },
      });
      // Una espera que solo viviera en Redis desapareceria al vaciarlo.
      expect(espera).not.toBeNull();
      expect(espera!.resumeNodeId).toBe('pide');
      expect(espera!.kind).toBe('INPUT');
    });

    it('reanuda por mensaje, guarda la respuesta y termina', async () => {
      const { executionId } = await arrancar('wamid-reanuda');
      const efectos = new EfectosFalsos();
      await runner.avanzarEjecucion(executionId, efectos, compiladoDe);

      const espera = await prisma.flowBotWait.findFirstOrThrow({
        where: { executionId, consumedAt: null },
      });

      const r = await runner.avanzarEjecucion(
        executionId,
        efectos,
        compiladoDe,
        {
          entrada: 'Ana',
          waitId: espera.id,
        },
      );

      expect(r.estado).toBe('COMPLETED');
      const ejecucion = await prisma.flowBotExecution.findUnique({
        where: { id: executionId },
      });
      expect(ejecucion!.status).toBe('COMPLETED');
      expect(ejecucion!.endedAt).not.toBeNull();
      expect(
        (ejecucion!.variables as Record<string, unknown>).flow,
      ).toMatchObject({
        nombre: 'Ana',
      });
      expect(efectos.ultimo('enviarTexto')?.texto).toBe('Gracias Ana');
    });

    it('DOS REANUDACIONES SIMULTÁNEAS consumen la espera una sola vez', async () => {
      // Dos mensajes casi a la vez no pueden hacer que el bot conteste dos
      // veces a la misma pregunta.
      const { executionId } = await arrancar('wamid-doble-reanuda');
      const efectos = new EfectosFalsos();
      await runner.avanzarEjecucion(executionId, efectos, compiladoDe);
      const espera = await prisma.flowBotWait.findFirstOrThrow({
        where: { executionId, consumedAt: null },
      });

      const enviosAntes = efectos.vecesDe('enviarTexto');
      const resultados = await Promise.all([
        runner.avanzarEjecucion(executionId, efectos, compiladoDe, {
          entrada: 'Ana',
          waitId: espera.id,
        }),
        runner.avanzarEjecucion(executionId, efectos, compiladoDe, {
          entrada: 'Ana otra vez',
          waitId: espera.id,
        }),
      ]);

      const omitidas = resultados.filter((r) => r.estado === 'omitido');
      expect(omitidas.length).toBeGreaterThanOrEqual(1);
      // Solo un "Gracias": el otro se retiró sin hacer nada.
      expect(efectos.vecesDe('enviarTexto')).toBe(enviosAntes + 1);
    });

    it('un trabajo repetido no duplica pasos', async () => {
      // La clave `ejecucion:nodo:paso` lo impide; sin ella el historial se
      // llenaria de pasos repetidos y las metricas contarian de mas.
      const { executionId } = await arrancar('wamid-repite-job');
      await runner.avanzarEjecucion(
        executionId,
        new EfectosFalsos(),
        compiladoDe,
      );
      const antes = await prisma.flowBotExecutionStep.count({
        where: { executionId },
      });

      // Segundo trabajo con la ejecución ya esperando: no avanza nada nuevo.
      await runner.avanzarEjecucion(
        executionId,
        new EfectosFalsos(),
        compiladoDe,
      );

      const despues = await prisma.flowBotExecutionStep.count({
        where: { executionId },
      });
      expect(despues).toBeGreaterThanOrEqual(antes);
      const claves = await prisma.flowBotExecutionStep.findMany({
        where: { executionId },
        select: { idempotencyKey: true },
      });
      expect(new Set(claves.map((c) => c.idempotencyKey)).size).toBe(
        claves.length,
      );
    });
  });

  describe('lease', () => {
    it('un trabajo NO avanza una ejecución que ya terminó', async () => {
      const { executionId } = await arrancar('wamid-terminada');
      await prisma.flowBotExecution.update({
        where: { id: executionId },
        data: { status: 'COMPLETED', endedAt: new Date() },
      });

      const r = await runner.avanzarEjecucion(
        executionId,
        new EfectosFalsos(),
        compiladoDe,
      );

      expect(r.estado).toBe('omitido');
    });

    it('un lease vivo de otro proceso impide avanzar', async () => {
      const { executionId } = await arrancar('wamid-lease-vivo');
      await prisma.flowBotExecution.update({
        where: { id: executionId },
        data: {
          leaseOwner: 'otro-worker',
          leaseUntil: new Date(Date.now() + 60_000),
        },
      });

      const r = await runner.avanzarEjecucion(
        executionId,
        new EfectosFalsos(),
        compiladoDe,
      );

      expect(r.estado).toBe('omitido');
    });

    it('un lease VENCIDO se puede tomar: el proceso anterior murió', async () => {
      // Sin vencimiento, una ejecucion quedaria bloqueada para siempre si el
      // worker que la tenia se cayo sin liberarla.
      const { executionId } = await arrancar('wamid-lease-vencido');
      await prisma.flowBotExecution.update({
        where: { id: executionId },
        data: {
          leaseOwner: 'worker-muerto',
          leaseUntil: new Date(Date.now() - 5 * 60_000),
        },
      });

      const r = await runner.avanzarEjecucion(
        executionId,
        new EfectosFalsos(),
        compiladoDe,
      );

      expect(r.estado).toBe('WAITING_INPUT');
    });
  });

  describe('pausa, reanudación y cancelación', () => {
    it('pausar impide que un trabajo posterior avance', async () => {
      const { executionId } = await arrancar('wamid-pausa');
      await runner.avanzarEjecucion(
        executionId,
        new EfectosFalsos(),
        compiladoDe,
      );

      expect(await runner.pausar(executionId, empresaA)).toBe(true);

      const r = await runner.avanzarEjecucion(
        executionId,
        new EfectosFalsos(),
        compiladoDe,
      );
      expect(r.estado).toBe('omitido');
    });

    it('cancelar CONSUME las esperas pendientes', async () => {
      // Dejarlas vivas haria que un vencimiento intentara despertar algo que
      // ya no debe seguir.
      const { executionId } = await arrancar('wamid-cancela');
      await runner.avanzarEjecucion(
        executionId,
        new EfectosFalsos(),
        compiladoDe,
      );

      expect(await runner.cancelar(executionId, empresaA, 'prueba')).toBe(true);

      const vivas = await prisma.flowBotWait.count({
        where: { executionId, consumedAt: null },
      });
      expect(vivas).toBe(0);
      const ejecucion = await prisma.flowBotExecution.findUnique({
        where: { id: executionId },
      });
      expect(ejecucion!.status).toBe('CANCELLED');
      expect(ejecucion!.endedReason).toBe('prueba');
    });

    it('un trabajo antiguo NO revive una ejecución cancelada', async () => {
      const { executionId } = await arrancar('wamid-no-revive');
      await runner.avanzarEjecucion(
        executionId,
        new EfectosFalsos(),
        compiladoDe,
      );
      await runner.cancelar(executionId, empresaA, 'prueba');

      const r = await runner.avanzarEjecucion(
        executionId,
        new EfectosFalsos(),
        compiladoDe,
      );

      expect(r.estado).toBe('omitido');
    });
  });

  describe('aislamiento multiempresa', () => {
    it('otra empresa NO puede pausar ni cancelar una ejecución ajena', async () => {
      const { executionId } = await arrancar('wamid-aislamiento');

      expect(await runner.pausar(executionId, empresaB)).toBe(false);
      expect(await runner.cancelar(executionId, empresaB, 'intento')).toBe(
        false,
      );

      const ejecucion = await prisma.flowBotExecution.findUnique({
        where: { id: executionId },
      });
      expect(ejecucion!.status).not.toBe('CANCELLED');
      expect(ejecucion!.status).not.toBe('PAUSED');
    });

    it('una espera de otra empresa no se consume', async () => {
      const { executionId } = await arrancar('wamid-espera-ajena');
      await runner.avanzarEjecucion(
        executionId,
        new EfectosFalsos(),
        compiladoDe,
      );
      const espera = await prisma.flowBotWait.findFirstOrThrow({
        where: { executionId, consumedAt: null },
      });

      // El runner filtra la espera por companyId de la ejecución; forzar una
      // ajena no debe consumirla.
      await prisma.flowBotWait.update({
        where: { id: espera.id },
        data: { companyId: empresaB },
      });

      const r = await runner.avanzarEjecucion(
        executionId,
        new EfectosFalsos(),
        compiladoDe,
        {
          entrada: 'x',
          waitId: espera.id,
        },
      );

      expect(r.estado).toBe('omitido');
    });
  });

  describe('trazabilidad sin secretos', () => {
    it('los pasos guardados no contienen tokens ni credenciales', async () => {
      const { executionId } = await arrancar('wamid-sin-secretos');
      await runner.avanzarEjecucion(
        executionId,
        new EfectosFalsos(),
        compiladoDe,
      );

      const pasos = await prisma.flowBotExecutionStep.findMany({
        where: { executionId },
      });
      const volcado = JSON.stringify(pasos);
      expect(volcado).not.toMatch(/authorization/i);
      expect(volcado).not.toMatch(/bearer/i);
      expect(volcado).not.toMatch(/sk-[A-Za-z0-9]{10}/);
    });
  });
});
