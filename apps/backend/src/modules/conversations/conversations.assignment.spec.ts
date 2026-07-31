import { ConversationsService } from './conversations.service';

describe('ConversationsService — reasignación manual', () => {
  const companyId = 'company-a';
  let prisma: any;
  let notifications: { emit: jest.Mock };
  let realtime: { toCompany: jest.Mock };
  let service: ConversationsService;

  beforeEach(() => {
    prisma = {
      conversation: {
        findFirst: jest.fn().mockResolvedValue({ id: 'conv-1', companyId }),
        update: jest.fn().mockResolvedValue({ id: 'conv-1' }),
      },
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'agente-2' }) },
    };
    notifications = { emit: jest.fn().mockResolvedValue(undefined) };
    realtime = { toCompany: jest.fn() };
    service = new ConversationsService(
      prisma,
      notifications as never,
      realtime as never,
    );
  });

  it('avisa al nuevo responsable', async () => {
    // Reasignar a mano era silencioso: el destinatario no se enteraba hasta
    // que abría la bandeja por su cuenta, y mientras tanto el cliente
    // esperaba. El reparto automático sí avisa; esto lo iguala.
    await service.update('conv-1', companyId, { assignedTo: 'agente-2' });

    expect(notifications.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId,
        recipientUserId: 'agente-2',
        type: 'CONVERSATION_ASSIGNED',
        entityId: 'conv-1',
      }),
    );
  });

  it('el aviso no lleva el contenido de la conversación ni el teléfono', async () => {
    await service.update('conv-1', companyId, { assignedTo: 'agente-2' });

    const enviado = JSON.stringify(notifications.emit.mock.calls);
    expect(enviado).not.toMatch(/\+?\d{7,}/);
  });

  it('cada reasignación a una persona distinta es un aviso distinto', async () => {
    // La conversación puede ir y venir entre asesores; colapsarlas dejaría a
    // alguien sin enterarse de que ahora es suya.
    await service.update('conv-1', companyId, { assignedTo: 'agente-2' });
    await service.update('conv-1', companyId, { assignedTo: 'agente-3' });

    const claves = notifications.emit.mock.calls.map((c) => c[0].dedupeKey);
    expect(new Set(claves).size).toBe(2);
  });

  it('un cambio que no toca el responsable no genera aviso', async () => {
    await service.update('conv-1', companyId, { isPaused: true });

    expect(notifications.emit).not.toHaveBeenCalled();
  });

  it('emite el cambio en vivo a la empresa, no a otra', async () => {
    await service.update('conv-1', companyId, { assignedTo: 'agente-2' });

    expect(realtime.toCompany).toHaveBeenCalledWith(
      companyId,
      'v1:conversation.updated',
      { conversationId: 'conv-1' },
    );
  });

  it('el usuario destino se valida dentro de la MISMA empresa', async () => {
    // Sin esto se podría asignar la conversación a alguien de otra empresa,
    // que además la vería en su bandeja.
    await service.update('conv-1', companyId, { assignedTo: 'agente-2' });

    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'agente-2', companyId, isActive: true },
      }),
    );
  });
});
