import { Prisma } from '@prisma/client';
import { HandoffService } from './handoff.service';

/**
 * Lo que se fija aquí no es que escriba una fila —eso es un `create`— sino
 * las tres reglas sin las que el handoff no sirve de nada: que la pausa y la
 * fila viajen juntas, que un reintento no le robe la conversación al asesor
 * que ya la tenía, y que resolver no despierte al bot por su cuenta.
 */
describe('HandoffService', () => {
  let prisma: any;
  let notifications: { emit: jest.Mock };
  let handoff: HandoffService;

  const duplicado = () =>
    new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: '6',
    });

  /** `$transaction` que ejecuta el callback con el mismo doble. */
  const conTransaccion = () =>
    jest.fn((cb: (tx: unknown) => unknown) => cb(prisma));

  beforeEach(() => {
    prisma = {
      conversation: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'conv-1', assignedTo: null }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      conversationHandoff: {
        create: jest.fn().mockResolvedValue({
          id: 'ho-1',
          assignedToUserId: null,
        }),
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'user-1' }) },
      note: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction = conTransaccion();
    notifications = { emit: jest.fn().mockResolvedValue(undefined) };
    handoff = new HandoffService(prisma, notifications as never);
  });

  describe('abrir', () => {
    it('pausa la conversación en la MISMA transacción que la fila', async () => {
      await handoff.abrir({
        companyId: 'emp-1',
        conversationId: 'conv-1',
        reason: 'cliente-pide-humano',
      });

      // Separarlas dejaría, al morir en medio, o una conversación pausada que
      // nadie sabe por qué lo está, o una entrega registrada con el bot
      // todavía hablando.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.conversationHandoff.create).toHaveBeenCalled();
      expect(prisma.conversation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isPaused: true }),
        }),
      );
    });

    it('acota la conversación por empresa', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null);

      await expect(
        handoff.abrir({ companyId: 'emp-1', conversationId: 'ajena' }),
      ).rejects.toThrow('ConversacionNoEncontrada');
    });

    it('rechaza asignar a un usuario de otra empresa', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await handoff.abrir({
        companyId: 'emp-1',
        conversationId: 'conv-1',
        assignedToUserId: 'user-de-otra-empresa',
      });

      // No lanza: se entrega a la bandeja común. Fallar dejaría al cliente sin
      // nadie por un ajuste mal hecho.
      expect(prisma.conversationHandoff.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ assignedToUserId: null }),
        }),
      );
    });

    it('respeta a quien ya tenía la conversación si el nodo no dice a quién', async () => {
      prisma.conversation.findFirst.mockResolvedValue({
        id: 'conv-1',
        assignedTo: 'asesor-previo',
      });

      await handoff.abrir({ companyId: 'emp-1', conversationId: 'conv-1' });

      // Alguien pudo tomarla a mano antes de que el bot llegara al nodo.
      expect(prisma.conversationHandoff.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ assignedToUserId: 'asesor-previo' }),
        }),
      );
    });

    it('una segunda entrega devuelve la existente en vez de crear otra', async () => {
      // Choca contra el índice único parcial: es exactamente lo que ese índice
      // existe para provocar.
      prisma.conversationHandoff.create.mockRejectedValue(duplicado());
      prisma.conversationHandoff.findFirst.mockResolvedValue({
        id: 'ho-previo',
        assignedToUserId: 'asesor-previo',
      });

      const r = await handoff.abrir({
        companyId: 'emp-1',
        conversationId: 'conv-1',
        assignedToUserId: 'user-1',
      });

      // Un reintento del mismo nodo no le roba la conversación al asesor que
      // ya la tenía.
      expect(r).toEqual({
        handoffId: 'ho-previo',
        creado: false,
        assignedToUserId: 'asesor-previo',
      });
    });

    it('avisa FUERA de la transacción y sin esperarlo', async () => {
      prisma.conversationHandoff.create.mockResolvedValue({
        id: 'ho-1',
        assignedToUserId: 'user-1',
      });

      await handoff.abrir({
        companyId: 'emp-1',
        conversationId: 'conv-1',
        assignedToUserId: 'user-1',
        reason: 'cliente-pide-humano',
      });

      // Un fallo de notificaciones no puede deshacer una entrega ya escrita.
      expect(notifications.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientUserId: 'user-1',
          dedupeKey: 'HANDOFF:ho-1',
        }),
      );
    });

    it('el aviso NO lleva el texto del cliente', async () => {
      prisma.conversationHandoff.create.mockResolvedValue({
        id: 'ho-1',
        assignedToUserId: 'user-1',
      });

      await handoff.abrir({
        companyId: 'emp-1',
        conversationId: 'conv-1',
        assignedToUserId: 'user-1',
        reason: 'cliente-pide-humano',
        note: 'el cliente dijo que su cédula es 123456',
      });

      // Un aviso llega a móviles y correos, donde el texto ya no está
      // protegido por los permisos del CRM.
      const enviado = JSON.stringify(notifications.emit.mock.calls[0][0]);
      expect(enviado).not.toContain('123456');
      expect(enviado).toContain('cliente-pide-humano');
    });
  });

  describe('resolver', () => {
    it('solo resuelve lo que sigue ACTIVE', async () => {
      await handoff.resolver({
        companyId: 'emp-1',
        conversationId: 'conv-1',
        resolvedByUserId: 'user-1',
      });

      // Si otra pestaña ya la resolvió, esta no pisa quién lo hizo.
      expect(prisma.conversationHandoff.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'ACTIVE' }),
        }),
      );
    });

    it('NO despierta al bot por su cuenta', async () => {
      const r = await handoff.resolver({
        companyId: 'emp-1',
        conversationId: 'conv-1',
      });

      // Muchas veces la conversación termina con la persona, y despertar al
      // bot volvería a escribirle al cliente sin motivo.
      expect(r.botReanudado).toBe(false);
      expect(prisma.conversation.updateMany).not.toHaveBeenCalled();
    });

    it('lo despierta si quien resuelve lo pide', async () => {
      const r = await handoff.resolver({
        companyId: 'emp-1',
        conversationId: 'conv-1',
        reanudarBot: true,
      });

      expect(r.botReanudado).toBe(true);
      expect(prisma.conversation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { isPaused: false },
        }),
      );
    });

    it('resolver algo que ya no está activo no es un fallo', async () => {
      prisma.conversationHandoff.updateMany.mockResolvedValue({ count: 0 });

      const r = await handoff.resolver({
        companyId: 'emp-1',
        conversationId: 'conv-1',
      });

      expect(r).toEqual({ resuelto: false, botReanudado: false });
    });
  });

  describe('cancelar', () => {
    it('se distingue de resolver', async () => {
      await handoff.cancelar({ companyId: 'emp-1', conversationId: 'conv-1' });

      // Medir "cuántas entregas se quedaron sin respuesta" es imposible si
      // cancelar y resolver son lo mismo.
      expect(prisma.conversationHandoff.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'CANCELLED' }),
        }),
      );
    });
  });

  describe('hayHandoffActivo', () => {
    it('es la fuente de verdad, no la bandera isPaused', async () => {
      prisma.conversationHandoff.count.mockResolvedValue(1);

      await expect(handoff.hayHandoffActivo('emp-1', 'conv-1')).resolves.toBe(
        true,
      );
      expect(prisma.conversationHandoff.count).toHaveBeenCalledWith({
        where: {
          companyId: 'emp-1',
          conversationId: 'conv-1',
          status: 'ACTIVE',
        },
      });
    });
  });
});
