import { OutboxDispatcher } from './outbox.dispatcher';
import { OUTBOX_TYPES } from './outbox.service';

const evento = (over: Record<string, unknown> = {}) => ({
  id: 'evt-1',
  type: OUTBOX_TYPES.INBOUND_MESSAGE,
  companyId: 'company-a',
  idempotencyKey: 'wamid.1',
  attempts: 0,
  payload: {
    companyId: 'company-a',
    conversationId: 'conv-1',
    messageId: 'msg-1',
    contactPhone: '+573001112233',
    body: 'hola',
  },
  ...over,
});

describe('OutboxDispatcher', () => {
  let outbox: any;
  let inboundQueue: any;
  let dispatcher: OutboxDispatcher;
  let envAnterior: string | undefined;

  beforeEach(() => {
    envAnterior = process.env.QUEUE_ENABLED;
    delete process.env.QUEUE_ENABLED;

    outbox = {
      claimBatch: jest.fn().mockResolvedValue([]),
      markCompleted: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    inboundQueue = {
      enqueueInboundMessage: jest.fn().mockResolvedValue(true),
    };
    dispatcher = new OutboxDispatcher(outbox, inboundQueue);
  });

  afterEach(() => {
    process.env.QUEUE_ENABLED = envAnterior;
    if (envAnterior === undefined) delete process.env.QUEUE_ENABLED;
  });

  describe('camino feliz', () => {
    it('empuja el evento a la cola y lo marca completado', async () => {
      outbox.claimBatch.mockResolvedValue([evento()]);

      await dispatcher.despachar();

      expect(inboundQueue.enqueueInboundMessage).toHaveBeenCalledWith(
        evento().payload,
      );
      expect(outbox.markCompleted).toHaveBeenCalledWith('evt-1');
      expect(outbox.markFailed).not.toHaveBeenCalled();
    });

    it('procesa varios eventos del lote', async () => {
      outbox.claimBatch.mockResolvedValue([
        evento({ id: 'a' }),
        evento({ id: 'b' }),
      ]);

      await dispatcher.despachar();

      expect(outbox.markCompleted).toHaveBeenCalledTimes(2);
    });

    it('un lote vacío no hace nada', async () => {
      await dispatcher.despachar();

      expect(inboundQueue.enqueueInboundMessage).not.toHaveBeenCalled();
    });
  });

  describe('Redis caído y recuperación posterior', () => {
    it('si no puede encolar NO ejecuta en línea: reprograma el evento', async () => {
      outbox.claimBatch.mockResolvedValue([evento()]);
      inboundQueue.enqueueInboundMessage.mockResolvedValue(false);

      await dispatcher.despachar();

      // Un solo camino de ejecución. Ejecutar aquí duplicaría efectos si el
      // enqueue sí había llegado a Redis antes de fallar la respuesta.
      expect(outbox.markFailed).toHaveBeenCalledTimes(1);
      expect(outbox.markCompleted).not.toHaveBeenCalled();
    });

    it('el evento reprogramado se reintenta en el siguiente pase', async () => {
      // Primer pase: Redis caído.
      outbox.claimBatch.mockResolvedValue([evento()]);
      inboundQueue.enqueueInboundMessage.mockResolvedValue(false);
      await dispatcher.despachar();

      // Segundo pase: Redis recuperado. El evento sigue disponible porque
      // markFailed lo devolvió a PENDING.
      outbox.claimBatch.mockResolvedValue([evento({ attempts: 1 })]);
      inboundQueue.enqueueInboundMessage.mockResolvedValue(true);
      await dispatcher.despachar();

      expect(outbox.markCompleted).toHaveBeenCalledWith('evt-1');
    });

    it('pasa los intentos acumulados para que el backoff crezca', async () => {
      outbox.claimBatch.mockResolvedValue([evento({ attempts: 3 })]);
      inboundQueue.enqueueInboundMessage.mockResolvedValue(false);

      await dispatcher.despachar();

      expect(outbox.markFailed.mock.calls[0][1]).toBe(3);
    });

    it('un fallo al reclamar el lote no tumba el proceso', async () => {
      outbox.claimBatch.mockRejectedValue(new Error('base inaccesible'));

      // Los eventos siguen en la base; el siguiente pase los recogerá.
      await expect(dispatcher.despachar()).resolves.toBeUndefined();
    });

    it('un evento que falla no impide procesar los demás', async () => {
      outbox.claimBatch.mockResolvedValue([
        evento({ id: 'a' }),
        evento({ id: 'b' }),
      ]);
      inboundQueue.enqueueInboundMessage
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      await dispatcher.despachar();

      expect(outbox.markFailed).toHaveBeenCalledTimes(1);
      expect(outbox.markCompleted).toHaveBeenCalledWith('b');
    });
  });

  describe('tipos desconocidos', () => {
    it('un tipo que nadie sabe manejar se marca fallido, no gira eternamente', async () => {
      outbox.claimBatch.mockResolvedValue([evento({ type: 'inventado' })]);

      await dispatcher.despachar();

      expect(outbox.markFailed).toHaveBeenCalledTimes(1);
      expect(inboundQueue.enqueueInboundMessage).not.toHaveBeenCalled();
    });
  });

  describe('control de solapamiento y apagado', () => {
    it('no reclama lotes con la cola deshabilitada', async () => {
      process.env.QUEUE_ENABLED = 'false';

      await dispatcher.despachar();

      expect(outbox.claimBatch).not.toHaveBeenCalled();
    });

    it('tras el apagado deja de reclamar', async () => {
      dispatcher.onApplicationShutdown();

      await dispatcher.despachar();

      expect(outbox.claimBatch).not.toHaveBeenCalled();
    });

    it('dos pases simultáneos no se solapan', async () => {
      let resolver: (v: unknown) => void = () => undefined;
      outbox.claimBatch.mockImplementation(
        () => new Promise((r) => (resolver = r)),
      );

      const primero = dispatcher.despachar();
      const segundo = dispatcher.despachar(); // debe salir de inmediato

      await segundo;
      expect(outbox.claimBatch).toHaveBeenCalledTimes(1);

      resolver([]);
      await primero;
    });
  });
});
