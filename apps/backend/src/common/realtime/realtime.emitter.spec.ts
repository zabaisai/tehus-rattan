import { RealtimeEmitter } from './realtime.emitter';
import { EVENTS, rooms } from './realtime.rooms';

const EMPRESA_A = 'company-a';
const EMPRESA_B = 'company-b';

describe('RealtimeEmitter', () => {
  let emit: jest.Mock;
  let to: jest.Mock;
  let transport: { server?: { to: jest.Mock } };
  let emitter: RealtimeEmitter;

  /** Devuelve las salas a las que se emitió un evento concreto. */
  const salasDe = (evento: string): string[] =>
    emit.mock.calls
      .map((call, i) => ({ evento: call[0], sala: to.mock.calls[i][0] }))
      .filter((x) => x.evento === evento)
      .map((x) => x.sala);

  beforeEach(() => {
    emit = jest.fn();
    to = jest.fn().mockReturnValue({ emit });
    transport = { server: { to } };
    emitter = new RealtimeEmitter(transport as never);
  });

  describe('aislamiento entre empresas', () => {
    it('un evento de la empresa A solo va a la sala de A', () => {
      emitter.toCompany(EMPRESA_A, 'x', {});

      expect(to).toHaveBeenCalledWith(rooms.company(EMPRESA_A));
      expect(to).not.toHaveBeenCalledWith(rooms.company(EMPRESA_B));
    });

    it('dos empresas con el MISMO id de conversación no comparten sala', () => {
      // Los ids son cuid, así que en la práctica no colisionan; la prueba fija
      // la garantía estructural: la sala lleva la empresa dentro.
      emitter.toConversation(EMPRESA_A, 'conv-1', 'x', {});
      emitter.toConversation(EMPRESA_B, 'conv-1', 'x', {});

      const [salaA, salaB] = to.mock.calls.map((c) => c[0]);
      expect(salaA).not.toBe(salaB);
    });

    it('ningún nombre de sala se construye con datos del payload', () => {
      emitter.toCompany(EMPRESA_A, 'x', { companyId: EMPRESA_B });

      expect(to).toHaveBeenCalledWith(rooms.company(EMPRESA_A));
      expect(to).toHaveBeenCalledTimes(1);
    });
  });

  describe('mensaje nuevo', () => {
    const mensaje = {
      id: 'msg-1',
      direction: 'INBOUND',
      type: 'text',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };

    it('avisa al hilo abierto y a la lista de conversaciones de la empresa', () => {
      emitter.messageCreated(EMPRESA_A, 'conv-1', mensaje);

      expect(salasDe(EVENTS.MESSAGE_CREATED)).toEqual([
        rooms.conversation(EMPRESA_A, 'conv-1'),
      ]);
      expect(salasDe(EVENTS.CONVERSATION_UPDATED)).toEqual([
        rooms.company(EMPRESA_A),
      ]);
    });

    it('NO viaja el cuerpo del mensaje por el canal', () => {
      // El evento avisa de que hay algo nuevo; el cliente lo recarga por la
      // API, que aplica sus permisos. Mandar el contenido duplicaría la
      // superficie de exposición.
      emitter.messageCreated(EMPRESA_A, 'conv-1', {
        ...mensaje,
        ...({ content: 'texto confidencial', from: '+573001112233' } as Record<
          string,
          unknown
        >),
      });

      const enviado = JSON.stringify(emit.mock.calls);
      expect(enviado).not.toContain('texto confidencial');
      expect(enviado).not.toContain('3001112233');
    });

    it('el payload lleva lo justo para refrescar', () => {
      emitter.messageCreated(EMPRESA_A, 'conv-1', mensaje);

      expect(emit.mock.calls[0][1]).toEqual({
        conversationId: 'conv-1',
        messageId: 'msg-1',
        direction: 'INBOUND',
        type: 'text',
        createdAt: mensaje.createdAt,
      });
    });
  });

  describe('cambio de estado de entrega', () => {
    it('va solo al hilo, no a toda la empresa', () => {
      emitter.messageStatusChanged(EMPRESA_A, 'conv-1', 'msg-1', 'READ');

      expect(to).toHaveBeenCalledTimes(1);
      expect(to).toHaveBeenCalledWith(rooms.conversation(EMPRESA_A, 'conv-1'));
    });
  });

  describe('oportunidades y tareas', () => {
    it('el lead actualizado llega a toda la empresa: el tablero es compartido', () => {
      emitter.leadUpdated(EMPRESA_A, 'lead-1', 'stage-2');

      expect(to).toHaveBeenCalledWith(rooms.company(EMPRESA_A));
      expect(emit).toHaveBeenCalledWith(EVENTS.LEAD_UPDATED, {
        leadId: 'lead-1',
        stageId: 'stage-2',
      });
    });

    it('la tarea llega a la empresa y además al responsable', () => {
      emitter.taskUpdated(EMPRESA_A, 'task-1', 'user-9');

      expect(salasDe(EVENTS.TASK_UPDATED)).toEqual([
        rooms.company(EMPRESA_A),
        rooms.user('user-9'),
      ]);
    });

    it('sin responsable no emite a ninguna sala de usuario', () => {
      emitter.taskUpdated(EMPRESA_A, 'task-1');

      expect(salasDe(EVENTS.TASK_UPDATED)).toEqual([rooms.company(EMPRESA_A)]);
    });
  });

  describe('notificaciones', () => {
    it('van únicamente al usuario destinatario', () => {
      emitter.notificationCreated('user-9', 'notif-1');

      expect(to).toHaveBeenCalledTimes(1);
      expect(to).toHaveBeenCalledWith(rooms.user('user-9'));
    });
  });

  describe('best-effort: el tiempo real nunca rompe el negocio', () => {
    it('no lanza si el servidor aún no arrancó', () => {
      transport.server = undefined;

      expect(() => emitter.toCompany(EMPRESA_A, 'x', {})).not.toThrow();
    });

    it('no lanza si la emisión falla', () => {
      // Que un asesor no vea la burbuja aparecer sola es una molestia; que el
      // mensaje no se guarde es un incidente.
      emit.mockImplementation(() => {
        throw new Error('socket cerrado');
      });

      expect(() =>
        emitter.messageCreated(EMPRESA_A, 'conv-1', {
          id: 'm',
          direction: 'INBOUND',
          type: 'text',
          createdAt: new Date(),
        }),
      ).not.toThrow();
    });

    it('el aviso de fallo no incluye el detalle del error', () => {
      const warn = jest
        .spyOn(
          (emitter as unknown as { logger: { warn: (m: string) => void } })
            .logger,
          'warn',
        )
        .mockImplementation(() => undefined);
      emit.mockImplementation(() => {
        throw new Error('socket de +573001112233 cerrado');
      });

      emitter.toCompany(EMPRESA_A, 'x', {});

      expect(JSON.stringify(warn.mock.calls)).not.toContain('3001112233');
      warn.mockRestore();
    });
  });
});
