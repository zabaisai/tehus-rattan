import { ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';

describe('AppController', () => {
  let appController: AppController;
  let prisma: { $queryRaw: jest.Mock };

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn() };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('health', () => {
    it('returns { status: "ok" } when the database is reachable', async () => {
      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

      await expect(appController.getHealth()).resolves.toEqual({ status: 'ok' });
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
        expect((err as ServiceUnavailableException).message).not.toContain('ECONNREFUSED');
        expect((err as ServiceUnavailableException).message).not.toContain('hunter2');
      }
    });
  });
});
