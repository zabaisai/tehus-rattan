import { RealtimeGateway } from './realtime.gateway';
import { rooms, EVENTS, EVENT_VERSION } from './realtime.rooms';

const socket = (identity?: unknown) => ({
  handshake: { auth: { token: 'tok' } },
  data: identity ? { identity } : ({} as Record<string, unknown>),
  join: jest.fn().mockResolvedValue(undefined),
  leave: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn(),
});

const EMPRESA_A = 'company-a';
const EMPRESA_B = 'company-b';
const idA = { userId: 'user-a', companyId: EMPRESA_A, role: 'AGENT' };
const idB = { userId: 'user-b', companyId: EMPRESA_B, role: 'AGENT' };

describe('RealtimeGateway', () => {
  let auth: { authenticate: jest.Mock };
  let prisma: any;
  let gateway: RealtimeGateway;

  beforeEach(() => {
    auth = { authenticate: jest.fn().mockReturnValue(idA) };
    prisma = {
      conversation: {
        findFirst: jest.fn().mockResolvedValue({ id: 'conv-1' }),
      },
    };
    gateway = new RealtimeGateway(auth as never, prisma);
  });

  /** Extrae el middleware que el gateway instala en el servidor. */
  const middleware = () => {
    const use = jest.fn();
    gateway.afterInit({ use } as never);
    return use.mock.calls[0][0] as (s: unknown, next: jest.Mock) => void;
  };

  describe('handshake (middleware)', () => {
    it('acepta un token válido y deja la identidad en el socket', () => {
      const s = socket();
      const next = jest.fn();

      middleware()(s, next);

      expect(next).toHaveBeenCalledWith();
      expect(s.data.identity).toEqual(idA);
    });

    it('RECHAZA antes de conectar si el token no vale', () => {
      // Rechazar aquí y no en handleConnection es lo que hace que el cliente
      // reciba connect_error y no se crea en vivo ni un milisegundo.
      auth.authenticate.mockReturnValue(null);
      const next = jest.fn();

      middleware()(socket(), next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it('la identidad se resuelve del TOKEN, no de lo que envíe el cliente', () => {
      const s = socket();
      s.handshake.auth = {
        token: 'tok',
        companyId: 'company-INTRUSA',
      } as never;

      middleware()(s, jest.fn());

      expect(s.data.identity).toEqual(idA);
    });
  });

  describe('conexión', () => {
    it('une al cliente a las salas de SU empresa y SU usuario', () => {
      const s = socket(idA);

      gateway.handleConnection(s as never);

      expect(s.join).toHaveBeenCalledWith(rooms.company(EMPRESA_A));
      expect(s.join).toHaveBeenCalledWith(rooms.user('user-a'));
      expect(s.disconnect).not.toHaveBeenCalled();
    });

    it('las salas se derivan del TOKEN, nunca de lo que envíe el cliente', () => {
      const s = socket(idA);
      s.handshake.auth = {
        token: 'tok',
        companyId: 'company-INTRUSA',
      } as never;

      gateway.handleConnection(s as never);

      const salas = s.join.mock.calls.map((c) => c[0]);
      expect(salas).toContain(rooms.company(EMPRESA_A));
      expect(salas.some((r: string) => r.includes('INTRUSA'))).toBe(false);
    });

    it('un socket sin identidad se cierra en vez de quedarse mudo', () => {
      // Defensa en profundidad por si algún día desapareciera el middleware.
      const s = socket();

      gateway.handleConnection(s as never);

      expect(s.disconnect).toHaveBeenCalledWith(true);
      expect(s.join).not.toHaveBeenCalled();
    });
  });

  describe('suscripción a conversación — cero fuga entre empresas', () => {
    it('permite suscribirse a una conversación de la propia empresa', async () => {
      const s = socket(idA);

      const r = await gateway.suscribirConversacion(s as never, {
        conversationId: 'conv-1',
      });

      expect(r.ok).toBe(true);
      expect(s.join).toHaveBeenCalledWith(
        rooms.conversation(EMPRESA_A, 'conv-1'),
      );
    });

    it('comprueba la pertenencia CONTRA LA BASE usando el companyId del token', async () => {
      const s = socket(idA);

      await gateway.suscribirConversacion(s as never, {
        conversationId: 'conv-1',
      });

      expect(prisma.conversation.findFirst).toHaveBeenCalledWith({
        where: { id: 'conv-1', companyId: EMPRESA_A },
        select: { id: true },
      });
    });

    it('RECHAZA una conversación de otra empresa y no une a ninguna sala', async () => {
      // El caso que justifica todo el gateway: sin esta comprobación, un
      // cliente de A escucharía el hilo de B con solo conocer su id.
      const s = socket(idA);
      prisma.conversation.findFirst.mockResolvedValue(null);

      const r = await gateway.suscribirConversacion(s as never, {
        conversationId: 'conv-de-B',
      });

      expect(r.ok).toBe(false);
      expect(s.join).not.toHaveBeenCalled();
    });

    it('un socket sin identidad no puede suscribirse a nada', async () => {
      const s = socket();

      const r = await gateway.suscribirConversacion(s as never, {
        conversationId: 'conv-1',
      });

      expect(r.ok).toBe(false);
      expect(prisma.conversation.findFirst).not.toHaveBeenCalled();
    });

    it('sin conversationId no consulta la base', async () => {
      const s = socket(idA);

      const r = await gateway.suscribirConversacion(s as never, {});

      expect(r.ok).toBe(false);
      expect(prisma.conversation.findFirst).not.toHaveBeenCalled();
    });

    it('la sala de conversación lleva el companyId dentro: dos empresas nunca coinciden', () => {
      // Segunda barrera: aunque alguien se colara con un id ajeno, la sala a
      // la que entraría no sería aquella a la que emite la empresa dueña.
      const salaA = rooms.conversation(EMPRESA_A, 'conv-1');
      const salaB = rooms.conversation(EMPRESA_B, 'conv-1');

      expect(salaA).not.toBe(salaB);
      expect(salaA).toContain(EMPRESA_A);
    });
  });

  describe('desuscripción', () => {
    it('sale de la sala de su propia empresa', async () => {
      const s = socket(idA);

      await gateway.desuscribirConversacion(s as never, {
        conversationId: 'conv-1',
      });

      expect(s.leave).toHaveBeenCalledWith(
        rooms.conversation(EMPRESA_A, 'conv-1'),
      );
    });

    it('un cliente de B no puede sacar a nadie de la sala de A', async () => {
      const s = socket(idB);

      await gateway.desuscribirConversacion(s as never, {
        conversationId: 'conv-1',
      });

      // Sale de SU sala, que es distinta. No toca la de A.
      expect(s.leave).toHaveBeenCalledWith(
        rooms.conversation(EMPRESA_B, 'conv-1'),
      );
      expect(s.leave).not.toHaveBeenCalledWith(
        rooms.conversation(EMPRESA_A, 'conv-1'),
      );
    });
  });

  describe('latido', () => {
    it('responde al ping explícito', () => {
      expect(gateway.responderPing().pong).toBeGreaterThan(0);
    });
  });

  describe('versionado de eventos', () => {
    it('todos los eventos llevan la versión en el nombre', () => {
      // Va en el nombre y no en el payload: así un cliente viejo simplemente
      // no escucha los nuevos, en vez de recibir una forma que no entiende.
      for (const evento of Object.values(EVENTS)) {
        expect(evento.startsWith(`${EVENT_VERSION}:`)).toBe(true);
      }
    });
  });
});
