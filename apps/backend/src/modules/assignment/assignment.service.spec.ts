import { AssignmentService } from './assignment.service';

describe('AssignmentService', () => {
  const companyId = 'company-a';
  let prisma: any;
  let notifications: { emitToCompanyRoles: jest.Mock };
  let service: AssignmentService;

  beforeEach(() => {
    prisma = {
      company: {
        findUnique: jest.fn().mockResolvedValue({ autoAssignEnabled: true }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: 'agente-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    notifications = { emitToCompanyRoles: jest.fn().mockResolvedValue(undefined) };
    service = new AssignmentService(prisma, notifications as never);
  });

  describe('elección del turno', () => {
    it('devuelve al asesor elegido', async () => {
      expect(await service.pickNextAgent(companyId)).toBe('agente-1');
    });

    it('le toca a quien lleva MÁS tiempo sin recibir, y los nuevos van primero', async () => {
      // Ordenar por `lastAssignedAt` ascendente con nulls primero es lo que
      // hace que el reparto sea justo y que un asesor recién incorporado no
      // espere una vuelta entera.
      await service.pickNextAgent(companyId);

      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [
            { lastAssignedAt: { sort: 'asc', nulls: 'first' } },
            { id: 'asc' },
          ],
        }),
      );
    });

    it('anota el turno consumido en la fila del usuario', async () => {
      // En la fila y no en memoria: si viviera en memoria, backend y worker
      // llevarían turnos distintos y el reparto repetiría persona.
      await service.pickNextAgent(companyId);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'agente-1' },
        data: { lastAssignedAt: expect.any(Date) },
      });
    });

    it('usa el writer que se le pasa, para ir dentro de la transacción', async () => {
      // Si la operación que lo envuelve se revierte, el turno no se consume.
      const tx = {
        company: { findUnique: jest.fn().mockResolvedValue({ autoAssignEnabled: true }) },
        user: {
          findFirst: jest.fn().mockResolvedValue({ id: 'agente-tx' }),
          update: jest.fn().mockResolvedValue({}),
        },
      };

      expect(await service.pickNextAgent(companyId, tx as never)).toBe('agente-tx');
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
      expect(tx.user.update).toHaveBeenCalled();
    });
  });

  describe('elegibilidad', () => {
    it('solo entran usuarios activos, con reparto activado y de la empresa', async () => {
      await service.pickNextAgent(companyId);

      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            companyId,
            isActive: true,
            autoAssignEnabled: true,
          }),
        }),
      );
    });

    it('solo roles que atienden conversaciones', async () => {
      // Un SUPER_ADMIN de plataforma no pertenece a la empresa y no debe
      // entrar nunca en el turno.
      await service.pickNextAgent(companyId);

      const { where } = prisma.user.findFirst.mock.calls[0][0];
      expect(where.role.in).toEqual(['AGENT', 'ADMIN']);
      expect(where.role.in).not.toContain('SUPER_ADMIN');
    });
  });

  describe('cuando no hay a quién asignar', () => {
    it('con el reparto apagado en la empresa devuelve null sin buscar a nadie', async () => {
      prisma.company.findUnique.mockResolvedValue({ autoAssignEnabled: false });

      expect(await service.pickNextAgent(companyId)).toBeNull();
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('sin candidatos devuelve null y NO consume turno de nadie', async () => {
      // Inventar un responsable sería peor que no asignar: nadie lo vería y
      // además parecería atendido.
      prisma.user.findFirst.mockResolvedValue(null);

      expect(await service.pickNextAgent(companyId)).toBeNull();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('si la empresa no existe devuelve null en vez de asignar a ciegas', async () => {
      prisma.company.findUnique.mockResolvedValue(null);

      expect(await service.pickNextAgent(companyId)).toBeNull();
    });
  });

  describe('aviso de bandeja sin asignar', () => {
    it('avisa a los administradores de la empresa', async () => {
      await service.warnNobodyAvailable(companyId);

      expect(notifications.emitToCompanyRoles).toHaveBeenCalledWith(
        companyId,
        ['ADMIN'],
        expect.objectContaining({ type: 'UNASSIGNED_CONVERSATION' }),
      );
    });

    it('se deduplica por hora para no convertir la campana en ruido', async () => {
      // El caso típico —nadie elegible— se repetiría con cada mensaje.
      await service.warnNobodyAvailable(companyId);
      const { dedupeKey } = notifications.emitToCompanyRoles.mock.calls[0][2];

      expect(dedupeKey).toContain(companyId);
      expect(dedupeKey.startsWith('UNASSIGNED_CONVERSATION:')).toBe(true);
    });

    it('el aviso no lleva datos del contacto ni del mensaje', async () => {
      await service.warnNobodyAvailable(companyId);

      const enviado = JSON.stringify(notifications.emitToCompanyRoles.mock.calls);
      expect(enviado).not.toMatch(/\+?\d{7,}/);
    });
  });
});
