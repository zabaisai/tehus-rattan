import { OutboxHandlerRegistry } from '../../../common/outbox/outbox.handlers';
import { PrismaService } from '../../../prisma/prisma.service';
import { FlowBotQueueService } from './flowbot.queue';
import { FlowBotOutboxPublisher } from './flowbot.outbox';
import { OUTBOX_FLOWBOT } from './flowbot.runner';

/**
 * Estas pruebas cubren el eslabón que hace que el motor se mueva solo: pasar de
 * un evento persistido a un trabajo de cola.
 *
 * Lo que más importa comprobar no es que publique —eso es lo fácil— sino que
 * DISTINGA "no pude publicar" de "no había que publicar". Confundirlos deja
 * eventos girando hasta agotar intentos, o peor, encola despertares para
 * ejecuciones que alguien ya canceló.
 */
describe('FlowBotOutboxPublisher', () => {
  let registro: OutboxHandlerRegistry;
  let prisma: {
    flowBotExecution: { findFirst: jest.Mock };
    flowBotWait: { findFirst: jest.Mock };
  };
  let cola: {
    encolarAvance: jest.Mock;
    encolarDespertar: jest.Mock;
  };
  let publisher: FlowBotOutboxPublisher;

  /** Dispara el manejador registrado para un tipo, como haría el despachador. */
  const despachar = (type: string, payload: unknown, companyId = 'emp-1') => {
    const manejador = registro.obtener(type);
    if (!manejador) throw new Error(`Sin manejador para ${type}`);
    return manejador({ id: 'evt-1', type, companyId, payload, attempts: 0 });
  };

  beforeEach(() => {
    registro = new OutboxHandlerRegistry();
    prisma = {
      flowBotExecution: { findFirst: jest.fn() },
      flowBotWait: { findFirst: jest.fn() },
    };
    cola = {
      encolarAvance: jest.fn().mockResolvedValue(true),
      encolarDespertar: jest.fn().mockResolvedValue(true),
    };

    publisher = new FlowBotOutboxPublisher(
      registro,
      prisma as unknown as PrismaService,
      cola as unknown as FlowBotQueueService,
    );
    publisher.onModuleInit();
  });

  describe('registro', () => {
    it('declara los dos tipos que sabe publicar', () => {
      expect(registro.tiposRegistrados()).toEqual([
        OUTBOX_FLOWBOT.AVANZAR,
        OUTBOX_FLOWBOT.DESPERTAR,
      ]);
    });
  });

  describe('flowbot.advance', () => {
    const ejecucionViva = {
      id: 'exec-1',
      companyId: 'emp-1',
      correlationId: 'corr-1',
      steps: 3,
      status: 'RUNNING',
    };

    it('encola el avance con el paso del payload', async () => {
      prisma.flowBotExecution.findFirst.mockResolvedValue(ejecucionViva);

      const ok = await despachar(OUTBOX_FLOWBOT.AVANZAR, {
        executionId: 'exec-1',
        paso: 3,
        correlationId: 'corr-1',
      });

      expect(ok).toBe(true);
      expect(cola.encolarAvance).toHaveBeenCalledWith(
        {
          tipo: 'avanzar',
          companyId: 'emp-1',
          executionId: 'exec-1',
          correlationId: 'corr-1',
        },
        3,
      );
    });

    it('acota la relectura por el companyId del EVENTO, no el del payload', async () => {
      // Un payload que dice ser de otra empresa no puede sacar la ejecución de
      // su aislamiento: el `companyId` de confianza es el que escribió el
      // outbox junto a la transición.
      prisma.flowBotExecution.findFirst.mockResolvedValue(null);

      await despachar(
        OUTBOX_FLOWBOT.AVANZAR,
        { executionId: 'exec-1', companyId: 'emp-INTRUSA', paso: 0 },
        'emp-1',
      );

      expect(prisma.flowBotExecution.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'exec-1', companyId: 'emp-1' },
        }),
      );
    });

    it('devuelve false cuando la cola no acepta, para que se reintente', async () => {
      prisma.flowBotExecution.findFirst.mockResolvedValue(ejecucionViva);
      cola.encolarAvance.mockResolvedValue(false);

      const ok = await despachar(OUTBOX_FLOWBOT.AVANZAR, {
        executionId: 'exec-1',
        paso: 3,
      });

      // El despachador lo verá como fallo y dejará el evento PENDING. Es la
      // diferencia entre perder el trabajo y retrasarlo.
      expect(ok).toBe(false);
      expect(publisher.estado().publicados).toBe(0);
    });

    it.each(['COMPLETED', 'CANCELLED', 'FAILED', 'HANDED_OFF', 'PAUSED'])(
      'no encola nada si la ejecución está en %s, y lo da por despachado',
      async (status) => {
        prisma.flowBotExecution.findFirst.mockResolvedValue({
          ...ejecucionViva,
          status,
        });

        const ok = await despachar(OUTBOX_FLOWBOT.AVANZAR, {
          executionId: 'exec-1',
          paso: 3,
        });

        // `true` a propósito: no hubo fallo de publicación. Devolver `false`
        // haría girar el evento hasta quedar FAILED por funcionar bien.
        expect(ok).toBe(true);
        expect(cola.encolarAvance).not.toHaveBeenCalled();
      },
    );

    it('descarta si la ejecución ya no existe', async () => {
      prisma.flowBotExecution.findFirst.mockResolvedValue(null);

      const ok = await despachar(OUTBOX_FLOWBOT.AVANZAR, {
        executionId: 'exec-fantasma',
        paso: 0,
      });

      expect(ok).toBe(true);
      expect(cola.encolarAvance).not.toHaveBeenCalled();
      expect(publisher.estado().descartados).toBe(1);
    });

    it('descarta un payload sin executionId sin tocar la base', async () => {
      const ok = await despachar(OUTBOX_FLOWBOT.AVANZAR, { paso: 0 });

      expect(ok).toBe(true);
      expect(prisma.flowBotExecution.findFirst).not.toHaveBeenCalled();
    });

    it('cae a los pasos de la ejecución si el payload no los trae', async () => {
      prisma.flowBotExecution.findFirst.mockResolvedValue(ejecucionViva);

      await despachar(OUTBOX_FLOWBOT.AVANZAR, { executionId: 'exec-1' });

      expect(cola.encolarAvance).toHaveBeenCalledWith(expect.anything(), 3);
    });
  });

  describe('flowbot.wake', () => {
    const wakeAt = new Date('2026-01-01T10:00:00.000Z');
    const esperaViva = {
      id: 'wait-1',
      wakeAt,
      companyId: 'emp-1',
      execution: { id: 'exec-1', status: 'WAITING_TIME', correlationId: 'c-1' },
    };

    it('programa el despertar con el wakeAt persistido', async () => {
      prisma.flowBotWait.findFirst.mockResolvedValue(esperaViva);

      const ok = await despachar(OUTBOX_FLOWBOT.DESPERTAR, {
        waitId: 'wait-1',
        executionId: 'exec-1',
      });

      expect(ok).toBe(true);
      expect(cola.encolarDespertar).toHaveBeenCalledWith(
        {
          tipo: 'despertar',
          companyId: 'emp-1',
          executionId: 'exec-1',
          waitId: 'wait-1',
          correlationId: 'c-1',
        },
        wakeAt,
      );
    });

    it('busca solo esperas sin consumir', async () => {
      prisma.flowBotWait.findFirst.mockResolvedValue(null);

      await despachar(OUTBOX_FLOWBOT.DESPERTAR, { waitId: 'wait-1' });

      expect(prisma.flowBotWait.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'wait-1', companyId: 'emp-1', consumedAt: null },
        }),
      );
    });

    it('no encola si la espera ya se consumió', async () => {
      // El cliente contestó antes de que venciera. Encolar el despertar
      // dispararía después un timeout que ya no corresponde.
      prisma.flowBotWait.findFirst.mockResolvedValue(null);

      const ok = await despachar(OUTBOX_FLOWBOT.DESPERTAR, {
        waitId: 'wait-1',
      });

      expect(ok).toBe(true);
      expect(cola.encolarDespertar).not.toHaveBeenCalled();
    });

    it('no encola si la ejecución de la espera ya terminó', async () => {
      prisma.flowBotWait.findFirst.mockResolvedValue({
        ...esperaViva,
        execution: { ...esperaViva.execution, status: 'CANCELLED' },
      });

      const ok = await despachar(OUTBOX_FLOWBOT.DESPERTAR, {
        waitId: 'wait-1',
      });

      expect(ok).toBe(true);
      expect(cola.encolarDespertar).not.toHaveBeenCalled();
    });

    it('no encola una espera sin vencimiento', async () => {
      // Una espera de entrada sin plazo no se despierta por tiempo: la reanuda
      // el mensaje del cliente.
      prisma.flowBotWait.findFirst.mockResolvedValue({
        ...esperaViva,
        wakeAt: null,
      });

      const ok = await despachar(OUTBOX_FLOWBOT.DESPERTAR, {
        waitId: 'wait-1',
      });

      expect(ok).toBe(true);
      expect(cola.encolarDespertar).not.toHaveBeenCalled();
    });

    it('devuelve false si la cola no acepta el despertar', async () => {
      prisma.flowBotWait.findFirst.mockResolvedValue(esperaViva);
      cola.encolarDespertar.mockResolvedValue(false);

      const ok = await despachar(OUTBOX_FLOWBOT.DESPERTAR, {
        waitId: 'wait-1',
      });

      expect(ok).toBe(false);
    });

    it('descarta un payload sin waitId sin tocar la base', async () => {
      const ok = await despachar(OUTBOX_FLOWBOT.DESPERTAR, {
        executionId: 'exec-1',
      });

      expect(ok).toBe(true);
      expect(prisma.flowBotWait.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('estado para el health', () => {
    it('cuenta publicados y descartados por separado', async () => {
      prisma.flowBotExecution.findFirst
        .mockResolvedValueOnce({
          id: 'exec-1',
          companyId: 'emp-1',
          correlationId: 'c',
          steps: 0,
          status: 'RUNNING',
        })
        .mockResolvedValueOnce(null);

      await despachar(OUTBOX_FLOWBOT.AVANZAR, {
        executionId: 'exec-1',
        paso: 0,
      });
      await despachar(OUTBOX_FLOWBOT.AVANZAR, {
        executionId: 'exec-2',
        paso: 0,
      });

      const estado = publisher.estado();
      expect(estado.publicados).toBe(1);
      expect(estado.descartados).toBe(1);
      expect(estado.ultimoDespacho).not.toBeNull();
    });

    it('empieza sin despachos', () => {
      expect(publisher.estado()).toEqual({
        publicados: 0,
        descartados: 0,
        ultimoDespacho: null,
      });
    });
  });
});
