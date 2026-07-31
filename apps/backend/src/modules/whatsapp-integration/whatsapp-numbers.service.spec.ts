import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WhatsAppNumbersService } from './whatsapp-numbers.service';

describe('WhatsAppNumbersService', () => {
  let prisma: any;
  let audit: any;
  let service: WhatsAppNumbersService;

  const numero = (extra: Record<string, unknown> = {}) => ({
    id: 'num-1',
    companyId: 'company-a',
    phoneNumberId: 'phone-1',
    displayPhoneNumber: '+50255550000',
    label: null,
    isPrimary: false,
    order: 0,
    status: 'CONNECTED',
    ...extra,
  });

  beforeEach(() => {
    prisma = {
      whatsAppIntegration: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        findUniqueOrThrow: jest.fn().mockResolvedValue(numero()),
        update: jest.fn().mockResolvedValue(numero()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new WhatsAppNumbersService(prisma, audit);
  });

  describe('listar', () => {
    it('acota por empresa y pone el principal primero', async () => {
      await service.listar('company-a');

      const args = prisma.whatsAppIntegration.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ companyId: 'company-a' });
      expect(args.orderBy[0]).toEqual({ isPrimary: 'desc' });
    });

    it('NUNCA devuelve el token: alimenta la interfaz', async () => {
      await service.listar('company-a');

      const select =
        prisma.whatsAppIntegration.findMany.mock.calls[0][0].select;
      expect(select.accessTokenEncrypted).toBeUndefined();
      expect(Object.keys(select)).not.toContain('accessTokenEncrypted');
    });
  });

  describe('renombrar', () => {
    it('un numero de otra empresa no existe para esta', async () => {
      prisma.whatsAppIntegration.findFirst.mockResolvedValue(null);

      await expect(
        service.renombrar('company-a', 'num-de-b', 'Soporte'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.whatsAppIntegration.update).not.toHaveBeenCalled();
    });

    it('busca SIEMPRE acotado por companyId', async () => {
      prisma.whatsAppIntegration.findFirst.mockResolvedValue(numero());

      await service.renombrar('company-a', 'num-1', 'Soporte');

      expect(prisma.whatsAppIntegration.findFirst).toHaveBeenCalledWith({
        where: { id: 'num-1', companyId: 'company-a' },
      });
    });

    it('recorta la etiqueta', async () => {
      prisma.whatsAppIntegration.findFirst.mockResolvedValue(numero());

      await service.renombrar('company-a', 'num-1', '  Soporte  ');

      expect(prisma.whatsAppIntegration.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { label: 'Soporte' } }),
      );
    });

    it('una etiqueta vacia la borra en vez de guardar espacios', async () => {
      prisma.whatsAppIntegration.findFirst.mockResolvedValue(numero());

      await service.renombrar('company-a', 'num-1', '   ');

      expect(prisma.whatsAppIntegration.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { label: null } }),
      );
    });

    it('rechaza una etiqueta demasiado larga', async () => {
      prisma.whatsAppIntegration.findFirst.mockResolvedValue(numero());

      await expect(
        service.renombrar('company-a', 'num-1', 'x'.repeat(41)),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('marcarPrincipal', () => {
    const actor = { userId: 'u1', role: 'ADMIN' };

    it('un numero de otra empresa no se puede marcar', async () => {
      prisma.whatsAppIntegration.findFirst.mockResolvedValue(null);

      await expect(
        service.marcarPrincipal('company-a', 'num-de-b', actor),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('un numero desconectado no puede ser principal: desde el no se envia', async () => {
      prisma.whatsAppIntegration.findFirst.mockResolvedValue(
        numero({ status: 'DISCONNECTED' }),
      );

      await expect(
        service.marcarPrincipal('company-a', 'num-1', actor),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('quita el anterior y pone el nuevo EN LA MISMA transaccion', async () => {
      prisma.whatsAppIntegration.findFirst.mockResolvedValue(numero());

      await service.marcarPrincipal('company-a', 'num-1', actor);

      // En dos pasos sueltos, el indice parcial rechazaria el segundo y la
      // empresa se quedaria sin ningun principal.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.whatsAppIntegration.updateMany).toHaveBeenCalledWith({
        where: { companyId: 'company-a', isPrimary: true },
        data: { isPrimary: false },
      });
      expect(prisma.whatsAppIntegration.update).toHaveBeenCalledWith({
        where: { id: 'num-1' },
        data: { isPrimary: true },
      });
    });

    it('quita el principal SOLO de esta empresa', async () => {
      prisma.whatsAppIntegration.findFirst.mockResolvedValue(numero());

      await service.marcarPrincipal('company-a', 'num-1', actor);

      const where =
        prisma.whatsAppIntegration.updateMany.mock.calls[0][0].where;
      expect(where.companyId).toBe('company-a');
    });

    it('marcar el que ya es principal no toca nada', async () => {
      prisma.whatsAppIntegration.findFirst.mockResolvedValue(
        numero({ isPrimary: true }),
      );

      await service.marcarPrincipal('company-a', 'num-1', actor);

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('queda en auditoria quien lo cambio', async () => {
      prisma.whatsAppIntegration.findFirst.mockResolvedValue(numero());

      await service.marcarPrincipal('company-a', 'num-1', actor);

      expect(audit.record).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          actorUserId: 'u1',
          affectedCompanyId: 'company-a',
          action: 'WHATSAPP_PRIMARY_NUMBER_CHANGED',
          entityId: 'num-1',
        }),
      );
    });

    it('la auditoria no arrastra el numero visible del cliente', async () => {
      prisma.whatsAppIntegration.findFirst.mockResolvedValue(numero());

      await service.marcarPrincipal('company-a', 'num-1', actor);

      const registro = audit.record.mock.calls[0][1];
      expect(JSON.stringify(registro)).not.toContain('+50255550000');
    });
  });
});
