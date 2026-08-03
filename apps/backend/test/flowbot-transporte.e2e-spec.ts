import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { OutboxService } from '../src/common/outbox/outbox.service';
import { OutboxDispatcher } from '../src/common/outbox/outbox.dispatcher';
import { OutboxHandlerRegistry } from '../src/common/outbox/outbox.handlers';
import { FlowBotRunnerService } from '../src/modules/flowbot/engine/flowbot.runner';
import {
  FlowBotJob,
  FlowBotQueueService,
} from '../src/modules/flowbot/engine/flowbot.queue';
import { FlowBotOutboxPublisher } from '../src/modules/flowbot/engine/flowbot.outbox';
import { FlowBotIntakeService } from '../src/modules/flowbot/engine/flowbot.intake';
import { FlowBotSelectorService } from '../src/modules/flowbot/engine/flowbot.selector';
import { FlowBotReconcilerService } from '../src/modules/flowbot/engine/flowbot.reconciler';
import { MAX_INTENTOS } from '../src/modules/flowbot/engine/flowbot.interpreter';
import { EfectosFalsos } from '../src/modules/flowbot/engine/flowbot.fake-effects';
import { compilar } from '../src/modules/flowbot/graph/flowbot.compiler';
import {
  ConexionFlow,
  GrafoFlow,
  NodoFlow,
} from '../src/modules/flowbot/graph/flowbot.graph';

/**
 * TRANSPORTE Y RECUPERACIÓN DURABLE — contra la base REAL.
 *
 * Lo que se comprueba aquí no se puede comprobar en memoria. Los mocks
 * siempre dicen que sí: no tienen constraints únicos, no abortan la
 * transacción al primer fallo, y no tienen `FOR UPDATE SKIP LOCKED`. Todas
 * las garantías que hacen que este motor no pierda ni duplique trabajo
 * dependen justo de eso.
 *
 * LA COLA ES UN DOBLE, NO REDIS. Estas pruebas responden «¿queda escrito lo
 * correcto en PostgreSQL y en el orden correcto?». Meter Redis añadiría un
 * servicio más que puede fallar por su cuenta sin responder mejor esa
 * pregunta. El doble sí replica lo que importa de BullMQ: DESCARTA un
 * `jobId` repetido en silencio, que es la propiedad de la que depende toda
 * la deduplicación.
 *
 * Datos propios con prefijo E2E-TRANSPORTE, limpiados al final.
 */
const prisma = new PrismaClient();
const PREFIJO = 'E2E-TRANSPORTE';

// ── doble de la cola ────────────────────────────────────────────

interface TrabajoEncolado {
  jobId: string;
  job: FlowBotJob;
  delayMs?: number;
}

/**
 * Se comporta como BullMQ en lo único que importa aquí: un `add` con un
 * `jobId` que ya existe se descarta SIN lanzar y devuelve éxito.
 */
class ColaDoble {
  trabajos: TrabajoEncolado[] = [];
  descartadosPorDuplicado = 0;
  caida = false;

  private añadir(jobId: string, job: FlowBotJob, delayMs?: number): boolean {
    if (this.caida) return false;
    if (this.trabajos.some((t) => t.jobId === jobId)) {
      this.descartadosPorDuplicado += 1;
      return true; // éxito idempotente, igual que BullMQ
    }
    this.trabajos.push({ jobId, job, delayMs });
    return true;
  }

  async encolarAvance(
    job: FlowBotJob,
    paso: number,
    opciones: { delayMs?: number } = {},
  ): Promise<boolean> {
    return this.añadir(
      FlowBotQueueService.jobIdAvance(job.executionId, paso, job.intento ?? 1),
      job,
      opciones.delayMs,
    );
  }

  async encolarMensaje(job: FlowBotJob): Promise<boolean> {
    if (!job.messageId) return false;
    return this.añadir(
      FlowBotQueueService.jobIdMensaje(job.executionId, job.messageId),
      job,
    );
  }

  async encolarDespertar(job: FlowBotJob, wakeAt: Date): Promise<boolean> {
    if (!job.waitId) return false;
    return this.añadir(
      FlowBotQueueService.jobIdDespertar(job.waitId),
      job,
      Math.max(0, wakeAt.getTime() - Date.now()),
    );
  }

  async cancelarDespertar(waitId: string): Promise<void> {
    const jobId = FlowBotQueueService.jobIdDespertar(waitId);
    this.trabajos = this.trabajos.filter((t) => t.jobId !== jobId);
  }

  isEnabled(): boolean {
    return !this.caida;
  }

  limpiar(): void {
    this.trabajos = [];
    this.descartadosPorDuplicado = 0;
    this.caida = false;
  }

  de(tipo: FlowBotJob['tipo']): TrabajoEncolado[] {
    return this.trabajos.filter((t) => t.job.tipo === tipo);
  }
}

// ── grafo de prueba ─────────────────────────────────────────────

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

/** Pregunta con vencimiento: cubre reanudación por mensaje y por tiempo. */
const FLUJO: GrafoFlow = {
  schemaVersion: 1,
  startNodeId: 'inicio',
  nodes: [
    nodo('inicio', 'trigger.inbound_message'),
    nodo('pide', 'ask.question', {
      text: 'Tu nombre?',
      saveAs: 'nombre',
      timeoutSeconds: 60,
    }),
    nodo('gracias', 'send.text', { text: 'Gracias {{flow.nombre}}' }),
    nodo('nadie', 'send.text', { text: 'Sigo aqui cuando quieras' }),
    nodo('fin', 'control.end'),
  ],
  edges: [
    con('inicio', 'next', 'pide'),
    con('pide', 'next', 'gracias'),
    con('pide', 'timeout', 'nadie'),
    con('gracias', 'next', 'fin'),
    con('nadie', 'next', 'fin'),
  ],
};

describe('transporte y recuperación durable de FlowBot (e2e, base real)', () => {
  const servicioPrisma = prisma as unknown as PrismaService;
  const cola = new ColaDoble();
  const colaComoServicio = cola as unknown as FlowBotQueueService;

  let outbox: OutboxService;
  let registro: OutboxHandlerRegistry;
  let publisher: FlowBotOutboxPublisher;
  let dispatcher: OutboxDispatcher;
  let runner: FlowBotRunnerService;
  let intake: FlowBotIntakeService;
  let reconciler: FlowBotReconcilerService;

  let empresa: string;
  let contacto: string;
  let conversacion: string;
  let bot: string;
  let version: string;
  let n = 0;

  const compiladoDe = async (versionId: string) => {
    const v = await prisma.flowBotVersion.findUnique({
      where: { id: versionId },
      select: { compiled: true },
    });
    return v ? (v.compiled as never) : null;
  };

  /** Cola de entrantes inerte: aquí solo se despachan eventos de FlowBot. */
  const colaEntrantes = {
    enqueueInboundMessage: async () => true,
  } as never;

  beforeAll(async () => {
    // Habilitada para que el despachador y el reconciliador pasen; quien
    // "encola" es el doble.
    process.env.QUEUE_ENABLED = 'true';

    outbox = new OutboxService(servicioPrisma);
    registro = new OutboxHandlerRegistry();
    publisher = new FlowBotOutboxPublisher(
      registro,
      servicioPrisma,
      colaComoServicio,
    );
    publisher.onModuleInit();
    dispatcher = new OutboxDispatcher(outbox, colaEntrantes, registro);
    runner = new FlowBotRunnerService(servicioPrisma, outbox, colaComoServicio);
    intake = new FlowBotIntakeService(
      servicioPrisma,
      outbox,
      colaComoServicio,
      new FlowBotSelectorService(servicioPrisma),
      runner,
    );
    reconciler = new FlowBotReconcilerService(
      servicioPrisma,
      colaComoServicio,
      outbox,
    );

    const e = await prisma.company.create({
      data: { name: `${PREFIJO}-empresa`, status: 'ACTIVE' },
    });
    empresa = e.id;

    const c = await prisma.contact.create({
      data: {
        companyId: empresa,
        name: `${PREFIJO}-c`,
        phone: '+573009990000',
      },
    });
    contacto = c.id;

    const conv = await prisma.conversation.create({
      data: { companyId: empresa, contactId: contacto },
    });
    conversacion = conv.id;

    const compilacion = compilar(FLUJO);
    expect(compilacion.ok).toBe(true);

    const b = await prisma.flowBot.create({
      data: {
        companyId: empresa,
        name: `${PREFIJO}-bot`,
        status: 'ACTIVE',
        draftGraph: FLUJO as never,
      },
    });
    bot = b.id;

    const v = await prisma.flowBotVersion.create({
      data: {
        flowBotId: bot,
        version: 1,
        graph: FLUJO as never,
        compiled: compilacion.compilado as never,
        compiledHash: compilacion.hash!,
      },
    });
    version = v.id;
    await prisma.flowBot.update({
      where: { id: bot },
      data: { publishedVersionId: version, lastVersionNumber: 1 },
    });
  });

  afterAll(async () => {
    await prisma.flowBotWait.deleteMany({ where: { companyId: empresa } });
    await prisma.flowBotExecutionStep.deleteMany({
      where: { execution: { companyId: empresa } },
    });
    await prisma.flowBotExecution.deleteMany({ where: { companyId: empresa } });
    await prisma.flowBot.updateMany({
      where: { companyId: empresa },
      data: { publishedVersionId: null },
    });
    await prisma.flowBotVersion.deleteMany({
      where: { flowBot: { companyId: empresa } },
    });
    await prisma.flowBot.deleteMany({ where: { companyId: empresa } });
    await prisma.outboxEvent.deleteMany({ where: { companyId: empresa } });
    await prisma.message.deleteMany({
      where: { conversation: { companyId: empresa } },
    });
    await prisma.conversation.deleteMany({ where: { companyId: empresa } });
    await prisma.contact.deleteMany({ where: { companyId: empresa } });
    await prisma.company.deleteMany({ where: { id: empresa } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    cola.limpiar();
    // Cada prueba empieza con el outbox vacío: si no, un evento pendiente de
    // la anterior se colaría en su lote y el conteo dejaría de significar
    // nada.
    await prisma.outboxEvent.deleteMany({ where: { companyId: empresa } });
    await prisma.flowBot.update({
      where: { id: bot },
      data: { status: 'ACTIVE' },
    });
  });

  /**
   * Efectos falsos con el reloj EN HORA.
   *
   * `RelojFalso` arranca fijado en enero de 2026 a propósito, para que las
   * pruebas en memoria sean deterministas. Aquí no sirve: los vencimientos que
   * calcula el motor se comparan contra `now()` de PostgreSQL y contra
   * `Date.now()` del despachador, así que un reloj congelado en el pasado hace
   * que toda espera nazca ya vencida.
   */
  const efectos = () => {
    const e = new EfectosFalsos({ dentroDeVentana: true });
    e.reloj.fijar(new Date());
    return e as never;
  };

  /** Arranca una ejecución nueva, ya avanzada hasta la pregunta. */
  const arrancarYAvanzar = async () => {
    n += 1;
    const { executionId } = await runner.arrancar({
      companyId: empresa,
      flowBotId: bot,
      versionId: version,
      eventKey: `${PREFIJO}-${n}-${Date.now()}`,
      conversationId: conversacion,
      contactId: contacto,
      correlationId: `corr-${n}`,
    });
    await runner.avanzarEjecucion(executionId, efectos(), compiladoDe);
    return executionId;
  };

  const crearMensaje = async (texto: string) => {
    const m = await prisma.message.create({
      data: {
        conversationId: conversacion,
        body: texto,
        direction: 'INBOUND',
        type: 'TEXT',
      },
    });
    return m.id;
  };

  const esperaDe = (executionId: string) =>
    prisma.flowBotWait.findFirst({
      where: { executionId, consumedAt: null },
    });

  const eventosDe = (executionId: string) =>
    prisma.outboxEvent.findMany({
      where: {
        companyId: empresa,
        payload: { path: ['executionId'], equals: executionId },
      },
    });

  // ── 1. Despacho de eventos hacia la cola ──────────────────────

  describe('despacho del outbox hacia la cola', () => {
    it('1. publica flowbot.advance y solo entonces marca el evento completado', async () => {
      n += 1;
      const { executionId } = await runner.arrancar({
        companyId: empresa,
        flowBotId: bot,
        versionId: version,
        eventKey: `${PREFIJO}-d1-${Date.now()}`,
        conversationId: conversacion,
        correlationId: 'corr-d1',
      });
      cola.limpiar();

      await dispatcher.despachar();

      expect(cola.de('avanzar')).toHaveLength(1);
      const evento = await prisma.outboxEvent.findFirst({
        where: { idempotencyKey: `flowbot.advance:${executionId}:0` },
      });
      expect(evento?.status).toBe('COMPLETED');
      expect(evento?.processedAt).not.toBeNull();
    });

    it('2. si la cola no acepta, el evento vuelve a PENDING con backoff y NO se pierde', async () => {
      n += 1;
      const { executionId } = await runner.arrancar({
        companyId: empresa,
        flowBotId: bot,
        versionId: version,
        eventKey: `${PREFIJO}-d2-${Date.now()}`,
        conversationId: conversacion,
        correlationId: 'corr-d2',
      });
      cola.limpiar();
      cola.caida = true;

      await dispatcher.despachar();

      const evento = await prisma.outboxEvent.findFirst({
        where: { idempotencyKey: `flowbot.advance:${executionId}:0` },
      });
      // Marcar antes de publicar habría perdido este avance para siempre.
      expect(evento?.status).toBe('PENDING');
      expect(evento?.attempts).toBe(1);
      expect(evento!.availableAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('3. el evento reprogramado se publica cuando la cola vuelve', async () => {
      n += 1;
      await runner.arrancar({
        companyId: empresa,
        flowBotId: bot,
        versionId: version,
        eventKey: `${PREFIJO}-d3-${Date.now()}`,
        conversationId: conversacion,
        correlationId: 'corr-d3',
      });
      cola.limpiar();
      cola.caida = true;
      await dispatcher.despachar();

      // El backoff vive en `availableAt`, así que sobrevive a un reinicio.
      // Se adelanta para no esperar cinco segundos reales.
      await prisma.outboxEvent.updateMany({
        where: { companyId: empresa, status: 'PENDING' },
        data: { availableAt: new Date(Date.now() - 1000) },
      });
      cola.caida = false;

      await dispatcher.despachar();

      expect(cola.de('avanzar').length).toBeGreaterThan(0);
      const pendientes = await prisma.outboxEvent.count({
        where: { companyId: empresa, status: 'PENDING' },
      });
      expect(pendientes).toBe(0);
    });

    it('4. dos despachadores concurrentes NO publican el mismo evento dos veces', async () => {
      // Es lo que garantiza `FOR UPDATE SKIP LOCKED`, y no se puede comprobar
      // con un mock: sin base real, ambos leerían el mismo lote.
      for (let i = 0; i < 5; i += 1) {
        await runner.arrancar({
          companyId: empresa,
          flowBotId: bot,
          versionId: version,
          eventKey: `${PREFIJO}-d4-${i}-${Date.now()}`,
          conversationId: conversacion,
          correlationId: `corr-d4-${i}`,
        });
      }
      cola.limpiar();

      const segundo = new OutboxDispatcher(outbox, colaEntrantes, registro);
      await Promise.all([dispatcher.despachar(), segundo.despachar()]);

      const completados = await prisma.outboxEvent.count({
        where: { companyId: empresa, status: 'COMPLETED' },
      });
      expect(completados).toBe(5);
      // Ningún trabajo duplicado: cada ejecución tiene el suyo y ninguno se
      // descartó por repetido, que sería la señal de que ambos publicaron.
      expect(cola.de('avanzar')).toHaveLength(5);
      expect(cola.descartadosPorDuplicado).toBe(0);
    });

    it('5. el payload persistido lleva SOLO identificadores', async () => {
      n += 1;
      await runner.arrancar({
        companyId: empresa,
        flowBotId: bot,
        versionId: version,
        eventKey: `${PREFIJO}-d5-${Date.now()}`,
        conversationId: conversacion,
        correlationId: 'corr-d5',
      });

      const evento = await prisma.outboxEvent.findFirst({
        where: { companyId: empresa, type: 'flowbot.advance' },
      });
      expect(Object.keys(evento!.payload as object).sort()).toEqual([
        'companyId',
        'correlationId',
        'executionId',
        'paso',
      ]);
    });

    it('6. un evento de una ejecución cancelada se da por despachado sin encolar', async () => {
      const executionId = await arrancarYAvanzar();
      await runner.cancelar(executionId, empresa, 'prueba');
      // El evento del avance siguiente ya está escrito; se rescata a PENDING.
      await prisma.outboxEvent.updateMany({
        where: { companyId: empresa },
        data: { status: 'PENDING', availableAt: new Date(Date.now() - 1000) },
      });
      cola.limpiar();

      await dispatcher.despachar();

      // Ni un trabajo para algo que ya no debe avanzar, ni un evento girando
      // hasta quedar FAILED por haber funcionado bien.
      expect(cola.trabajos).toHaveLength(0);
      const fallidos = await prisma.outboxEvent.count({
        where: { companyId: empresa, status: { in: ['PENDING', 'FAILED'] } },
      });
      expect(fallidos).toBe(0);
    });
  });

  // ── 2. Reanudación por mensaje ────────────────────────────────

  describe('reanudación por mensaje', () => {
    it('7. el mensaje del cliente escribe el evento de reanudación', async () => {
      const executionId = await arrancarYAvanzar();
      const messageId = await crearMensaje('Ana');
      cola.limpiar();

      const r = await intake.atenderMensaje({
        companyId: empresa,
        conversationId: conversacion,
        messageId,
        texto: 'Ana',
      });

      expect(r).toEqual({
        atendido: true,
        motivo: 'reanudada',
        executionId,
      });
      const evento = await prisma.outboxEvent.findFirst({
        where: {
          idempotencyKey: `flowbot.advance:${executionId}:msg:${messageId}`,
        },
      });
      expect(evento).not.toBeNull();
    });

    it('8. el mismo mensaje entregado dos veces NO crea dos eventos', async () => {
      const executionId = await arrancarYAvanzar();
      const messageId = await crearMensaje('Ana');

      await intake.atenderMensaje({
        companyId: empresa,
        conversationId: conversacion,
        messageId,
        texto: 'Ana',
      });
      await intake.atenderMensaje({
        companyId: empresa,
        conversationId: conversacion,
        messageId,
        texto: 'Ana',
      });

      // Lo garantiza el índice único de `idempotencyKey`, no un "buscar y si
      // no existe crear": con dos entregas simultáneas ambos leerían "no
      // existe" antes de que ninguno escribiera.
      const eventos = await prisma.outboxEvent.count({
        where: {
          idempotencyKey: `flowbot.advance:${executionId}:msg:${messageId}`,
        },
      });
      expect(eventos).toBe(1);
    });

    it('9. dos mensajes distintos SÍ crean dos eventos y dos trabajos', async () => {
      const executionId = await arrancarYAvanzar();
      const uno = await crearMensaje('Ana');
      const dos = await crearMensaje('digo Ana Maria');
      cola.limpiar();

      await intake.atenderMensaje({
        companyId: empresa,
        conversationId: conversacion,
        messageId: uno,
        texto: 'Ana',
      });
      await intake.atenderMensaje({
        companyId: empresa,
        conversationId: conversacion,
        messageId: dos,
        texto: 'digo Ana Maria',
      });

      // Si el `jobId` llevara el paso en vez del mensaje, el segundo se
      // descartaría como duplicado del primero.
      expect(cola.de('avanzar')).toHaveLength(2);
      expect(cola.descartadosPorDuplicado).toBe(0);
      // Uno por mensaje, además del evento de arranque de la ejecución.
      const eventos = await eventosDe(executionId);
      expect(
        eventos.filter((e) => e.idempotencyKey.includes(':msg:')),
      ).toHaveLength(2);
    });

    it('10. la espera NO se consume al registrar el evento', async () => {
      const executionId = await arrancarYAvanzar();
      const messageId = await crearMensaje('Ana');

      await intake.atenderMensaje({
        companyId: empresa,
        conversationId: conversacion,
        messageId,
        texto: 'Ana',
      });

      // Consumirla aquí y morir antes de escribir el evento dejaría la
      // ejecución despierta sin nada que la despertara.
      expect(await esperaDe(executionId)).not.toBeNull();
    });

    it('11. el runner consume la espera y avanza con el texto releído de la base', async () => {
      const executionId = await arrancarYAvanzar();
      const messageId = await crearMensaje('Ana');
      const espera = await esperaDe(executionId);

      // El mismo camino que sigue el consumidor: del trabajo solo sale el id,
      // y el cuerpo se relee ACOTADO POR EMPRESA. Un `messageId` de otra
      // empresa no encontraría nada aquí.
      const mensaje = await prisma.message.findFirst({
        where: { id: messageId, conversation: { companyId: empresa } },
        select: { body: true },
      });
      expect(mensaje?.body).toBe('Ana');

      await runner.avanzarEjecucion(executionId, efectos(), compiladoDe, {
        waitId: espera!.id,
        entrada: mensaje!.body!,
      });

      const ejecucion = await prisma.flowBotExecution.findUnique({
        where: { id: executionId },
      });
      expect(ejecucion?.status).toBe('COMPLETED');
      // La respuesta quedó guardada bajo `flow`, que es el espacio de nombres
      // que usan las plantillas: `{{flow.nombre}}`.
      const variables = ejecucion?.variables as { flow?: { nombre?: string } };
      expect(variables.flow?.nombre).toBe('Ana');
      const consumida = await prisma.flowBotWait.findUnique({
        where: { id: espera!.id },
      });
      expect(consumida?.consumedAt).not.toBeNull();
    });

    it('12. dos reanudaciones simultáneas: solo UNA consume la espera', async () => {
      const executionId = await arrancarYAvanzar();
      const espera = await esperaDe(executionId);

      const avanzar = () =>
        runner.avanzarEjecucion(executionId, efectos(), compiladoDe, {
          waitId: espera!.id,
          entrada: 'Ana',
        });

      const [a, b] = await Promise.all([avanzar(), avanzar()]);

      // El `updateMany` filtrando por `consumedAt: null` es atómico. Sin él,
      // el cliente recibiría dos respuestas a la misma pregunta.
      const omitidos = [a, b].filter((r) => r.estado === 'omitido');
      expect(omitidos).toHaveLength(1);
    });

    it('13. una conversación pausada no reanuda nada', async () => {
      const executionId = await arrancarYAvanzar();
      const messageId = await crearMensaje('Ana');
      await prisma.conversation.update({
        where: { id: conversacion },
        data: { isPaused: true },
      });

      const r = await intake.atenderMensaje({
        companyId: empresa,
        conversationId: conversacion,
        messageId,
        texto: 'Ana',
      });

      await prisma.conversation.update({
        where: { id: conversacion },
        data: { isPaused: false },
      });

      expect(r.motivo).toBe('conversacion-pausada');
      expect(await esperaDe(executionId)).not.toBeNull();
    });
  });

  // ── 3. Reanudación por tiempo ─────────────────────────────────

  describe('reanudación por tiempo', () => {
    it('14. la espera con vencimiento escribe su evento de despertar', async () => {
      const executionId = await arrancarYAvanzar();
      const espera = await esperaDe(executionId);

      const evento = await prisma.outboxEvent.findFirst({
        where: { idempotencyKey: `flowbot.wake:${espera!.id}` },
      });
      // La espera ya está en PostgreSQL; el evento garantiza que su trabajo
      // llegue a la cola aunque el proceso muera ahora mismo.
      expect(evento).not.toBeNull();
      expect(evento?.type).toBe('flowbot.wake');
    });

    it('15. el despachador lo publica con el retraso hasta wakeAt', async () => {
      const executionId = await arrancarYAvanzar();
      const espera = await esperaDe(executionId);
      cola.limpiar();

      await dispatcher.despachar();

      const despertar = cola
        .de('despertar')
        .find((t) => t.job.waitId === espera!.id);
      expect(despertar).toBeDefined();
      expect(despertar!.delayMs).toBeGreaterThan(0);
    });

    it('16. al vencer, la ejecución sale por el puerto de tiempo agotado', async () => {
      const executionId = await arrancarYAvanzar();
      const espera = await esperaDe(executionId);
      // Se adelanta el vencimiento en vez de esperar un minuto real.
      await prisma.flowBotWait.update({
        where: { id: espera!.id },
        data: { wakeAt: new Date(Date.now() - 1000) },
      });

      await runner.avanzarEjecucion(executionId, efectos(), compiladoDe, {
        waitId: espera!.id,
      });

      const pasos = await prisma.flowBotExecutionStep.findMany({
        where: { executionId },
        orderBy: { createdAt: 'asc' },
      });
      // Salió por 'nadie', no por 'gracias': despertar NO debe reejecutar el
      // nodo que esperaba, eso reenviaría la pregunta al cliente.
      expect(pasos.some((p) => p.nodeId === 'nadie')).toBe(true);
      expect(pasos.some((p) => p.nodeId === 'gracias')).toBe(false);
    });

    it('17. un despertar de una espera YA consumida es un no-op', async () => {
      const executionId = await arrancarYAvanzar();
      const espera = await esperaDe(executionId);
      await runner.avanzarEjecucion(executionId, efectos(), compiladoDe, {
        waitId: espera!.id,
        entrada: 'Ana',
      });

      // El trabajo de vencimiento llega tarde, cuando el cliente ya contestó.
      const tardio = await runner.avanzarEjecucion(
        executionId,
        efectos(),
        compiladoDe,
        { waitId: espera!.id },
      );

      expect(tardio.estado).toBe('omitido');
    });

    it('18. el publicador NO encola un despertar de una espera consumida', async () => {
      const executionId = await arrancarYAvanzar();
      const espera = await esperaDe(executionId);
      await prisma.flowBotWait.update({
        where: { id: espera!.id },
        data: { consumedAt: new Date() },
      });
      await prisma.outboxEvent.updateMany({
        where: { companyId: empresa },
        data: { status: 'PENDING', availableAt: new Date(Date.now() - 1000) },
      });
      cola.limpiar();

      await dispatcher.despachar();

      expect(cola.de('despertar')).toHaveLength(0);
      const pendientes = await prisma.outboxEvent.count({
        where: { companyId: empresa, status: { in: ['PENDING', 'FAILED'] } },
      });
      expect(pendientes).toBe(0);
      expect(executionId).toBeDefined();
    });
  });

  // ── 4. Reconciliador ──────────────────────────────────────────

  describe('reconciliador', () => {
    it('19. reencola la espera vencida cuyo despertar se perdió', async () => {
      const executionId = await arrancarYAvanzar();
      const espera = await esperaDe(executionId);
      await prisma.flowBotWait.update({
        where: { id: espera!.id },
        data: { wakeAt: new Date(Date.now() - 10 * 60_000) },
      });
      cola.limpiar();

      const informe = await reconciler.reconciliar();

      expect(informe.reparado['esperas-vencidas']).toBeGreaterThanOrEqual(1);
      expect(
        cola.de('despertar').some((t) => t.job.waitId === espera!.id),
      ).toBe(true);
    });

    it('20. es idempotente: el segundo pase no duplica trabajo', async () => {
      const executionId = await arrancarYAvanzar();
      const espera = await esperaDe(executionId);
      await prisma.flowBotWait.update({
        where: { id: espera!.id },
        data: { wakeAt: new Date(Date.now() - 10 * 60_000) },
      });
      cola.limpiar();

      await reconciler.reconciliar();
      const trasPrimero = cola.trabajos.length;
      await reconciler.reconciliar();

      // El `jobId` determinista es lo que lo hace idempotente: el segundo
      // `add` se descarta. Sin esto, pasar cada minuto llenaría la cola.
      expect(cola.trabajos).toHaveLength(trasPrimero);
      expect(cola.descartadosPorDuplicado).toBeGreaterThan(0);
    });

    it('21. dos instancias simultáneas no duplican reparaciones', async () => {
      const executionId = await arrancarYAvanzar();
      const espera = await esperaDe(executionId);
      await prisma.flowBotWait.update({
        where: { id: espera!.id },
        data: { wakeAt: new Date(Date.now() - 10 * 60_000) },
      });
      cola.limpiar();

      const otro = new FlowBotReconcilerService(
        servicioPrisma,
        colaComoServicio,
        outbox,
      );
      await Promise.all([reconciler.reconciliar(), otro.reconciliar()]);

      expect(
        cola.de('despertar').filter((t) => t.job.waitId === espera!.id),
      ).toHaveLength(1);
    });

    it('22. consume las esperas huérfanas de ejecuciones ya terminadas', async () => {
      const executionId = await arrancarYAvanzar();
      const espera = await esperaDe(executionId);
      // Se termina la ejecución dejando su espera abierta, como si el proceso
      // hubiera muerto entre las dos escrituras.
      await prisma.flowBotExecution.update({
        where: { id: executionId },
        data: { status: 'COMPLETED', endedAt: new Date() },
      });

      await reconciler.reconciliar();

      const tras = await prisma.flowBotWait.findUnique({
        where: { id: espera!.id },
      });
      expect(tras?.consumedAt).not.toBeNull();
    });

    it('23. cancela las ejecuciones de un bot archivado', async () => {
      const executionId = await arrancarYAvanzar();
      await prisma.flowBot.update({
        where: { id: bot },
        data: { status: 'ARCHIVED' },
      });

      await reconciler.reconciliar();

      const tras = await prisma.flowBotExecution.findUnique({
        where: { id: executionId },
      });
      // Seguir ejecutándolo sería contestarle a un cliente con un flujo que su
      // dueño retiró a propósito.
      expect(tras?.status).toBe('CANCELLED');
      expect(tras?.endedReason).toBe('bot-archivado');
    });

    it('24. cierra las ejecuciones abandonadas con su propio motivo', async () => {
      const executionId = await arrancarYAvanzar();
      await prisma.flowBotExecution.update({
        where: { id: executionId },
        data: { startedAt: new Date(Date.now() - 48 * 60 * 60_000) },
      });

      await reconciler.reconciliar();

      const tras = await prisma.flowBotExecution.findUnique({
        where: { id: executionId },
      });
      expect(tras?.status).toBe('CANCELLED');
      // Motivo propio para no confundirla con una cancelación humana.
      expect(tras?.endedReason).toBe('abandonada-por-inactividad');
    });

    it('25. cuenta el outbox atrasado y degrada, sin publicarlo él mismo', async () => {
      await arrancarYAvanzar();
      await prisma.outboxEvent.updateMany({
        where: { companyId: empresa },
        data: {
          status: 'FAILED',
          availableAt: new Date(Date.now() - 60 * 60_000),
        },
      });
      cola.limpiar();

      const informe = await reconciler.reconciliar();

      expect(informe.detectado['outbox-fallido']).toBeGreaterThanOrEqual(1);
      expect(informe.degradado).toBe(true);
      // Publicar desde aquí duplicaría el camino del despachador.
      expect(informe.reparado['outbox-fallido']).toBeUndefined();
    });
  });

  // ── 4b. Reintentos ────────────────────────────────

  describe('reintentos durables', () => {
    /**
     * Un envío cuyo puerto de error NO está conectado: cuando el efecto
     * revienta, el intérprete lo clasifica como interno —y por tanto
     * reintentable— en vez de desviarlo por una rama.
     */
    const FLUJO_FALLA: GrafoFlow = {
      schemaVersion: 1,
      startNodeId: 'inicio',
      nodes: [
        nodo('inicio', 'trigger.inbound_message'),
        nodo('rompe', 'send.text', { text: 'esto va a reventar' }),
        nodo('fin', 'control.end'),
      ],
      edges: [con('inicio', 'next', 'rompe'), con('rompe', 'next', 'fin')],
    };

    /**
     * Efectos con la mensajería rota. No sale nada a ningún sitio: revienta
     * antes de llegar al adaptador falso, que es lo que simula un corte de red
     * o un tiempo agotado hablando con el proveedor.
     */
    const efectosRotos = () => {
      const e = new EfectosFalsos({ dentroDeVentana: true });
      e.reloj.fijar(new Date());
      return {
        crm: e.crm,
        http: e.http,
        ia: e.ia,
        reloj: e.reloj,
        auditoria: e.auditoria,
        mensajeria: {
          ...e.mensajeria,
          enviarTexto: async () => {
            throw new Error('ECONNRESET');
          },
        },
      } as never;
    };

    let botFalla: string;
    let versionFalla: string;

    beforeAll(async () => {
      const compilacion = compilar(FLUJO_FALLA);
      expect(compilacion.ok).toBe(true);

      const b = await prisma.flowBot.create({
        data: {
          companyId: empresa,
          name: `${PREFIJO}-falla`,
          status: 'ACTIVE',
          draftGraph: FLUJO_FALLA as never,
        },
      });
      botFalla = b.id;
      const v = await prisma.flowBotVersion.create({
        data: {
          flowBotId: botFalla,
          version: 1,
          graph: FLUJO_FALLA as never,
          compiled: compilacion.compilado as never,
          compiledHash: compilacion.hash!,
        },
      });
      versionFalla = v.id;
      await prisma.flowBot.update({
        where: { id: botFalla },
        data: { publishedVersionId: versionFalla, lastVersionNumber: 1 },
      });
    });

    const arrancarQueFalla = async () => {
      n += 1;
      const { executionId } = await runner.arrancar({
        companyId: empresa,
        flowBotId: botFalla,
        versionId: versionFalla,
        eventKey: `${PREFIJO}-falla-${n}-${Date.now()}`,
        conversationId: conversacion,
        correlationId: `corr-falla-${n}`,
      });
      return executionId;
    };

    it('31. un fallo reintentable NO deja la ejecución en FAILED', async () => {
      const executionId = await arrancarQueFalla();

      await runner.avanzarEjecucion(executionId, efectosRotos(), compiladoDe);

      const e = await prisma.flowBotExecution.findUnique({
        where: { id: executionId },
      });
      // Si quedara FAILED, `tomarLease` rechazaría el trabajo del reintento
      // —solo acepta estados vivos— y el reintento no se ejecutaría nunca.
      expect(e?.status).toBe('RUNNING');
      expect(e?.errorCode).not.toBeNull();
    });

    it('32. el reintento se persiste como evento de outbox propio', async () => {
      const executionId = await arrancarQueFalla();

      await runner.avanzarEjecucion(executionId, efectosRotos(), compiladoDe);

      const eventos = await eventosDe(executionId);
      const reintento = eventos.find((e) =>
        e.idempotencyKey.includes(':reintento:'),
      );
      // Sin el evento, morir entre el commit y el encolado dejaría la
      // ejecución RUNNING sin nada que la moviera hasta el reconciliador.
      expect(reintento).toBeDefined();
      expect((reintento!.payload as { intento?: number }).intento).toBe(2);
    });

    it('33. el trabajo del reintento sale con backoff y con su propio jobId', async () => {
      const executionId = await arrancarQueFalla();
      cola.limpiar();

      await runner.avanzarEjecucion(executionId, efectosRotos(), compiladoDe);

      const trabajo = cola
        .de('avanzar')
        .find((t) => t.job.executionId === executionId);
      expect(trabajo).toBeDefined();
      expect(trabajo!.job.intento).toBe(2);
      expect(trabajo!.delayMs).toBeGreaterThan(0);
      // Sin el nº de intento en el id, se descartaría como duplicado del
      // avance que acaba de fallar.
      expect(trabajo!.jobId.endsWith('-2')).toBe(true);
    });

    it('34. agotados los intentos SÍ queda FAILED', async () => {
      const executionId = await arrancarQueFalla();

      await runner.avanzarEjecucion(executionId, efectosRotos(), compiladoDe, {
        intento: MAX_INTENTOS,
      });

      const e = await prisma.flowBotExecution.findUnique({
        where: { id: executionId },
      });
      // Se probó y no salió: eso sí es terminal.
      expect(e?.status).toBe('FAILED');
      expect(e?.endedAt).not.toBeNull();
    });

    it('35. el reintento avanza de verdad: toma el lease sin problema', async () => {
      const executionId = await arrancarQueFalla();
      await runner.avanzarEjecucion(executionId, efectosRotos(), compiladoDe);

      const segundo = await runner.avanzarEjecucion(
        executionId,
        efectosRotos(),
        compiladoDe,
        { intento: 2 },
      );

      // Lo que estaba roto antes: con la ejecución en FAILED esto devolvía
      // "omitido" y el reintento no llegaba a ejecutarse nunca.
      expect(segundo.estado).not.toBe('omitido');
    });

    it('36. si el efecto acaba saliendo, el error queda anotado igual', async () => {
      const executionId = await arrancarQueFalla();
      await runner.avanzarEjecucion(executionId, efectosRotos(), compiladoDe);

      // Segundo intento con el HTTP ya sano.
      await runner.avanzarEjecucion(executionId, efectos(), compiladoDe, {
        intento: 2,
      });

      const pasos = await prisma.flowBotExecutionStep.findMany({
        where: { executionId },
      });
      // Queda constancia de que costó: un flujo que solo funciona al segundo
      // intento es un flujo con un problema, y borrar el rastro lo esconde.
      expect(pasos.some((p) => p.status === 'FAILED')).toBe(true);
    });
  });

  // ── 5. Recuperación de leases ─────────────────────────────────

  describe('recuperación de leases vencidos', () => {
    /** Deja la ejecución como si un worker hubiera muerto avanzándola. */
    const simularWorkerMuerto = async (executionId: string) => {
      await prisma.flowBotExecution.update({
        where: { id: executionId },
        data: {
          status: 'RUNNING',
          leaseOwner: 'worker-muerto',
          leaseUntil: new Date(Date.now() - 10 * 60_000),
        },
      });
    };

    it('26. SIN paso registrado tras el lease queda NEEDS_ATTENTION y no se reencola', async () => {
      const executionId = await arrancarYAvanzar();
      await prisma.flowBotExecutionStep.deleteMany({ where: { executionId } });
      await simularWorkerMuerto(executionId);
      cola.limpiar();

      await reconciler.reconciliar();

      const tras = await prisma.flowBotExecution.findUnique({
        where: { id: executionId },
      });
      // El worker pudo morir DESPUÉS de mandar el WhatsApp. Reintentar se lo
      // mandaría dos veces; abandonar lo dejaría a medias. Decide una persona.
      expect(tras?.status).toBe('NEEDS_ATTENTION');
      expect(tras?.attentionReason).toBe('lease-vencido-sin-paso-registrado');
      expect(
        cola.de('avanzar').some((t) => t.job.executionId === executionId),
      ).toBe(false);
    });

    it('27. CON paso registrado tras el lease, libera y reencola', async () => {
      const executionId = await arrancarYAvanzar();
      await simularWorkerMuerto(executionId);
      // El paso del avance ya está escrito y es posterior al inicio del lease.
      await prisma.flowBotExecutionStep.updateMany({
        where: { executionId },
        data: { createdAt: new Date() },
      });
      cola.limpiar();

      await reconciler.reconciliar();

      const tras = await prisma.flowBotExecution.findUnique({
        where: { id: executionId },
      });
      // El efecto está probado y su clave de idempotencia lo protege.
      expect(tras?.status).toBe('RUNNING');
      expect(tras?.leaseOwner).toBeNull();
      expect(tras?.recoveries).toBe(1);
      expect(
        cola.de('avanzar').some((t) => t.job.executionId === executionId),
      ).toBe(true);
    });

    it('28. marcar para revisión deja rastro en la línea de tiempo', async () => {
      const executionId = await arrancarYAvanzar();
      await prisma.flowBotExecutionStep.deleteMany({ where: { executionId } });
      await simularWorkerMuerto(executionId);

      await reconciler.reconciliar();

      const rastro = await prisma.flowBotExecutionStep.findFirst({
        where: { executionId, nodeType: 'system.reconcile' },
      });
      // Va aquí y no a AuditLog: ese registra lo que hace una PERSONA.
      expect(rastro).not.toBeNull();
      expect(rastro?.outPort).toBe('lease-vencido-sin-paso-registrado');
    });

    it('29. una ejecución en NEEDS_ATTENTION no se vuelve a tocar', async () => {
      const executionId = await arrancarYAvanzar();
      await prisma.flowBotExecutionStep.deleteMany({ where: { executionId } });
      await simularWorkerMuerto(executionId);
      await reconciler.reconciliar();
      cola.limpiar();

      await reconciler.reconciliar();

      // Ni se reencola ni se duplica el rastro: el motor ya dijo lo que sabía
      // y ahora le toca a una persona.
      expect(
        cola.de('avanzar').some((t) => t.job.executionId === executionId),
      ).toBe(false);
      const rastros = await prisma.flowBotExecutionStep.count({
        where: { executionId, nodeType: 'system.reconcile' },
      });
      expect(rastros).toBe(1);
    });

    it('30. su espera se consume: nada intentará despertar lo que espera revisión', async () => {
      const executionId = await arrancarYAvanzar();
      const espera = await esperaDe(executionId);
      await prisma.flowBotExecutionStep.deleteMany({ where: { executionId } });
      await simularWorkerMuerto(executionId);

      await reconciler.reconciliar();
      await reconciler.reconciliar(); // la limpieza ocurre en el pase siguiente

      const tras = await prisma.flowBotWait.findUnique({
        where: { id: espera!.id },
      });
      expect(tras?.consumedAt).not.toBeNull();
    });
  });
});
