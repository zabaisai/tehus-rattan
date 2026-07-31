import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { io, type Socket } from 'socket.io-client';
import { AddressInfo } from 'net';
import { PrismaService } from '../src/prisma/prisma.service';
import { RealtimeAuthService } from '../src/common/realtime/realtime.auth';
import { RealtimeGateway } from '../src/common/realtime/realtime.gateway';
import { RealtimeTransport } from '../src/common/realtime/realtime.transport';
import { RealtimeEmitter } from '../src/common/realtime/realtime.emitter';
import { EVENTS } from '../src/common/realtime/realtime.rooms';

const SECRETO = 'e2e-realtime-secret-do-not-use-in-prod';

const EMPRESA_A = 'company-a';
const EMPRESA_B = 'company-b';
const CONV_A = 'conv-de-a';
const CONV_B = 'conv-de-b';

/**
 * Tiempo real con sockets DE VERDAD y dos empresas simultáneas.
 *
 * Los unitarios comprueban la lógica con dobles; esto comprueba el sistema
 * completo —handshake, salas, autorización y emisión— porque la propiedad que
 * se está defendiendo (una empresa jamás recibe eventos de otra) depende de
 * que todas esas piezas encajen, no de cada una por separado.
 *
 * Sin Redis: un solo proceso basta para demostrar el aislamiento. El puente de
 * Redis solo cambia POR DÓNDE viaja el evento, no a quién alcanza.
 */
describe('Tiempo real (e2e, sockets reales, dos empresas)', () => {
  let app: INestApplication;
  let emitter: RealtimeEmitter;
  let jwt: JwtService;
  let url: string;
  const abiertos: Socket[] = [];

  // Conversaciones de dos empresas distintas. La consulta del gateway filtra
  // por companyId, así que pedir la de otra empresa no encuentra fila.
  const conversaciones = [
    { id: CONV_A, companyId: EMPRESA_A },
    { id: CONV_B, companyId: EMPRESA_B },
  ];

  const prismaFalso = {
    conversation: {
      findFirst: ({ where }: any) =>
        Promise.resolve(
          conversaciones.find(
            (c) => c.id === where.id && c.companyId === where.companyId,
          ) ?? null,
        ),
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: SECRETO })],
      providers: [
        { provide: PrismaService, useValue: prismaFalso },
        RealtimeAuthService,
        RealtimeGateway,
        RealtimeTransport,
        RealtimeEmitter,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);

    const server = app.getHttpServer() as { address: () => AddressInfo };
    url = `http://127.0.0.1:${server.address().port}/realtime`;
    emitter = app.get(RealtimeEmitter);
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    for (const s of abiertos) s.close();
    await app?.close();
  });

  afterEach(() => {
    while (abiertos.length) abiertos.pop()?.close();
  });

  const token = (userId: string, companyId: string | null) =>
    jwt.sign({ sub: userId, companyId, role: 'AGENT' });

  /** Conecta y resuelve cuando el handshake termina, en un sentido u otro. */
  const conectar = (auth: Record<string, unknown>): Promise<Socket> =>
    new Promise((resolve, reject) => {
      const socket = io(url, {
        transports: ['websocket'],
        auth,
        reconnection: false,
        timeout: 4_000,
      });
      abiertos.push(socket);
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', (e) => reject(e));
      socket.on('disconnect', () => reject(new Error('desconectado')));
    });

  /** Recoge los eventos recibidos en una ventana de tiempo. */
  const recoger = (socket: Socket, evento: string) => {
    const recibidos: unknown[] = [];
    socket.on(evento, (p) => recibidos.push(p));
    return recibidos;
  };

  const esperar = (ms = 250) => new Promise((r) => setTimeout(r, ms));

  describe('handshake', () => {
    it('un token válido de empresa abre canal', async () => {
      const socket = await conectar({ token: token('u-a', EMPRESA_A) });

      expect(socket.connected).toBe(true);
    });

    it('sin token no se abre canal', async () => {
      await expect(conectar({})).rejects.toBeDefined();
    });

    it('con un token firmado con otro secreto no se abre canal', async () => {
      const falsificado = new JwtService({ secret: 'otro-secreto' }).sign({
        sub: 'u-x',
        companyId: EMPRESA_B,
      });

      await expect(conectar({ token: falsificado })).rejects.toBeDefined();
    });

    it('un SUPER_ADMIN de plataforma (sin empresa) no obtiene canal', async () => {
      await expect(
        conectar({ token: token('plat-1', null) }),
      ).rejects.toBeDefined();
    });
  });

  describe('aislamiento entre empresas', () => {
    it('un evento de empresa NO llega a la otra empresa', async () => {
      const [a, b] = await Promise.all([
        conectar({ token: token('u-a', EMPRESA_A) }),
        conectar({ token: token('u-b', EMPRESA_B) }),
      ]);
      const enA = recoger(a, EVENTS.LEAD_UPDATED);
      const enB = recoger(b, EVENTS.LEAD_UPDATED);

      emitter.leadUpdated(EMPRESA_A, 'lead-1', 'stage-2');
      await esperar();

      expect(enA).toHaveLength(1);
      expect(enB).toHaveLength(0);
    });

    it('mandar el companyId ajeno en el handshake NO cambia de empresa', async () => {
      // El intento más obvio desde el navegador: cambiar un valor a mano.
      const b = await conectar({
        token: token('u-b', EMPRESA_B),
        companyId: EMPRESA_A,
      });
      const enB = recoger(b, EVENTS.LEAD_UPDATED);

      emitter.leadUpdated(EMPRESA_A, 'lead-1');
      await esperar();

      expect(enB).toHaveLength(0);
    });

    it('una notificación llega SOLO a su destinatario, no a su compañero de empresa', async () => {
      const [uno, otro] = await Promise.all([
        conectar({ token: token('u-a1', EMPRESA_A) }),
        conectar({ token: token('u-a2', EMPRESA_A) }),
      ]);
      const enUno = recoger(uno, EVENTS.NOTIFICATION_CREATED);
      const enOtro = recoger(otro, EVENTS.NOTIFICATION_CREATED);

      emitter.notificationCreated('u-a1', 'notif-1');
      await esperar();

      expect(enUno).toHaveLength(1);
      expect(enOtro).toHaveLength(0);
    });
  });

  describe('suscripción a conversación', () => {
    const suscribir = (socket: Socket, conversationId: string) =>
      new Promise<{ ok: boolean }>((resolve) =>
        socket.emit('conversation:subscribe', { conversationId }, resolve),
      );

    it('acepta una conversación de la propia empresa y entrega sus mensajes', async () => {
      const a = await conectar({ token: token('u-a', EMPRESA_A) });
      const recibidos = recoger(a, EVENTS.MESSAGE_CREATED);

      expect(await suscribir(a, CONV_A)).toEqual({ ok: true });
      emitter.messageCreated(EMPRESA_A, CONV_A, {
        id: 'm1',
        direction: 'INBOUND',
        type: 'text',
        createdAt: new Date(),
      });
      await esperar();

      expect(recibidos).toHaveLength(1);
    });

    it('RECHAZA la conversación de otra empresa y no entrega sus mensajes', async () => {
      // El escenario que da sentido a todo: el cliente de B conoce el id de una
      // conversación de A —por una captura, un enlace, un log— e intenta oírla.
      const b = await conectar({ token: token('u-b', EMPRESA_B) });
      const recibidos = recoger(b, EVENTS.MESSAGE_CREATED);

      expect(await suscribir(b, CONV_A)).toEqual({ ok: false });
      emitter.messageCreated(EMPRESA_A, CONV_A, {
        id: 'm1',
        direction: 'INBOUND',
        type: 'text',
        createdAt: new Date(),
      });
      await esperar();

      expect(recibidos).toHaveLength(0);
    });

    it('tras desuscribirse deja de recibir el hilo', async () => {
      const a = await conectar({ token: token('u-a', EMPRESA_A) });
      await suscribir(a, CONV_A);
      const recibidos = recoger(a, EVENTS.MESSAGE_STATUS_CHANGED);

      await new Promise((r) =>
        a.emit('conversation:unsubscribe', { conversationId: CONV_A }, r),
      );
      emitter.messageStatusChanged(EMPRESA_A, CONV_A, 'm1', 'READ');
      await esperar();

      expect(recibidos).toHaveLength(0);
    });

    it('el cuerpo del mensaje no viaja por el canal', async () => {
      const a = await conectar({ token: token('u-a', EMPRESA_A) });
      await suscribir(a, CONV_A);
      const recibidos = recoger(a, EVENTS.MESSAGE_CREATED);

      emitter.messageCreated(EMPRESA_A, CONV_A, {
        id: 'm1',
        direction: 'INBOUND',
        type: 'text',
        createdAt: new Date(),
        ...({ body: 'contenido privado' } as never),
      });
      await esperar();

      expect(JSON.stringify(recibidos)).not.toContain('contenido privado');
    });
  });

  describe('reconexión y latido', () => {
    it('responde al ping explícito', async () => {
      const a = await conectar({ token: token('u-a', EMPRESA_A) });

      const respuesta = await new Promise<{ pong: number }>((r) =>
        a.emit('ping', {}, r),
      );

      expect(respuesta.pong).toBeGreaterThan(0);
    });

    it('al reconectar vuelve a sus salas de empresa y usuario sin pedir nada', async () => {
      const a = await conectar({ token: token('u-a', EMPRESA_A) });
      a.disconnect();
      const reconectado = await conectar({ token: token('u-a', EMPRESA_A) });
      const recibidos = recoger(reconectado, EVENTS.TASK_UPDATED);

      emitter.taskUpdated(EMPRESA_A, 'task-1', 'u-a');
      await esperar();

      // Dos veces: por la sala de empresa y por la personal. Que llegue
      // duplicado es aceptable —el cliente solo recarga—, que no llegue no.
      expect(recibidos.length).toBeGreaterThan(0);
    });

    it('la suscripción al hilo NO sobrevive a la reconexión: hay que volver a pedirla', async () => {
      // Las salas viven en el servidor y mueren con el socket. Es justo por
      // esto que el cliente reenvía la suscripción en cada 'connect'.
      const a = await conectar({ token: token('u-a', EMPRESA_A) });
      await new Promise((r) =>
        a.emit('conversation:subscribe', { conversationId: CONV_A }, r),
      );
      a.disconnect();

      const reconectado = await conectar({ token: token('u-a', EMPRESA_A) });
      const recibidos = recoger(reconectado, EVENTS.MESSAGE_STATUS_CHANGED);
      emitter.messageStatusChanged(EMPRESA_A, CONV_A, 'm1', 'READ');
      await esperar();

      expect(recibidos).toHaveLength(0);
    });
  });
});
