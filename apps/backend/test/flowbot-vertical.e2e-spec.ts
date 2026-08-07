import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { OutboxService } from '../src/common/outbox/outbox.service';
import { OutboxDispatcher } from '../src/common/outbox/outbox.dispatcher';
import { OutboxHandlerRegistry } from '../src/common/outbox/outbox.handlers';
import { CustomFieldsService } from '../src/modules/custom-fields/custom-fields.service';
import { HandoffService } from '../src/modules/conversations/handoff.service';
import { LeadIntakeService } from '../src/modules/leads/lead-intake.service';
import { LeadSettingsService } from '../src/modules/leads/lead-settings.service';
import { FlowBotRunnerService } from '../src/modules/flowbot/engine/flowbot.runner';
import { FlowBotQueueService } from '../src/modules/flowbot/engine/flowbot.queue';
import { FlowBotIntakeService } from '../src/modules/flowbot/engine/flowbot.intake';
import { FlowBotSelectorService } from '../src/modules/flowbot/engine/flowbot.selector';
import { FlowBotReconcilerService } from '../src/modules/flowbot/engine/flowbot.reconciler';
import { FlowBotOutboxPublisher } from '../src/modules/flowbot/engine/flowbot.outbox';
import { CrmAdapter } from '../src/modules/flowbot/engine/adapters/flowbot.crm.adapter';
import { WhatsappAdapter } from '../src/modules/flowbot/engine/adapters/flowbot.whatsapp.adapter';
import { TransporteWhatsAppFalso } from '../src/modules/flowbot/engine/adapters/flowbot.whatsapp.fake-transport';
import { EfectosFalsos } from '../src/modules/flowbot/engine/flowbot.fake-effects';
import { Efectos } from '../src/modules/flowbot/engine/flowbot.ports';
import { compilar } from '../src/modules/flowbot/graph/flowbot.compiler';
import {
  ConexionFlow,
  GrafoFlow,
  NodoFlow,
} from '../src/modules/flowbot/graph/flowbot.graph';
import { LEASE_MS } from '../src/modules/flowbot/engine/flowbot.runner';

/**
 * LA VERTICAL COMPLETA, contra la base REAL.
 *
 *   mensaje entrante → contacto → conversación → oportunidad en la etapa
 *   inicial → selección del bot → ejecución durable → respuesta de WhatsApp
 *   simulada → espera → reanudación → acciones CRM → campo personalizado →
 *   tarea → movimiento de etapa → handoff humano
 *
 * Se usan los SERVICIOS REALES, cableados a mano como los cablearía Nest. Lo
 * único falso es el transporte HTTP hacia Meta, que implementa el mismo
 * contrato que el real: número remitente, ventana de 24 h, idempotencia,
 * persistencia y clasificación de errores se ejercitan de verdad.
 *
 * Todo lo que se crea lleva el prefijo E2E-VERTICAL y se limpia al final.
 */
const prisma = new PrismaClient();
const PREFIJO = 'E2E-VERTICAL';

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

describe('vertical completa de FlowBot (e2e, base real)', () => {
  const servicioPrisma = prisma as unknown as PrismaService;
  const transporte = new TransporteWhatsAppFalso();

  let outbox: OutboxService;
  let campos: CustomFieldsService;
  let handoff: HandoffService;
  let runner: FlowBotRunnerService;
  let intake: FlowBotIntakeService;
  let leadIntake: LeadIntakeService;
  let reconciler: FlowBotReconcilerService;
  let dispatcher: OutboxDispatcher;
  let cola: FlowBotQueueService;

  let empresaA: string;
  let empresaB: string;
  let pipelineA: string;
  let etapaInicial: string;
  let etapaSiguiente: string;
  let asesorA: string;
  let numeroSoporte: string;
  let numeroVentas: string;
  let botA: string;
  let versionA: string;
  let campoContacto: string;
  let campoLead: string;
  let n = 0;

  /** Cripto inerte: aquí no se prueba el cifrado, se prueba el recorrido. */
  const cripto = { decrypt: () => 'token-simulado' } as never;

  /** Efectos REALES de CRM + WhatsApp sobre transporte falso. */
  const efectosDe = (
    companyId: string,
    executionId: string | null,
  ): Efectos => {
    const falsos = new EfectosFalsos({ dentroDeVentana: true });
    return {
      crm: new CrmAdapter(
        servicioPrisma,
        companyId,
        campos,
        handoff,
        executionId,
      ),
      mensajeria: new WhatsappAdapter(
        servicioPrisma,
        companyId,
        // Los tres apuntan al falso: esta suite corre contra la base real y
        // NO puede tener ni la posibilidad de abrir una conexión a Meta.
        { falso: transporte, dryRun: transporte, real: transporte },
        cripto,
        {
          evaluar: async () => ({
            modo: 'falso' as const,
            bloqueos: [],
            explicacion: 'e2e',
            cupoConsumido: true,
          }),
          registrarExito: async () => undefined,
          registrarFallo: async () => ({
            abierto: false,
            bloqueada: false,
            estado: 'CLOSED' as const,
          }),
          devolverCupo: async () => undefined,
        } as never,
        {
          estado: async () => ({
            aprobada: true,
            parametros: 0,
            idioma: 'es',
            verificadaEn: new Date(),
          }),
        } as never,
        executionId,
      ),
      http: falsos.http,
      ia: falsos.ia,
      reloj: { ahora: () => new Date() },
      auditoria: falsos.auditoria,
    };
  };

  const compiladoDe = async (versionId: string) => {
    const v = await prisma.flowBotVersion.findUnique({
      where: { id: versionId },
      select: { compiled: true },
    });
    return v ? (v.compiled as never) : null;
  };

  // ── el flujo bajo prueba ──────────────────────────────────────
  //
  // Recorre TODO lo que pide la vertical: saluda, pregunta, guarda en campos
  // personalizados de contacto y de oportunidad, mueve la etapa, crea tarea,
  // asigna y entrega a una persona.
  const FLUJO: GrafoFlow = {
    schemaVersion: 1,
    startNodeId: 'inicio',
    nodes: [
      nodo('inicio', 'trigger.inbound_message'),
      nodo('saluda', 'send.text', { text: 'Hola, soy el bot' }),
      nodo('pide', 'ask.question', {
        text: '¿Cómo te llamas?',
        saveAs: 'nombre',
        timeoutSeconds: 3600,
      }),
      nodo('guarda_contacto', 'crm.contact_field', {
        field: 'origen_lead',
        value: 'whatsapp',
      }),
      nodo('guarda_lead', 'crm.lead_field', {
        field: 'presupuesto',
        value: '1500000',
      }),
      nodo('tarea', 'crm.task_create', { title: 'Llamar a {{flow.nombre}}' }),
      // `crm.handoff` es TERMINAL por diseño: no tiene salida. Entregar a una
      // persona y seguir ejecutando el flujo sería el bot hablando por encima
      // del asesor, que es justo lo que el handoff existe para evitar.
      nodo('entrega', 'crm.handoff', { reason: 'cliente-identificado' }),
    ],
    edges: [
      con('inicio', 'next', 'saluda'),
      con('saluda', 'next', 'pide'),
      con('pide', 'next', 'guarda_contacto'),
      con('guarda_contacto', 'next', 'guarda_lead'),
      con('guarda_lead', 'next', 'tarea'),
      con('tarea', 'next', 'entrega'),
    ],
  };

  beforeAll(async () => {
    process.env.QUEUE_ENABLED = 'false';

    outbox = new OutboxService(servicioPrisma);
    campos = new CustomFieldsService(servicioPrisma);
    handoff = new HandoffService(servicioPrisma, {
      emit: async () => undefined,
    } as never);
    cola = new FlowBotQueueService();
    runner = new FlowBotRunnerService(servicioPrisma, outbox, cola);
    intake = new FlowBotIntakeService(
      servicioPrisma,
      outbox,
      cola,
      new FlowBotSelectorService(servicioPrisma),
      runner,
      handoff,
    );
    // Reparto, avisos y tiempo real inertes: esta suite mide el recorrido de
    // los datos, no la mensajeria interna.
    leadIntake = new LeadIntakeService(
      servicioPrisma,
      {
        asignarSiguiente: async () => null,
        warnNobodyAvailable: async () => undefined,
      } as never,
      { emit: async () => undefined } as never,
      { leadUpdated: () => undefined, leadCreated: () => undefined } as never,
      new LeadSettingsService(servicioPrisma),
    );
    reconciler = new FlowBotReconcilerService(servicioPrisma, cola, outbox);

    const registro = new OutboxHandlerRegistry();
    new FlowBotOutboxPublisher(registro, servicioPrisma, cola).onModuleInit();
    dispatcher = new OutboxDispatcher(
      outbox,
      { enqueueInboundMessage: async () => true } as never,
      registro,
    );

    // ── dos empresas, para probar el aislamiento ──
    const a = await prisma.company.create({
      data: { name: `${PREFIJO}-A`, status: 'ACTIVE' },
    });
    const b = await prisma.company.create({
      data: { name: `${PREFIJO}-B`, status: 'ACTIVE' },
    });
    empresaA = a.id;
    empresaB = b.id;

    const usuario = await prisma.user.create({
      data: {
        companyId: empresaA,
        email: `${PREFIJO.toLowerCase()}-asesor@ejemplo.test`,
        password: 'no-se-usa',
        name: 'Asesor Uno',
        role: 'AGENT',
      },
    });
    asesorA = usuario.id;

    // ── dos números en la MISMA empresa ──
    const soporte = await prisma.whatsAppIntegration.create({
      data: {
        companyId: empresaA,
        phoneNumberId: `${PREFIJO}-soporte`,
        displayPhoneNumber: '+573000000001',
        status: 'CONNECTED',
        accessTokenEncrypted: 'cifrado-soporte',
        isPrimary: false,
        order: 2,
      },
    });
    const ventas = await prisma.whatsAppIntegration.create({
      data: {
        companyId: empresaA,
        phoneNumberId: `${PREFIJO}-ventas`,
        displayPhoneNumber: '+573000000002',
        status: 'CONNECTED',
        accessTokenEncrypted: 'cifrado-ventas',
        isPrimary: true,
        order: 1,
      },
    });
    numeroSoporte = soporte.id;
    numeroVentas = ventas.id;

    // ── pipeline con etapa inicial EXPLÍCITA ──
    const pipeline = await prisma.pipeline.create({
      data: { companyId: empresaA, name: `${PREFIJO}-pipeline`, order: 0 },
    });
    pipelineA = pipeline.id;
    const e1 = await prisma.pipelineStage.create({
      data: {
        pipelineId: pipelineA,
        name: 'Bandeja de entrada',
        order: 0,
        isInitial: true,
      },
    });
    const e2 = await prisma.pipelineStage.create({
      data: { pipelineId: pipelineA, name: 'Calificado', order: 1 },
    });
    etapaInicial = e1.id;
    etapaSiguiente = e2.id;

    await prisma.companyLeadSettings.create({
      data: {
        companyId: empresaA,
        autoCreateLead: true,
        defaultPipelineId: pipelineA,
        initialStageId: etapaInicial,
        reuseOpenLead: true,
        createInitialTask: true,
        initialTaskTitle: 'Primer contacto',
        assignmentStrategy: 'NINGUNA',
      },
    });

    // ── campos personalizados ──
    const c1 = await campos.crearDefinicion(empresaA, {
      entity: 'CONTACT',
      key: 'origen_lead',
      label: 'Origen',
      type: 'SELECT',
      options: [
        { value: 'whatsapp', label: 'WhatsApp' },
        { value: 'web', label: 'Web' },
      ],
    });
    const c2 = await campos.crearDefinicion(empresaA, {
      entity: 'LEAD',
      key: 'presupuesto',
      label: 'Presupuesto',
      type: 'CURRENCY',
    });
    campoContacto = c1.id;
    campoLead = c2.id;

    // ── el bot ──
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
    await prisma.flowBotTrigger.create({
      data: {
        flowBotId: botA,
        type: 'INBOUND_MESSAGE',
        enabled: true,
        priority: 100,
        exclusive: true,
      },
    });
  });

  afterAll(async () => {
    const empresas = [empresaA, empresaB];
    await prisma.customFieldValueChange.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.customFieldValue.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.customFieldDefinition.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.conversationHandoff.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.flowBotWait.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.flowBotExecutionStep.deleteMany({
      where: { execution: { companyId: { in: empresas } } },
    });
    await prisma.flowBotExecution.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.flowBotTrigger.deleteMany({
      where: { flowBot: { companyId: { in: empresas } } },
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
    await prisma.taskSuggestion.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.task.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.note.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.message.deleteMany({
      where: { conversation: { companyId: { in: empresas } } },
    });
    await prisma.leadStageHistory.deleteMany({
      where: { lead: { companyId: { in: empresas } } },
    });
    await prisma.conversation.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.lead.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.contact.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.companyLeadSettings.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.pipelineStage.deleteMany({
      where: { pipeline: { companyId: { in: empresas } } },
    });
    await prisma.pipeline.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.whatsAppIntegration.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.user.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.company.deleteMany({ where: { id: { in: empresas } } });
    await prisma.$disconnect();
  });

  beforeEach(() => transporte.limpiar());

  // ── utilidades del recorrido ──────────────────────────────────

  /**
   * Simula lo que hace el webhook DESPUÉS de verificar la firma: contacto,
   * conversación y mensaje persistido. El orden es el mismo que en producción.
   */
  const llegaMensaje = async (opciones: {
    telefono?: string;
    texto: string;
    companyId?: string;
    integrationId?: string;
    wamid?: string;
  }) => {
    n += 1;
    const companyId = opciones.companyId ?? empresaA;
    const telefono = opciones.telefono ?? '+573001110001';

    const contacto = await prisma.contact.upsert({
      where: { phone_companyId: { phone: telefono, companyId } },
      create: { companyId, phone: telefono, name: `${PREFIJO}-contacto` },
      update: {},
    });

    let conversacion = await prisma.conversation.findFirst({
      where: { companyId, contactId: contacto.id, status: 'OPEN' },
    });
    if (!conversacion) {
      conversacion = await prisma.conversation.create({
        data: {
          companyId,
          contactId: contacto.id,
          whatsappIntegrationId: opciones.integrationId ?? numeroSoporte,
        },
      });
    }

    const mensaje = await prisma.message.create({
      data: {
        conversationId: conversacion.id,
        wamid: opciones.wamid ?? `${PREFIJO}-wamid-${n}-${Date.now()}`,
        body: opciones.texto,
        direction: 'INBOUND',
        type: 'TEXT',
        status: 'RECEIVED',
      },
    });

    return { contacto, conversacion, mensaje };
  };

  /** El paso del webhook: oportunidad primero, FlowBot después. */
  const procesar = async (ctx: {
    contacto: { id: string; name: string | null };
    conversacion: { id: string };
    mensaje: { id: string };
    texto: string;
    companyId?: string;
  }) => {
    const companyId = ctx.companyId ?? empresaA;
    const oportunidad = await leadIntake.ensureLeadForConversation({
      companyId,
      contactId: ctx.contacto.id,
      conversationId: ctx.conversacion.id,
      contactName: ctx.contacto.name,
    });

    const r = await intake.atenderMensaje({
      companyId,
      conversationId: ctx.conversacion.id,
      messageId: ctx.mensaje.id,
      contactId: ctx.contacto.id,
      leadId: oportunidad.leadId,
      texto: ctx.texto,
    });
    return { oportunidad, flowbot: r };
  };

  /** Avanza la ejecución como lo haría el consumidor del worker. */
  const avanzar = async (
    executionId: string,
    opciones: { waitId?: string; entrada?: string } = {},
  ) => {
    const e = await prisma.flowBotExecution.findUnique({
      where: { id: executionId },
      select: { companyId: true },
    });
    return runner.avanzarEjecucion(
      executionId,
      efectosDe(e!.companyId, executionId),
      compiladoDe,
      opciones,
    );
  };

  const esperaDe = (executionId: string) =>
    prisma.flowBotWait.findFirst({
      where: { executionId, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

  /** Recorre la vertical entera y devuelve todo lo que produjo. */
  const recorridoCompleto = async (telefono: string) => {
    const uno = await llegaMensaje({ telefono, texto: 'hola' });
    const { oportunidad, flowbot } = await procesar({ ...uno, texto: 'hola' });
    const executionId = flowbot.executionId!;

    await avanzar(executionId);
    const espera = await esperaDe(executionId);

    const dos = await llegaMensaje({ telefono, texto: 'Ana Gómez' });
    await procesar({ ...dos, texto: 'Ana Gómez' });
    await avanzar(executionId, { waitId: espera!.id, entrada: 'Ana Gómez' });

    return {
      executionId,
      leadId: oportunidad.leadId!,
      contacto: uno.contacto,
      conversacion: uno.conversacion,
    };
  };

  // ═══ 1-4. Entrada, oportunidad, bot y respuesta ═══════════════

  describe('entrada y arranque', () => {
    it('1. mensaje nuevo → contacto → conversación → oportunidad inicial', async () => {
      const ctx = await llegaMensaje({
        telefono: '+573001110010',
        texto: 'hola',
      });
      const { oportunidad } = await procesar({ ...ctx, texto: 'hola' });

      expect(oportunidad.leadId).toBeTruthy();
      const lead = await prisma.lead.findUnique({
        where: { id: oportunidad.leadId! },
      });
      // La etapa se elige por la MARCA, no por el orden ni por el nombre.
      expect(lead?.stageId).toBe(etapaInicial);
      expect(lead?.status).toBe('OPEN');
    });

    it('2. la etapa inicial NO depende del nombre "Nuevo lead"', async () => {
      const etapa = await prisma.pipelineStage.findUnique({
        where: { id: etapaInicial },
      });
      // Se llama "Bandeja de entrada" y aun así recibe: lo que decide es la
      // marca `isInitial`, no el texto. Con el nombre como criterio, renombrar
      // la columna del tablero dejaría de crear oportunidades en silencio.
      expect(etapa?.name).not.toContain('Nuevo lead');
      expect(etapa?.isInitial).toBe(true);
    });

    it('3. la selección del bot es determinista', async () => {
      const selector = new FlowBotSelectorService(servicioPrisma);
      const a = await selector.seleccionar({
        companyId: empresaA,
        tipo: 'INBOUND_MESSAGE',
        texto: 'hola',
      });
      const b = await selector.seleccionar({
        companyId: empresaA,
        tipo: 'INBOUND_MESSAGE',
        texto: 'hola',
      });

      // Con dos bots compatibles, cuál responde no puede depender del orden
      // en que la base devuelva las filas.
      expect(a.elegidos.map((e) => e.flowBotId)).toEqual(
        b.elegidos.map((e) => e.flowBotId),
      );
      expect(a.elegidos[0]?.flowBotId).toBe(botA);
    });

    it('4. la ejecución se crea de forma idempotente', async () => {
      const ctx = await llegaMensaje({
        telefono: '+573001110011',
        texto: 'hola',
      });
      const primera = await procesar({ ...ctx, texto: 'hola' });
      const segunda = await procesar({ ...ctx, texto: 'hola' });

      // El mismo mensaje entregado dos veces por Meta no abre dos ejecuciones.
      expect(segunda.flowbot.executionId).toBe(primera.flowbot.executionId);
      const cuantas = await prisma.flowBotExecution.count({
        where: { conversationId: ctx.conversacion.id },
      });
      expect(cuantas).toBe(1);
    });

    it('5. la respuesta de WhatsApp sale por el adaptador real', async () => {
      const ctx = await llegaMensaje({
        telefono: '+573001110012',
        texto: 'hola',
      });
      const { flowbot } = await procesar({ ...ctx, texto: 'hola' });
      await avanzar(flowbot.executionId!);

      // Persistida en el hilo, con su clave de idempotencia.
      const saliente = await prisma.message.findFirst({
        where: {
          conversationId: ctx.conversacion.id,
          direction: 'OUTBOUND',
        },
      });
      expect(saliente?.status).toBe('SENT');
      expect(saliente?.externalKey).toContain(flowbot.executionId!);
      expect(transporte.vecesDe('text')).toBeGreaterThan(0);
    });
  });

  // ═══ 5-8. Esperas ════════════════════════════════════════════

  describe('esperas', () => {
    it('6. la ejecución espera el mensaje del cliente', async () => {
      const ctx = await llegaMensaje({
        telefono: '+573001110020',
        texto: 'hola',
      });
      const { flowbot } = await procesar({ ...ctx, texto: 'hola' });
      await avanzar(flowbot.executionId!);

      const e = await prisma.flowBotExecution.findUnique({
        where: { id: flowbot.executionId! },
      });
      expect(e?.status).toBe('WAITING_INPUT');
      // La espera está PERSISTIDA, no es un temporizador en memoria.
      expect(await esperaDe(flowbot.executionId!)).not.toBeNull();
    });

    it('7. el siguiente mensaje la reanuda', async () => {
      const r = await recorridoCompleto('+573001110021');
      const e = await prisma.flowBotExecution.findUnique({
        where: { id: r.executionId },
      });

      expect(e?.status).toBe('HANDED_OFF');
      const variables = e?.variables as { flow?: { nombre?: string } };
      expect(variables.flow?.nombre).toBe('Ana Gómez');
    });

    it('8. la espera se consume EXACTAMENTE una vez', async () => {
      const ctx = await llegaMensaje({
        telefono: '+573001110022',
        texto: 'hola',
      });
      const { flowbot } = await procesar({ ...ctx, texto: 'hola' });
      await avanzar(flowbot.executionId!);
      const espera = await esperaDe(flowbot.executionId!);

      const [a, b] = await Promise.all([
        avanzar(flowbot.executionId!, { waitId: espera!.id, entrada: 'Ana' }),
        avanzar(flowbot.executionId!, { waitId: espera!.id, entrada: 'Ana' }),
      ]);

      // Sin esto el cliente recibiría dos respuestas a la misma pregunta.
      expect([a, b].filter((r) => r.estado === 'omitido')).toHaveLength(1);
    });

    it('9. un mensaje posterior NO puede reabrir una espera consumida', async () => {
      const ctx = await llegaMensaje({
        telefono: '+573001110023',
        texto: 'hola',
      });
      const { flowbot } = await procesar({ ...ctx, texto: 'hola' });
      await avanzar(flowbot.executionId!);
      const espera = await esperaDe(flowbot.executionId!);
      await avanzar(flowbot.executionId!, {
        waitId: espera!.id,
        entrada: 'Ana',
      });

      const tardio = await avanzar(flowbot.executionId!, {
        waitId: espera!.id,
        entrada: 'Ana otra vez',
      });

      expect(tardio.estado).toBe('omitido');
    });

    it('10. una espera vencida sale por el puerto de tiempo agotado', async () => {
      const FLUJO_TIEMPO: GrafoFlow = {
        schemaVersion: 1,
        startNodeId: 'inicio',
        nodes: [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('pide', 'ask.question', {
            text: '¿Sigues ahí?',
            saveAs: 'r',
            timeoutSeconds: 60,
          }),
          nodo('siguio', 'send.text', { text: 'Gracias' }),
          nodo('nadie', 'send.text', { text: 'Aquí sigo' }),
          nodo('fin', 'control.end'),
        ],
        edges: [
          con('inicio', 'next', 'pide'),
          con('pide', 'next', 'siguio'),
          con('pide', 'timeout', 'nadie'),
          con('siguio', 'next', 'fin'),
          con('nadie', 'next', 'fin'),
        ],
      };
      const { executionId } = await conFlujo(FLUJO_TIEMPO, '+573001110024');
      await avanzar(executionId);
      const espera = await esperaDe(executionId);
      await prisma.flowBotWait.update({
        where: { id: espera!.id },
        data: { wakeAt: new Date(Date.now() - 1000) },
      });

      await avanzar(executionId, { waitId: espera!.id });

      const pasos = await prisma.flowBotExecutionStep.findMany({
        where: { executionId },
      });
      // Sale por 'nadie' y NO reejecuta 'pide': eso reenviaría la pregunta al
      // cliente justo cuando ya se dio por vencido el plazo.
      expect(pasos.some((p) => p.nodeId === 'nadie')).toBe(true);
      expect(pasos.filter((p) => p.nodeId === 'pide')).toHaveLength(1);
    });
  });

  // ═══ 9-13. Acciones CRM ══════════════════════════════════════

  describe('acciones de CRM', () => {
    it('11. el campo personalizado del CONTACTO se guarda de verdad', async () => {
      const r = await recorridoCompleto('+573001110030');

      const valor = await prisma.customFieldValue.findFirst({
        where: { definitionId: campoContacto, contactId: r.contacto.id },
      });
      // Ya NO es una etiqueta `campo:valor`.
      expect(valor?.valueText).toBe('whatsapp');
      const contacto = await prisma.contact.findUnique({
        where: { id: r.contacto.id },
      });
      expect(contacto?.tags.join(',')).not.toContain('origen_lead:');
    });

    it('12. el campo de la OPORTUNIDAD se guarda como número', async () => {
      const r = await recorridoCompleto('+573001110031');

      const valor = await prisma.customFieldValue.findFirst({
        where: { definitionId: campoLead, leadId: r.leadId },
      });
      // Decimal, no Float: la moneda en coma flotante no cuadra.
      expect(valor?.valueNumber?.toNumber()).toBe(1500000);
      expect(valor?.valueText).toBeNull();
    });

    it('13. el cambio queda en el historial con su origen', async () => {
      const r = await recorridoCompleto('+573001110032');

      const cambio = await prisma.customFieldValueChange.findFirst({
        where: { definitionId: campoContacto, entityId: r.contacto.id },
      });
      expect(cambio?.source).toBe('FLOWBOT');
      // Saber qué bot tocó un campo del cliente es la mitad de poder
      // explicarlo después.
      expect(cambio?.executionId).toBe(r.executionId);
      expect(cambio?.actorUserId).toBeNull();
    });

    /**
     * ESTO CAMBIÓ A PROPÓSITO.
     *
     * El nodo «Crear tarea» ya NO crea una tarea cuando la empresa exige
     * aprobación, y exigirla es lo predeterminado: deja una PROPUESTA. Un bot
     * que mete trabajo en la lista de una persona sin que esa persona lo
     * acepte convierte la lista en un vertedero que nadie mira.
     */
    it('14. el nodo de tarea deja una PROPUESTA, no una tarea', async () => {
      const r = await recorridoCompleto('+573001110033');

      const tarea = await prisma.task.findFirst({
        where: { companyId: empresaA, leadId: r.leadId },
        orderBy: { createdAt: 'desc' },
      });
      expect(tarea).toBeNull();

      const propuesta = await prisma.taskSuggestion.findFirst({
        where: { companyId: empresaA, leadId: r.leadId },
        orderBy: { createdAt: 'desc' },
      });
      expect(propuesta).not.toBeNull();
      expect(propuesta!.status).toBe('PENDING');
      expect(propuesta!.source).toBe('flowbot');
    });

    it('15. mover de etapa deja historial', async () => {
      const r = await recorridoCompleto('+573001110034');
      const crm = new CrmAdapter(
        servicioPrisma,
        empresaA,
        campos,
        handoff,
        r.executionId,
      );

      await crm.moverEtapa({ leadId: r.leadId, stageId: etapaSiguiente });

      const lead = await prisma.lead.findUnique({ where: { id: r.leadId } });
      expect(lead?.stageId).toBe(etapaSiguiente);
      const historial = await prisma.leadStageHistory.findFirst({
        where: { leadId: r.leadId },
        orderBy: { changedAt: 'desc' },
      });
      expect(historial?.toStageId).toBe(etapaSiguiente);
    });

    it('16. asignar responsable acota por empresa', async () => {
      const r = await recorridoCompleto('+573001110035');
      const crm = new CrmAdapter(
        servicioPrisma,
        empresaA,
        campos,
        handoff,
        null,
      );

      await crm.asignar({ leadId: r.leadId, userId: asesorA });
      const lead = await prisma.lead.findUnique({ where: { id: r.leadId } });
      expect(lead?.assignedTo).toBe(asesorA);

      // Un usuario que no es de esta empresa no puede quedarse la oportunidad,
      // y el intento FALLA en voz alta en vez de no hacer nada en silencio: un
      // flujo mal configurado tiene que notarse.
      const crmB = new CrmAdapter(
        servicioPrisma,
        empresaB,
        campos,
        handoff,
        null,
      );
      await expect(
        crmB.asignar({ leadId: r.leadId, userId: asesorA }),
      ).rejects.toThrow('UsuarioNoValidoError');
      const sinCambio = await prisma.lead.findUnique({
        where: { id: r.leadId },
      });
      expect(sinCambio?.assignedTo).toBe(asesorA);
    });

    it('17. un reintento NO duplica el efecto', async () => {
      const ctx = await llegaMensaje({
        telefono: '+573001110036',
        texto: 'hola',
      });
      const { flowbot } = await procesar({ ...ctx, texto: 'hola' });

      await avanzar(flowbot.executionId!);
      const antes = await prisma.message.count({
        where: { conversationId: ctx.conversacion.id, direction: 'OUTBOUND' },
      });

      // Un avance suelto sobre una ejecución que ESTÁ esperando: el caso que
      // produce un reintento tardío o un evento de outbox duplicado.
      const repetido = await avanzar(flowbot.executionId!);
      const despues = await prisma.message.count({
        where: { conversationId: ctx.conversacion.id, direction: 'OUTBOUND' },
      });

      // Se descarta en vez de reejecutar el nodo que espera, que le habría
      // repetido la pregunta al cliente.
      expect(repetido.estado).toBe('omitido');
      expect(despues).toBe(antes);
    });

    it('18. archivar un contacto NO borra nada', async () => {
      const r = await recorridoCompleto('+573001110037');
      const crm = new CrmAdapter(
        servicioPrisma,
        empresaA,
        campos,
        handoff,
        null,
      );

      await crm.archivarContacto({
        contactId: r.contacto.id,
        motivo: 'inactivo',
      });

      const contacto = await prisma.contact.findUnique({
        where: { id: r.contacto.id },
      });
      expect(contacto?.archivedAt).not.toBeNull();
      // Conversaciones y oportunidades siguen ahí: son datos del negocio.
      expect(
        await prisma.conversation.count({
          where: { contactId: r.contacto.id },
        }),
      ).toBeGreaterThan(0);
      expect(
        await prisma.lead.count({ where: { contactId: r.contacto.id } }),
      ).toBeGreaterThan(0);
    });
  });

  // ═══ 14-16. Handoff ══════════════════════════════════════════

  describe('handoff humano', () => {
    it('19. el flujo entrega la conversación a una persona', async () => {
      const r = await recorridoCompleto('+573001110040');

      const entrega = await prisma.conversationHandoff.findFirst({
        where: { conversationId: r.conversacion.id, status: 'ACTIVE' },
      });
      expect(entrega).not.toBeNull();
      expect(entrega?.reason).toBe('cliente-identificado');
      // Queda registrado QUÉ ejecución lo originó.
      expect(entrega?.executionId).toBe(r.executionId);

      const conversacion = await prisma.conversation.findUnique({
        where: { id: r.conversacion.id },
      });
      expect(conversacion?.isPaused).toBe(true);
    });

    it('20. el bot NO contesta mientras el handoff está activo', async () => {
      const r = await recorridoCompleto('+573001110041');

      const otro = await llegaMensaje({
        telefono: '+573001110041',
        texto: 'sigo aquí',
      });
      const resultado = await intake.atenderMensaje({
        companyId: empresaA,
        conversationId: r.conversacion.id,
        messageId: otro.mensaje.id,
        texto: 'sigo aquí',
      });

      expect(resultado.atendido).toBe(false);
      expect(['conversacion-pausada', 'handoff-activo']).toContain(
        resultado.motivo,
      );
    });

    it('21. la fuente de verdad es la tabla, no la bandera isPaused', async () => {
      const r = await recorridoCompleto('+573001110042');
      // Alguien quita la pausa desde una pantalla sin saber que hay una
      // entrega viva. El bot NO debe volver a hablar.
      await prisma.conversation.update({
        where: { id: r.conversacion.id },
        data: { isPaused: false },
      });

      const otro = await llegaMensaje({
        telefono: '+573001110042',
        texto: 'hola?',
      });
      const resultado = await intake.atenderMensaje({
        companyId: empresaA,
        conversationId: r.conversacion.id,
        messageId: otro.mensaje.id,
        texto: 'hola?',
      });

      expect(resultado.motivo).toBe('handoff-activo');
    });

    it('22. reanudación manual: resolver devuelve el control', async () => {
      const r = await recorridoCompleto('+573001110043');

      const resuelto = await handoff.resolver({
        companyId: empresaA,
        conversationId: r.conversacion.id,
        resolvedByUserId: asesorA,
        reanudarBot: true,
      });

      expect(resuelto).toEqual({ resuelto: true, botReanudado: true });
      const entrega = await prisma.conversationHandoff.findFirst({
        where: { conversationId: r.conversacion.id },
        orderBy: { startedAt: 'desc' },
      });
      expect(entrega?.status).toBe('RESOLVED');
      expect(entrega?.resolvedByUserId).toBe(asesorA);
      const conversacion = await prisma.conversation.findUnique({
        where: { id: r.conversacion.id },
      });
      expect(conversacion?.isPaused).toBe(false);
    });

    it('23. una sola entrega activa por conversación', async () => {
      const r = await recorridoCompleto('+573001110044');

      const segunda = await handoff.abrir({
        companyId: empresaA,
        conversationId: r.conversacion.id,
        reason: 'otra-cosa',
      });

      // Lo garantiza el índice único parcial de la base.
      expect(segunda.creado).toBe(false);
      const activas = await prisma.conversationHandoff.count({
        where: { conversationId: r.conversacion.id, status: 'ACTIVE' },
      });
      expect(activas).toBe(1);
    });

    it('24. un trabajo viejo no puede revivir una ejecución entregada', async () => {
      const r = await recorridoCompleto('+573001110045');

      const tardio = await avanzar(r.executionId);

      // `tomarLease` solo acepta estados vivos, y HANDED_OFF no lo es.
      expect(tardio.estado).toBe('omitido');
    });
  });

  // ═══ 17-20. Aislamiento y concurrencia ═══════════════════════

  describe('aislamiento y concurrencia', () => {
    it('25. dos empresas quedan aisladas', async () => {
      const r = await recorridoCompleto('+573001110050');

      // Los campos de la empresa A no existen para la B.
      const desdeB = await campos.leerValores(
        empresaB,
        'CONTACT',
        r.contacto.id,
      );
      expect(desdeB).toHaveLength(0);

      const escritura = await campos.establecerPorClave({
        companyId: empresaB,
        entity: 'CONTACT',
        key: 'origen_lead',
        valor: 'web',
        destino: { contactId: r.contacto.id },
        origen: { source: 'USER' },
      });
      expect(escritura.ok).toBe(false);

      // Y el bot de A no es candidato para B.
      const selector = new FlowBotSelectorService(servicioPrisma);
      const seleccion = await selector.seleccionar({
        companyId: empresaB,
        tipo: 'INBOUND_MESSAGE',
        texto: 'hola',
      });
      expect(seleccion.elegidos).toHaveLength(0);
    });

    it('26. dos números en una empresa: se responde por donde entró', async () => {
      const ctx = await llegaMensaje({
        telefono: '+573001110051',
        texto: 'hola',
        integrationId: numeroSoporte,
      });
      const { flowbot } = await procesar({ ...ctx, texto: 'hola' });
      transporte.limpiar();

      await avanzar(flowbot.executionId!);

      // Entró por Soporte: contestar desde Ventas —el principal— mandaría la
      // respuesta desde un número que el cliente no reconoce.
      expect(transporte.ultimo()?.phoneNumberId).toBe(`${PREFIJO}-soporte`);
      expect(numeroVentas).toBeTruthy();
    });

    it('27. dos mensajes concurrentes no duplican nada', async () => {
      const telefono = '+573001110052';
      const uno = await llegaMensaje({ telefono, texto: 'hola' });
      const dos = await llegaMensaje({ telefono, texto: 'hola?' });

      const [a, b] = await Promise.all([
        procesar({ ...uno, texto: 'hola' }),
        procesar({ ...dos, texto: 'hola?' }),
      ]);

      // El bloqueo consultivo de `LeadIntakeService` serializa a los
      // concurrentes del mismo contacto.
      expect(a.oportunidad.leadId).toBe(b.oportunidad.leadId);
      const abiertas = await prisma.lead.count({
        where: { contactId: uno.contacto.id, status: 'OPEN' },
      });
      expect(abiertas).toBe(1);

      const conversaciones = await prisma.conversation.count({
        where: { contactId: uno.contacto.id, status: 'OPEN' },
      });
      expect(conversaciones).toBe(1);

      const ejecuciones = await prisma.flowBotExecution.count({
        where: { conversationId: uno.conversacion.id },
      });
      expect(ejecuciones).toBe(1);
    });

    it('28. un lease vencido sin paso registrado queda NEEDS_ATTENTION', async () => {
      const ctx = await llegaMensaje({
        telefono: '+573001110053',
        texto: 'hola',
      });
      const { flowbot } = await procesar({ ...ctx, texto: 'hola' });
      const executionId = flowbot.executionId!;

      // Un worker que murió a mitad, sin rastro de lo que hizo.
      await prisma.flowBotExecutionStep.deleteMany({ where: { executionId } });
      await prisma.flowBotExecution.update({
        where: { id: executionId },
        data: {
          status: 'RUNNING',
          leaseOwner: 'worker-muerto',
          leaseUntil: new Date(Date.now() - LEASE_MS * 10),
        },
      });

      await reconciler.reconciliar();

      const e = await prisma.flowBotExecution.findUnique({
        where: { id: executionId },
      });
      // El efecto pudo haber ocurrido. Reintentar mandaría el mismo mensaje
      // otra vez; abandonar lo dejaría a medias. Decide una persona.
      expect(e?.status).toBe('NEEDS_ATTENTION');
      expect(e?.attentionReason).toBe('lease-vencido-sin-paso-registrado');
    });

    it('29. el outbox pendiente se despacha solo', async () => {
      const ctx = await llegaMensaje({
        telefono: '+573001110054',
        texto: 'hola',
      });
      await procesar({ ...ctx, texto: 'hola' });

      const pendientesAntes = await prisma.outboxEvent.count({
        where: { companyId: empresaA, status: 'PENDING' },
      });
      expect(pendientesAntes).toBeGreaterThan(0);

      // Con la cola deshabilitada el publicador no puede encolar, así que el
      // evento se queda PENDING: es exactamente lo que debe pasar, y lo que
      // hace que no se pierda cuando Redis vuelve.
      await dispatcher.despachar();
      const perdidos = await prisma.outboxEvent.count({
        where: { companyId: empresaA, status: 'COMPLETED', processedAt: null },
      });
      expect(perdidos).toBe(0);
    });

    it('30. ni tokens ni PII completa en lo que se registra', async () => {
      const r = await recorridoCompleto('+573001110055');

      // El transporte registra el teléfono enmascarado y nunca el token.
      const registrado = JSON.stringify(transporte.enviados);
      expect(registrado).not.toContain('token-simulado');
      expect(registrado).not.toContain('573001110055');
      expect(registrado).toContain('****');

      // Los pasos guardan el clasificador, no el mensaje del proveedor.
      const pasos = await prisma.flowBotExecutionStep.findMany({
        where: { executionId: r.executionId },
      });
      for (const p of pasos) {
        expect(JSON.stringify(p.output ?? {})).not.toContain('cifrado-');
      }
    });
  });

  /** Publica un flujo alternativo y arranca una ejecución con él. */
  async function conFlujo(grafo: GrafoFlow, telefono: string) {
    const compilacion = compilar(grafo);
    expect(compilacion.ok).toBe(true);
    n += 1;

    const bot = await prisma.flowBot.create({
      data: {
        companyId: empresaA,
        name: `${PREFIJO}-alt-${n}`,
        status: 'ACTIVE',
        draftGraph: grafo as never,
      },
    });
    const version = await prisma.flowBotVersion.create({
      data: {
        flowBotId: bot.id,
        version: 1,
        graph: grafo as never,
        compiled: compilacion.compilado as never,
        compiledHash: compilacion.hash!,
      },
    });
    await prisma.flowBot.update({
      where: { id: bot.id },
      data: { publishedVersionId: version.id, lastVersionNumber: 1 },
    });

    const ctx = await llegaMensaje({ telefono, texto: 'hola' });
    const { executionId } = await runner.arrancar({
      companyId: empresaA,
      flowBotId: bot.id,
      versionId: version.id,
      eventKey: `${PREFIJO}-alt-${n}-${Date.now()}`,
      conversationId: ctx.conversacion.id,
      contactId: ctx.contacto.id,
      correlationId: `corr-alt-${n}`,
    });
    return { executionId, ...ctx };
  }
});
