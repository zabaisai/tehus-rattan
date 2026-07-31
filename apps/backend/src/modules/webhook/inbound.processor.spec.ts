import { InboundProcessor } from './inbound.processor';

// El Worker de BullMQ se simula: estas pruebas cubren el reparto de roles y el
// handler, no la conectividad real con Redis.
const workerInstances: Array<{
  close: jest.Mock;
  on: jest.Mock;
  handler: (job: unknown) => Promise<void>;
  opciones: Record<string, unknown>;
}> = [];

jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation((_cola, handler, opciones) => {
    const instancia = {
      close: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      handler,
      opciones,
    };
    workerInstances.push(instancia);
    return instancia;
  }),
}));

const job = (over: Partial<Record<string, unknown>> = {}) => ({
  data: {
    companyId: 'company-a',
    conversationId: 'conv-1',
    messageId: 'wamid.abc',
    contactPhone: '+573001112233',
    body: 'hola',
    ...over,
  },
  attemptsMade: 1,
});

describe('InboundProcessor', () => {
  let webhookService: { runInboundEffects: jest.Mock };
  let prisma: { conversation: { findFirst: jest.Mock } };
  let processor: InboundProcessor;
  let envAnterior: string | undefined;

  beforeEach(() => {
    workerInstances.length = 0;
    jest.clearAllMocks();
    envAnterior = process.env.WORKER_ROLE;

    webhookService = {
      runInboundEffects: jest.fn().mockResolvedValue(undefined),
    };
    prisma = {
      conversation: {
        findFirst: jest.fn().mockResolvedValue({ assignedTo: 'user-1' }),
      },
    };
    processor = new InboundProcessor(webhookService as never, prisma as never);
  });

  afterEach(() => {
    process.env.WORKER_ROLE = envAnterior;
    if (envAnterior === undefined) delete process.env.WORKER_ROLE;
  });

  describe('quién consume', () => {
    it('el BACKEND no crea ningún Worker', () => {
      delete process.env.WORKER_ROLE;

      processor.onModuleInit();

      // Si el backend también consumiera, cada job correría dos veces.
      expect(workerInstances).toHaveLength(0);
    });

    it('el WORKER sí crea el Worker', () => {
      process.env.WORKER_ROLE = 'queue';

      processor.onModuleInit();

      expect(workerInstances).toHaveLength(1);
    });

    it('con la cola deshabilitada nadie consume, ni el worker', () => {
      process.env.WORKER_ROLE = 'queue';
      const anterior = process.env.QUEUE_ENABLED;
      process.env.QUEUE_ENABLED = 'false';

      processor.onModuleInit();

      expect(workerInstances).toHaveLength(0);
      process.env.QUEUE_ENABLED = anterior;
      if (anterior === undefined) delete process.env.QUEUE_ENABLED;
    });

    it('acota la concurrencia: el cuello de botella es Meta, no la CPU', () => {
      process.env.WORKER_ROLE = 'queue';

      processor.onModuleInit();

      expect(workerInstances[0].opciones.concurrency).toBe(5);
    });
  });

  describe('procesamiento del job', () => {
    beforeEach(() => {
      process.env.WORKER_ROLE = 'queue';
      processor.onModuleInit();
    });

    it('ejecuta los efectos con los datos del job', async () => {
      await workerInstances[0].handler(job());

      expect(webhookService.runInboundEffects).toHaveBeenCalledWith(
        'company-a',
        'conv-1',
        'hola',
        '+573001112233',
        'user-1',
        // El id del mensaje viaja como llave de idempotencia: sin el, un
        // reintento del job volveria a ejecutar las automatizaciones y el
        // cliente recibiria el mismo WhatsApp dos veces.
        'wamid.abc',
      );
    });

    it('resuelve assignedTo EN EL MOMENTO de procesar, no lo toma del job', async () => {
      // Entre el encolado y el procesado un asesor pudo tomar la
      // conversación; notificar al anterior sería avisar a quien no toca.
      prisma.conversation.findFirst.mockResolvedValue({
        assignedTo: 'user-nuevo',
      });

      await workerInstances[0].handler(job({ assignedTo: 'user-viejo' }));

      expect(webhookService.runInboundEffects.mock.calls[0][4]).toBe(
        'user-nuevo',
      );
    });

    it('lee la conversación ACOTADA por companyId', async () => {
      await workerInstances[0].handler(job());

      // Aunque el job venga de nuestra propia cola, no se confía en su
      // contenido para saltarse el aislamiento multiempresa.
      expect(prisma.conversation.findFirst).toHaveBeenCalledWith({
        where: { id: 'conv-1', companyId: 'company-a' },
        select: { assignedTo: true },
      });
    });

    it('pasa null cuando la conversación no tiene asesor', async () => {
      prisma.conversation.findFirst.mockResolvedValue({ assignedTo: null });

      await workerInstances[0].handler(job());

      expect(webhookService.runInboundEffects.mock.calls[0][4]).toBeNull();
    });

    it('descarta el job si la conversación ya no existe, sin reintentar', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null);

      await expect(workerInstances[0].handler(job())).resolves.toBeUndefined();

      // Reintentar no la va a devolver: no es un fallo recuperable.
      expect(webhookService.runInboundEffects).not.toHaveBeenCalled();
    });

    it('propaga el fallo de los efectos para que BullMQ reintente', async () => {
      webhookService.runInboundEffects.mockRejectedValue(
        new Error('Meta caido'),
      );

      await expect(workerInstances[0].handler(job())).rejects.toThrow();
    });
  });

  describe('apagado', () => {
    it('cierra el worker para drenar los jobs en vuelo', async () => {
      process.env.WORKER_ROLE = 'queue';
      processor.onModuleInit();

      await processor.onApplicationShutdown();

      // Matarlo a mitad haría que el job se reintentara y duplicara efectos.
      expect(workerInstances[0].close).toHaveBeenCalledTimes(1);
    });

    it('apagar sin worker no falla', async () => {
      delete process.env.WORKER_ROLE;
      processor.onModuleInit();

      await expect(processor.onApplicationShutdown()).resolves.toBeUndefined();
    });

    it('cerrar dos veces no vuelve a cerrar', async () => {
      process.env.WORKER_ROLE = 'queue';
      processor.onModuleInit();

      await processor.onApplicationShutdown();
      await processor.onApplicationShutdown();

      expect(workerInstances[0].close).toHaveBeenCalledTimes(1);
    });
  });
});
