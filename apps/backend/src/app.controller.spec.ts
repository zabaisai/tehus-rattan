import { ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { QueueHealthService } from './common/queue/queue.health';
import { QueuePingService } from './common/queue/queue.ping';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';

describe('AppController', () => {
  let appController: AppController;
  let prisma: { $queryRaw: jest.Mock };

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn() };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: PrismaService, useValue: prisma },
        QueueHealthService,
        // El sondeo de Redis se simula: estas pruebas cubren el controlador,
        // no la conectividad real con la cola.
        { provide: QueuePingService, useValue: { ping: jest.fn() } },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('liveness', () => {
    it('returns { status: "ok" } WITHOUT touching the database', () => {
      expect(appController.getLiveness()).toEqual({ status: 'ok' });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('version', () => {
    it('returns a minimal release payload (no secrets), "unknown" when unset', () => {
      const v = appController.getVersion();
      expect(v).toEqual({
        status: 'ok',
        release: 'unknown',
        builtAt: 'unknown',
      });
    });
  });

  describe('health', () => {
    it('returns { status: "ok" } when the database is reachable', async () => {
      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

      await expect(appController.getHealth()).resolves.toEqual({
        status: 'ok',
      });
    });

    it('readiness returns { status: "ok" } when the database is reachable', async () => {
      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

      await expect(appController.getReadiness()).resolves.toEqual({
        status: 'ok',
      });
    });

    it('throws 503 without leaking the database error when unreachable', async () => {
      prisma.$queryRaw.mockRejectedValue(
        new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2'),
      );

      await expect(appController.getHealth()).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );

      try {
        await appController.getHealth();
        throw new Error('expected getHealth to reject');
      } catch (err) {
        expect((err as ServiceUnavailableException).message).toBe(
          'Service unavailable',
        );
        expect((err as ServiceUnavailableException).message).not.toContain(
          'ECONNREFUSED',
        );
        expect((err as ServiceUnavailableException).message).not.toContain(
          'hunter2',
        );
      }
    });
  });

  describe('salud de la cola', () => {
    it('informa "disabled" sin sondear cuando la cola esta apagada', async () => {
      const anterior = process.env.QUEUE_ENABLED;
      process.env.QUEUE_ENABLED = 'false';

      const salud = await appController.getQueueHealth();

      expect(salud.state).toBe('disabled');
      process.env.QUEUE_ENABLED = anterior;
    });

    it('NUNCA lanza cuando Redis no responde: informa "down" con 200', async () => {
      // Es el invariante del diseno: la cola caida no puede tumbar la API.
      const ping = jest.fn().mockRejectedValue(new Error('sin conexion'));
      const c = new AppController(
        { getHealth: jest.fn() } as never,
        new QueueHealthService(),
        { ping } as never,
      );

      const salud = await c.getQueueHealth();

      expect(salud.state).toBe('down');
    });
  });
});
