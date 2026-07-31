import { InboundQueueService } from './inbound-queue.service';

const job = {
  companyId: 'company-a',
  conversationId: 'conv-1',
  messageId: 'wamid.abc',
  contactPhone: '+573001112233',
  body: 'hola',
};

describe('InboundQueueService', () => {
  let service: InboundQueueService;
  let cola: { add: jest.Mock; close: jest.Mock };

  beforeEach(() => {
    service = new InboundQueueService();
    cola = { add: jest.fn().mockResolvedValue({ id: 'j1' }), close: jest.fn() };
    // Se inyecta la cola ya construida para no abrir una conexión real.
    (service as unknown as { cola: unknown }).cola = cola;
  });

  describe('habilitación', () => {
    it('está habilitada por defecto', () => {
      expect(service.isEnabled({})).toBe(true);
    });

    it('QUEUE_ENABLED=false la deshabilita', () => {
      expect(service.isEnabled({ QUEUE_ENABLED: 'false' })).toBe(false);
    });
  });

  describe('encolado', () => {
    it('encola el trabajo con los datos del mensaje', async () => {
      const ok = await service.enqueueInboundMessage(job);

      expect(ok).toBe(true);
      expect(cola.add).toHaveBeenCalledTimes(1);
      expect(cola.add.mock.calls[0][1]).toEqual(job);
    });

    it('IDEMPOTENCIA: el jobId es el id del mensaje', async () => {
      await service.enqueueInboundMessage(job);

      // Un reintento de Meta que llegue a encolar dos veces produce UN solo
      // job: BullMQ descarta el duplicado por jobId. Es el mismo principio
      // que ya protege wamid en la persistencia.
      expect(cola.add.mock.calls[0][2]).toEqual({ jobId: 'wamid.abc' });
    });

    it('devuelve false SIN LANZAR cuando Redis falla', async () => {
      // Un fallo de Redis nunca debe hacer que un mensaje entrante se quede
      // sin procesar: el llamador ejecuta en línea.
      cola.add.mockRejectedValue(new Error('conexión rechazada'));

      await expect(service.enqueueInboundMessage(job)).resolves.toBe(false);
    });

    it('no expone la cadena de conexión ni PII al fallar', async () => {
      const warn = jest
        .spyOn(
          (service as unknown as { logger: { warn: (m: string) => void } })
            .logger,
          'warn',
        )
        .mockImplementation(() => undefined);
      cola.add.mockRejectedValue(
        new Error('AUTH failed redis://user:secreto@host para +573001112233'),
      );

      await service.enqueueInboundMessage(job);

      const registrado = JSON.stringify(warn.mock.calls);
      expect(registrado).not.toContain('secreto');
      expect(registrado).not.toContain('redis://');
      expect(registrado).not.toContain('+573001112233');
      warn.mockRestore();
    });
  });

  describe('cola deshabilitada', () => {
    it('no encola y devuelve false, para que el llamador ejecute en línea', async () => {
      const anterior = process.env.QUEUE_ENABLED;
      process.env.QUEUE_ENABLED = 'false';

      await expect(service.enqueueInboundMessage(job)).resolves.toBe(false);
      expect(cola.add).not.toHaveBeenCalled();

      process.env.QUEUE_ENABLED = anterior;
    });
  });

  describe('cierre', () => {
    it('cierra la cola al apagar la aplicación', async () => {
      await service.onApplicationShutdown();

      expect(cola.close).toHaveBeenCalledTimes(1);
    });

    it('cerrar dos veces no falla', async () => {
      await service.onApplicationShutdown();

      await expect(service.onApplicationShutdown()).resolves.toBeUndefined();
      expect(cola.close).toHaveBeenCalledTimes(1);
    });
  });
});
