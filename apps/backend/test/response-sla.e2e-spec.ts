import { PrismaService } from '../src/prisma/prisma.service';
import { ResponseSlaService } from '../src/modules/conversations/response-sla.service';

/**
 * SLA de primera respuesta contra base REAL.
 *
 * La deteccion es una consulta con LATERAL que cruza el ultimo mensaje de
 * cada conversacion con el umbral de su empresa. Un doble de Prisma no
 * ejecuta esa consulta, asi que probarla con mocks solo comprobaria que llamo
 * a lo que yo mismo escribi.
 */
describe('SLA de primera respuesta (e2e, base real)', () => {
  let prisma: PrismaService;
  let sla: ResponseSlaService;
  const notifications = {
    emit: jest.fn().mockResolvedValue(undefined),
    emitToCompanyRoles: jest.fn().mockResolvedValue(undefined),
  };

  let empresaConSla: string;
  let empresaSinSla: string;
  let asesorId: string;

  const hace = (minutos: number) => new Date(Date.now() - minutos * 60_000);

  const conversacionCon = async (opciones: {
    companyId: string;
    ultimoEntranteHaceMin?: number;
    ultimoSalienteHaceMin?: number;
    status?: string;
    isPaused?: boolean;
    assignedTo?: string | null;
  }) => {
    const contacto = await prisma.contact.create({
      data: {
        companyId: opciones.companyId,
        phone: `+1777${Math.random().toString().slice(2, 9)}`,
        name: 'Contacto SLA',
      },
    });
    const conv = await prisma.conversation.create({
      data: {
        companyId: opciones.companyId,
        contactId: contacto.id,
        status: (opciones.status ?? 'OPEN') as never,
        isPaused: opciones.isPaused ?? false,
        assignedTo: opciones.assignedTo ?? null,
      },
    });

    if (opciones.ultimoEntranteHaceMin !== undefined) {
      await prisma.message.create({
        data: {
          conversationId: conv.id,
          body: 'hola',
          direction: 'INBOUND',
          createdAt: hace(opciones.ultimoEntranteHaceMin),
        },
      });
    }
    if (opciones.ultimoSalienteHaceMin !== undefined) {
      await prisma.message.create({
        data: {
          conversationId: conv.id,
          body: 'respuesta',
          direction: 'OUTBOUND',
          createdAt: hace(opciones.ultimoSalienteHaceMin),
        },
      });
    }
    return conv.id;
  };

  const colaOriginal = process.env.QUEUE_ENABLED;

  beforeAll(async () => {
    // `revisar()` solo actua en el proceso que ejecuta los trabajos
    // programados. Se declara aqui explicitamente en vez de depender de como
    // se invoque la suite: una prueba que pasa o falla segun el entorno del
    // que la lanza no prueba nada.
    process.env.QUEUE_ENABLED = 'false';

    prisma = new PrismaService();
    await prisma.$connect();
    sla = new ResponseSlaService(prisma, notifications as never);

    const conSla = await prisma.company.create({
      data: { name: 'E2E SLA Con', responseSlaMinutes: 30 },
    });
    empresaConSla = conSla.id;
    const sinSla = await prisma.company.create({
      data: { name: 'E2E SLA Sin' },
    });
    empresaSinSla = sinSla.id;

    const asesor = await prisma.user.create({
      data: {
        companyId: empresaConSla,
        email: `sla-${Date.now()}@example.test`,
        password: 'x',
        name: 'Asesor SLA',
        role: 'AGENT',
      },
    });
    asesorId = asesor.id;
  });

  afterAll(async () => {
    for (const id of [empresaConSla, empresaSinSla]) {
      await prisma.message.deleteMany({
        where: { conversation: { companyId: id } },
      });
      await prisma.conversation.deleteMany({ where: { companyId: id } });
      await prisma.contact.deleteMany({ where: { companyId: id } });
      await prisma.user.deleteMany({ where: { companyId: id } });
      await prisma.company.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();

    if (colaOriginal === undefined) delete process.env.QUEUE_ENABLED;
    else process.env.QUEUE_ENABLED = colaOriginal;
  });

  beforeEach(() => {
    notifications.emit.mockClear();
    notifications.emitToCompanyRoles.mockClear();
  });

  const detectados = async () => (await sla.detectar()).map((c) => c.conversationId);

  describe('qué cuenta como incumplido', () => {
    it('un entrante sin responder por encima del umbral', async () => {
      const conv = await conversacionCon({
        companyId: empresaConSla,
        ultimoEntranteHaceMin: 45,
      });

      expect(await detectados()).toContain(conv);
    });

    it('dentro del umbral todavía no cuenta', async () => {
      const conv = await conversacionCon({
        companyId: empresaConSla,
        ultimoEntranteHaceMin: 5,
      });

      expect(await detectados()).not.toContain(conv);
    });

    it('si ya se respondió NO cuenta, aunque el entrante sea viejo', async () => {
      const conv = await conversacionCon({
        companyId: empresaConSla,
        ultimoEntranteHaceMin: 90,
        ultimoSalienteHaceMin: 10,
      });

      expect(await detectados()).not.toContain(conv);
    });

    it('un mensaje NUEVO tras haber respondido vuelve a contar', async () => {
      // Mirar solo el primer mensaje daría la conversación por atendida para
      // siempre: quien escribe otra vez está esperando otra vez.
      const conv = await conversacionCon({
        companyId: empresaConSla,
        ultimoEntranteHaceMin: 120,
        ultimoSalienteHaceMin: 90,
      });
      await prisma.message.create({
        data: {
          conversationId: conv,
          body: 'sigo esperando',
          direction: 'INBOUND',
          createdAt: hace(60),
        },
      });

      expect(await detectados()).toContain(conv);
    });

    it('una conversación sin mensajes no cuenta', async () => {
      const conv = await conversacionCon({ companyId: empresaConSla });

      expect(await detectados()).not.toContain(conv);
    });
  });

  describe('qué queda fuera a propósito', () => {
    it('una empresa SIN SLA configurado no genera incumplimientos', async () => {
      // `null` es "sin compromiso definido", que no es lo mismo que cero: si
      // no, estrenar el CRM llenaría la campana de alarmas.
      const conv = await conversacionCon({
        companyId: empresaSinSla,
        ultimoEntranteHaceMin: 600,
      });

      expect(await detectados()).not.toContain(conv);
    });

    it.each([['RESOLVED'], ['CLOSED'], ['ARCHIVED']])(
      'una conversación %s no cuenta',
      async (status) => {
        const conv = await conversacionCon({
          companyId: empresaConSla,
          ultimoEntranteHaceMin: 120,
          status,
        });

        expect(await detectados()).not.toContain(conv);
      },
    );

    it('una conversación PAUSADA no cuenta', async () => {
      // Está en manos del chatbot o del cliente a propósito; contarla sería
      // castigar una decisión deliberada del equipo.
      const conv = await conversacionCon({
        companyId: empresaConSla,
        ultimoEntranteHaceMin: 120,
        isPaused: true,
      });

      expect(await detectados()).not.toContain(conv);
    });
  });

  describe('a quién se avisa', () => {
    it('al responsable, si lo hay', async () => {
      await conversacionCon({
        companyId: empresaConSla,
        ultimoEntranteHaceMin: 60,
        assignedTo: asesorId,
      });

      await sla.revisar();

      expect(notifications.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SLA_RESPONSE_BREACHED',
          recipientUserId: asesorId,
        }),
      );
    });

    it('a los administradores si no hay nadie asignado', async () => {
      // Es la que más urge: nadie tiene a quién reclamarle.
      await conversacionCon({
        companyId: empresaConSla,
        ultimoEntranteHaceMin: 60,
        assignedTo: null,
      });

      await sla.revisar();

      expect(notifications.emitToCompanyRoles).toHaveBeenCalledWith(
        empresaConSla,
        ['ADMIN'],
        expect.objectContaining({ type: 'SLA_RESPONSE_BREACHED' }),
      );
    });

    it('el aviso NO lleva el teléfono ni el contenido del mensaje', async () => {
      await conversacionCon({
        companyId: empresaConSla,
        ultimoEntranteHaceMin: 60,
        assignedTo: asesorId,
      });

      await sla.revisar();

      const enviado = JSON.stringify([
        ...notifications.emit.mock.calls,
        ...notifications.emitToCompanyRoles.mock.calls,
      ]);
      expect(enviado).not.toMatch(/\+1777\d+/);
      expect(enviado).not.toContain('hola');
    });

    it('se deduplica por hora: si no, avisaría cada cinco minutos', async () => {
      await conversacionCon({
        companyId: empresaConSla,
        ultimoEntranteHaceMin: 60,
        assignedTo: asesorId,
      });

      await sla.revisar();
      const clave = notifications.emit.mock.calls.at(-1)?.[0]?.dedupeKey;

      expect(clave).toMatch(/^SLA_RESPONSE:/);
      expect(clave.split(':').length).toBe(3);
    });
  });

  describe('robustez', () => {
    it('el orden es el cliente que lleva más esperando', async () => {
      const resultados = await sla.detectar();
      const esperas = resultados.map((r) => r.esperaMinutos);

      expect([...esperas].sort((a, b) => b - a)).toEqual(esperas);
    });

    it('la pasada acota cuántas revisa', async () => {
      const resultados = await sla.detectar();

      expect(resultados.length).toBeLessThanOrEqual(200);
    });

    it('un fallo al revisar no lanza: es un trabajo de fondo', async () => {
      const roto = new ResponseSlaService(
        { $queryRaw: () => Promise.reject(new Error('caida')) } as never,
        notifications as never,
      );

      await expect(roto.revisar()).resolves.toBe(0);
    });
  });
});
