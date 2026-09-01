import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeAuthService, type RealtimeIdentity } from './realtime.auth';
import { rooms } from './realtime.rooms';
import { buildAllowedOrigins } from '../security/allowed-origins';

/**
 * Mismo allowlist EXACTO que la API REST. Un gateway abierto a cualquier
 * origen sería una vía de exfiltración: una página de terceros podría abrir el
 * canal con el token de la víctima y escuchar su empresa entera. El decorador
 * se evalúa al cargar el módulo, así que se resuelve aquí una sola vez.
 */
const ORIGENES_PERMITIDOS = buildAllowedOrigins(process.env);

/** Identidad ya validada, guardada en el propio socket. */
type SocketConIdentidad = Socket & { data: { identity?: RealtimeIdentity } };

/**
 * Gateway de tiempo real.
 *
 * MODELO DE SALAS
 *   company:<id>                        — todos los conectados de la empresa
 *   user:<id>                           — un usuario, en todas sus pestañas
 *   company:<id>:conversation:<convId>  — el hilo abierto
 *
 * El nombre de la sala de conversación incluye el companyId a propósito:
 * incluso si alguien lograra colarse con un id de conversación ajeno, la sala
 * a la que entraría no sería aquella a la que emite la empresa dueña. Es una
 * segunda barrera además de la comprobación explícita.
 *
 * El cliente NUNCA elige su empresa: se une automáticamente a las salas
 * derivadas de su token en el momento de conectar. La única suscripción bajo
 * demanda es la de conversación, y va precedida de una comprobación en base
 * de que esa conversación pertenece a su empresa.
 *
 * CORS: se reutiliza el mismo allowlist de la API. Un gateway abierto a
 * cualquier origen sería una vía de exfiltración desde una página de terceros.
 */
@WebSocketGateway({
  namespace: '/realtime',
  cors: {
    origin: (
      origen: string | undefined,
      cb: (e: Error | null, ok?: boolean) => void,
    ) =>
      // Sin Origin (cliente no navegador) se permite: la autenticación la hace
      // el token del handshake, no la cabecera.
      cb(null, !origen || ORIGENES_PERMITIDOS.includes(origen)),
    credentials: true,
  },
  // El cliente late cada 25 s y se considera muerto a los 60 s sin respuesta.
  // Con estos valores una reconexión tras un corte de red se nota en menos de
  // un minuto, sin castigar a móviles con conexión intermitente.
  pingInterval: 25_000,
  pingTimeout: 60_000,
})
export class RealtimeGateway
  implements OnGatewayInit<Server>, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly auth: RealtimeAuthService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * La autenticación se hace en el MIDDLEWARE del handshake, no al conectar.
   *
   * La diferencia importa: un socket rechazado aquí nunca llega a estar
   * conectado y el cliente recibe `connect_error`, señal inequívoca de que no
   * hay canal. Si se rechazara ya dentro de `handleConnection`, el cliente
   * vería primero un `connect` y solo después un `disconnect`, y durante esos
   * milisegundos se creería en vivo. El respaldo por polling depende de que el
   * cliente sepa la verdad sobre su propio estado.
   */
  afterInit(server: Server): void {
    server.use((socket, next) => {
      // authenticate ahora valida también la sesión contra la base (async),
      // así que un token cuya sesión fue revocada no abre canal nuevo.
      this.auth
        .authenticate(socket.handshake)
        .then((identity) => {
          if (!identity) {
            next(new Error('unauthorized'));
            return;
          }
          (socket as SocketConIdentidad).data.identity = identity;
          next();
        })
        .catch(() => next(new Error('unauthorized')));
    });
  }

  handleConnection(client: SocketConIdentidad): void {
    const identity = client.data.identity;

    if (!identity) {
      // Defensa en profundidad: si algún día se retirase el middleware, un
      // socket sin identidad se cierra en vez de quedarse vivo y mudo.
      client.disconnect(true);
      return;
    }

    void client.join(rooms.company(identity.companyId));
    void client.join(rooms.user(identity.userId));
  }

  handleDisconnect(client: SocketConIdentidad): void {
    // socket.io saca al cliente de sus salas automáticamente. No hay estado
    // propio que limpiar, y eso es deliberado: el gateway no guarda nada.
    void client;
  }

  /**
   * Suscripción a una conversación concreta.
   *
   * La comprobación de pertenencia se hace CONTRA LA BASE y con el companyId
   * del token, no con uno enviado por el cliente. Un id de otra empresa
   * simplemente no encuentra fila y la suscripción se rechaza.
   */
  @SubscribeMessage('conversation:subscribe')
  async suscribirConversacion(
    @ConnectedSocket() client: SocketConIdentidad,
    @MessageBody() body: { conversationId?: string },
  ): Promise<{ ok: boolean }> {
    const identity = client.data.identity;
    const conversationId = body?.conversationId;

    if (!identity || !conversationId) return { ok: false };

    const conversacion = await this.prisma.conversation.findFirst({
      where: { id: conversationId, companyId: identity.companyId },
      select: { id: true },
    });

    if (!conversacion) {
      this.logger.warn(
        'Suscripción a conversación rechazada: no pertenece a la empresa del token',
      );
      return { ok: false };
    }

    await client.join(rooms.conversation(identity.companyId, conversationId));
    return { ok: true };
  }

  @SubscribeMessage('conversation:unsubscribe')
  async desuscribirConversacion(
    @ConnectedSocket() client: SocketConIdentidad,
    @MessageBody() body: { conversationId?: string },
  ): Promise<{ ok: boolean }> {
    const identity = client.data.identity;
    if (!identity || !body?.conversationId) return { ok: false };

    // Salir no necesita comprobación: como mucho sale de una sala en la que
    // nunca estuvo, que es inofensivo.
    await client.leave(
      rooms.conversation(identity.companyId, body.conversationId),
    );
    return { ok: true };
  }

  /** Latido explícito, además del ping del protocolo. */
  @SubscribeMessage('ping')
  responderPing(): { pong: number } {
    return { pong: Date.now() };
  }
}
