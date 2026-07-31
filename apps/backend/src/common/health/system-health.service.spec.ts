import {
  ANTIGUEDAD_MAXIMA_OUTBOX_MS,
  MARGEN_LATIDO_MS,
  SystemHealthService,
} from './system-health.service';
import { estadoDelPuente } from '../realtime/realtime.redis';
import { COMPONENTE_WORKER } from './heartbeat.service';

describe('SystemHealthService', () => {
  let prisma: any;
  let queueHealth: { check: jest.Mock; isEnabled: jest.Mock };
  let queuePing: { ping: jest.Mock };
  let service: SystemHealthService;

  const conCola = { QUEUE_ENABLED: 'true' } as NodeJS.ProcessEnv;

  beforeEach(() => {
    prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      systemHeartbeat: {
        findUnique: jest.fn().mockResolvedValue({ seenAt: new Date() }),
      },
      outboxEvent: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    queueHealth = {
      check: jest.fn().mockResolvedValue({ state: 'up', latencyMs: 1 }),
      isEnabled: jest.fn().mockReturnValue(true),
    };
    queuePing = { ping: jest.fn().mockResolvedValue('PONG') };
    estadoDelPuente.conectado = true;
    delete estadoDelPuente.motivo;

    service = new SystemHealthService(
      prisma,
      queueHealth as never,
      queuePing as never,
    );
  });

  describe('todo en orden', () => {
    it('reporta ok con todos los componentes arriba', async () => {
      const r = await service.check(conCola);

      expect(r.status).toBe('ok');
      expect(r.components.database.state).toBe('up');
      expect(r.components.queue.state).toBe('up');
      expect(r.components.worker.state).toBe('up');
      expect(r.components.outbox.state).toBe('up');
      expect(r.components.realtime.state).toBe('up');
    });
  });

  describe('el outbox no se está procesando → NUNCA ok', () => {
    it('con Redis caído reporta degraded, no ok', async () => {
      // Es el punto entero de este servicio: con Redis caído las
      // conversaciones se siguen guardando y la interfaz responde, así que
      // todas las sondas clásicas dan verde mientras los efectos de cada
      // mensaje se acumulan sin que nadie los toque.
      queueHealth.check.mockResolvedValue({
        state: 'down',
        reason: 'ConnectionError',
      });

      const r = await service.check(conCola);

      expect(r.status).toBe('degraded');
      expect(r.status).not.toBe('ok');
    });

    it('con el worker muerto pero Redis vivo reporta degraded', async () => {
      // El caso peor: Redis responde, los eventos se encolan, y nadie los
      // consume. Sin el latido, todo parecería sano.
      prisma.systemHeartbeat.findUnique.mockResolvedValue({
        seenAt: new Date(Date.now() - MARGEN_LATIDO_MS - 1_000),
      });

      const r = await service.check(conCola);

      expect(r.components.worker.state).toBe('stale');
      expect(r.status).toBe('degraded');
    });

    it('con eventos vencidos sin procesar reporta degraded aunque todo lo demás esté arriba', async () => {
      // El síntoma real, sea cual sea la causa.
      prisma.outboxEvent.count.mockResolvedValue(42);
      prisma.outboxEvent.findFirst.mockResolvedValue({
        availableAt: new Date(Date.now() - ANTIGUEDAD_MAXIMA_OUTBOX_MS - 1_000),
      });

      const r = await service.check(conCola);

      expect(r.components.outbox.state).toBe('stale');
      expect(r.components.outbox.pending).toBe(42);
      expect(r.status).toBe('degraded');
    });

    it('un retraso normal del outbox no dispara alarma', async () => {
      prisma.outboxEvent.count.mockResolvedValue(3);
      prisma.outboxEvent.findFirst.mockResolvedValue({
        availableAt: new Date(Date.now() - 5_000),
      });

      const r = await service.check(conCola);

      expect(r.components.outbox.state).toBe('up');
      expect(r.status).toBe('ok');
    });
  });

  describe('worker', () => {
    it('sin latido registrado es unknown, no down', async () => {
      // Puede ser un despliegue recién levantado; confundir "aún no ha
      // latido" con "está muerto" produce una alarma en cada arranque.
      prisma.systemHeartbeat.findUnique.mockResolvedValue(null);

      const r = await service.check(conCola);

      expect(r.components.worker.state).toBe('unknown');
      expect(r.status).toBe('ok');
    });

    it('se busca el latido del componente correcto', async () => {
      await service.check(conCola);

      expect(prisma.systemHeartbeat.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { component: COMPONENTE_WORKER } }),
      );
    });

    it('con la cola apagada el worker es disabled, no una alarma', async () => {
      queueHealth.isEnabled.mockReturnValue(false);
      queueHealth.check.mockResolvedValue({ state: 'disabled' });

      const r = await service.check({ QUEUE_ENABLED: 'false' } as never);

      expect(r.components.worker.state).toBe('disabled');
      expect(r.status).toBe('ok');
    });
  });

  describe('tiempo real', () => {
    it('el puente caído se ve, y se dice que el polling lo cubre', async () => {
      // Puede degradarse sin romper nada, pero una degradación invisible se
      // queda instalada durante meses.
      estadoDelPuente.conectado = false;
      estadoDelPuente.motivo = 'redis-inalcanzable';

      const r = await service.check(conCola);

      expect(r.components.realtime.state).toBe('down');
      expect(r.components.realtime.fallback).toBe('polling');
      expect(r.status).toBe('degraded');
    });

    it('sin puente configurado es disabled, no un fallo', async () => {
      const r = await service.check({ QUEUE_ENABLED: 'false' } as never);

      expect(r.components.realtime.state).toBe('disabled');
    });
  });

  describe('base de datos', () => {
    it('sin base el sistema está down, no degraded', async () => {
      // Es la única dependencia sin la cual no se puede atender.
      prisma.$queryRaw.mockRejectedValue(new Error('ECONNREFUSED'));

      const r = await service.check(conCola);

      expect(r.components.database.state).toBe('down');
      expect(r.status).toBe('down');
    });

    it('un fallo de la base no impide informar del resto', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('ECONNREFUSED'));

      const r = await service.check(conCola);

      expect(r.components.queue).toBeDefined();
      expect(r.components.realtime).toBeDefined();
    });
  });

  describe('no filtra secretos', () => {
    it('el motivo es un clasificador, no el mensaje del error', async () => {
      prisma.$queryRaw.mockRejectedValue(
        new Error('connect ECONNREFUSED 10.0.0.5:5432 password=s3cr3t'),
      );

      const r = await service.check(conCola);

      const texto = JSON.stringify(r);
      expect(texto).not.toContain('s3cr3t');
      expect(texto).not.toContain('10.0.0.5');
    });
  });
});
