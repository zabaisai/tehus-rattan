import { Prisma } from '@prisma/client';
import {
  OutboxService,
  OUTBOX_MAX_ATTEMPTS,
  OUTBOX_TYPES,
  POLITICA_POR_DEFECTO,
  politicaDe,
} from './outbox.service';

const duplicado = () =>
  new Prisma.PrismaClientKnownRequestError('unique', {
    code: 'P2002',
    clientVersion: '6',
  });

describe('OutboxService', () => {
  let prisma: any;
  let service: OutboxService;

  beforeEach(() => {
    prisma = {
      outboxEvent: {
        create: jest.fn().mockResolvedValue({ id: 'evt-1' }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    service = new OutboxService(prisma);
  });

  describe('record — atomicidad e idempotencia', () => {
    it('escribe usando el writer que le pasan (la transacción del llamador)', async () => {
      const tx = { outboxEvent: { create: jest.fn().mockResolvedValue({}) } };

      await service.record(tx as never, {
        type: OUTBOX_TYPES.INBOUND_MESSAGE,
        companyId: 'company-a',
        idempotencyKey: 'wamid.1',
        payload: { a: 1 },
      });

      // Escribe en el `tx`, NO en el prisma global: es lo que hace que el
      // evento y el cambio esencial compartan transacción.
      expect(tx.outboxEvent.create).toHaveBeenCalledTimes(1);
      expect(prisma.outboxEvent.create).not.toHaveBeenCalled();
    });

    it('devuelve true al registrar un evento nuevo', async () => {
      await expect(
        service.record(prisma, {
          type: 't',
          companyId: 'c',
          idempotencyKey: 'k',
          payload: {},
        }),
      ).resolves.toBe(true);
    });

    it('un duplicado devuelve false SIN lanzar', async () => {
      // Un reintento de Meta es un caso normal, no una anomalía. Hacer fallar
      // la transacción entera por él haría perder el mensaje que sí queríamos.
      prisma.outboxEvent.create.mockRejectedValue(duplicado());

      await expect(
        service.record(prisma, {
          type: 't',
          companyId: 'c',
          idempotencyKey: 'repetida',
          payload: {},
        }),
      ).resolves.toBe(false);
    });

    it('un error que NO es duplicado sí se propaga', async () => {
      // Si la base falla de verdad, la transacción debe revertirse: preferimos
      // que Meta reintente a guardar un mensaje sin sus efectos.
      prisma.outboxEvent.create.mockRejectedValue(new Error('disco lleno'));

      await expect(
        service.record(prisma, {
          type: 't',
          companyId: 'c',
          idempotencyKey: 'k',
          payload: {},
        }),
      ).rejects.toThrow();
    });
  });

  describe('claimBatch — concurrencia segura y recuperación', () => {
    it('usa FOR UPDATE SKIP LOCKED', async () => {
      await service.claimBatch();

      const sql = prisma.$queryRaw.mock.calls[0][0].join('?');
      // Sin esto, dos dispatchers leerían el mismo lote y los efectos se
      // duplicarían.
      expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    });

    it('marca lo reclamado como PROCESSING', async () => {
      await service.claimBatch();

      const sql = prisma.$queryRaw.mock.calls[0][0].join('?');
      expect(sql).toContain("'PROCESSING'");
    });

    it('recupera los PROCESSING colgados de un proceso que murió', async () => {
      await service.claimBatch();

      const sql = prisma.$queryRaw.mock.calls[0][0].join('?');
      // Es lo que hace que un reinicio no pierda trabajo: los eventos que
      // alguien reclamó y no terminó vuelven a estar disponibles.
      expect(sql).toContain('"claimedAt" <');
    });

    it('solo toma los que ya están disponibles (respeta el backoff)', async () => {
      await service.claimBatch();

      const sql = prisma.$queryRaw.mock.calls[0][0].join('?');
      expect(sql).toContain('"availableAt" <= now()');
    });
  });

  describe('markFailed — backoff persistido y sin PII', () => {
    it('reprograma con backoff creciente y vuelve a PENDING', async () => {
      await service.markFailed('evt-1', 0, new Error('x'));

      const data = prisma.outboxEvent.update.mock.calls[0][0].data;
      expect(data.status).toBe('PENDING');
      expect(data.attempts).toBe(1);
      // El backoff se materializa en la BASE, no en un timer: así sobrevive a
      // un reinicio.
      expect(data.availableAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('el backoff crece con los intentos', async () => {
      await service.markFailed('evt-1', 0, new Error('x'));
      const primero =
        prisma.outboxEvent.update.mock.calls[0][0].data.availableAt;

      prisma.outboxEvent.update.mockClear();
      await service.markFailed('evt-1', 3, new Error('x'));
      const cuarto =
        prisma.outboxEvent.update.mock.calls[0][0].data.availableAt;

      expect(cuarto.getTime()).toBeGreaterThan(primero.getTime());
    });

    it('libera el claim para que otro dispatcher pueda tomarlo', async () => {
      await service.markFailed('evt-1', 0, new Error('x'));

      expect(
        prisma.outboxEvent.update.mock.calls[0][0].data.claimedAt,
      ).toBeNull();
    });

    it('al agotar los intentos queda FAILED, no se pierde', async () => {
      await service.markFailed(
        'evt-1',
        OUTBOX_MAX_ATTEMPTS - 1,
        new Error('x'),
      );

      const data = prisma.outboxEvent.update.mock.calls[0][0].data;
      expect(data.status).toBe('FAILED');
      expect(data.attempts).toBe(OUTBOX_MAX_ATTEMPTS);
    });

    it('guarda SOLO el clasificador del error, nunca el mensaje crudo', async () => {
      await service.markFailed(
        'evt-1',
        0,
        new Error('fallo con +573001112233 y redis://user:secreto@host'),
      );

      const data = prisma.outboxEvent.update.mock.calls[0][0].data;
      expect(data.lastError).toBe('Error');
      expect(JSON.stringify(data)).not.toContain('573001112233');
      expect(JSON.stringify(data)).not.toContain('secreto');
    });
  });

  describe('políticas de reintento por tipo', () => {
    // Una sola política para todos obliga a elegir entre insistir demasiado en
    // lo que otro va a rehacer, o rendirse pronto con lo que nadie rehará.
    it('un avance reintenta más rápido que un mensaje entrante', () => {
      expect(politicaDe('flowbot.advance').baseMs).toBeLessThan(
        politicaDe('inbound.message').baseMs,
      );
    });

    it('un despertar insiste más veces que un avance', () => {
      // Perder un despertar deja la ejecución dormida para siempre; perder un
      // avance solo lo retrasa hasta que el reconciliador lo vea.
      expect(politicaDe('flowbot.wake').maxIntentos).toBeGreaterThan(
        politicaDe('flowbot.advance').maxIntentos,
      );
    });

    it('un tipo desconocido cae en la política por defecto', () => {
      expect(politicaDe('tipo.inventado')).toEqual(POLITICA_POR_DEFECTO);
    });

    it('el backoff nunca supera el tope del tipo', () => {
      const politica = politicaDe('flowbot.advance');
      // Sin tope, el exponencial llegaría a horas y la ejecución parecería
      // muerta mucho antes de agotar sus intentos.
      const esperaMs =
        politica.baseMs * Math.pow(2, politica.maxIntentos - 1) >
        politica.topeMs;
      expect(esperaMs).toBe(true);
      expect(politica.topeMs).toBeLessThanOrEqual(60_000);
    });

    it('aplica el máximo del tipo, no el global', async () => {
      // `flowbot.wake` admite 12 intentos: al sexto —el máximo global— todavía
      // debe seguir vivo.
      await service.markFailed(
        'evt-1',
        OUTBOX_MAX_ATTEMPTS - 1,
        new Error('x'),
        'flowbot.wake',
      );

      const data = prisma.outboxEvent.update.mock.calls[0][0].data;
      expect(data.status).toBe('PENDING');
    });

    it('aplica el backoff del tipo', async () => {
      await service.markFailed('evt-1', 0, new Error('x'), 'flowbot.advance');
      const avance =
        prisma.outboxEvent.update.mock.calls[0][0].data.availableAt;

      prisma.outboxEvent.update.mockClear();
      await service.markFailed('evt-1', 0, new Error('x'), 'inbound.message');
      const entrante =
        prisma.outboxEvent.update.mock.calls[0][0].data.availableAt;

      expect(avance.getTime()).toBeLessThan(entrante.getTime());
    });

    it('sin tipo se comporta como antes: nadie se queda sin reintentos', async () => {
      await service.markFailed('evt-1', 0, new Error('x'));

      const data = prisma.outboxEvent.update.mock.calls[0][0].data;
      expect(data.status).toBe('PENDING');
      expect(data.attempts).toBe(1);
    });
  });

  describe('markCompletedByKey', () => {
    it('solo completa lo que sigue pendiente o en proceso', async () => {
      await service.markCompletedByKey('wamid.1');

      const where = prisma.outboxEvent.updateMany.mock.calls[0][0].where;
      expect(where.idempotencyKey).toBe('wamid.1');
      expect(where.status).toEqual({ in: ['PENDING', 'PROCESSING'] });
    });

    it('no lanza si el evento ya lo completó otro dispatcher', async () => {
      prisma.outboxEvent.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.markCompletedByKey('x')).resolves.toBeUndefined();
    });
  });
});
