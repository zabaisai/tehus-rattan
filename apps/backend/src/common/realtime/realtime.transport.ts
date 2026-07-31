import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Server } from 'socket.io';
import type { Redis } from 'ioredis';
import { RealtimeGateway } from './realtime.gateway';
import { isQueueWorker } from '../queue/queue.role';
import {
  conTiempoLimite,
  crearClientesRedis,
  usaPuenteRedis,
} from './realtime.redis';

/**
 * Por dónde salen los eventos, según el proceso.
 *
 *   BACKEND  → el servidor del gateway, con clientes de verdad conectados.
 *   WORKER   → un servidor de socket.io SIN HTTP, creado aquí, cuyo único
 *              cometido es publicar en Redis para que el backend lo reparta.
 *
 * El worker arranca con `createApplicationContext`: no tiene servidor HTTP y
 * por tanto su gateway nunca recibe un `server`. Si el emisor apuntara solo al
 * gateway, TODO lo que el worker procesa —que es justo lo que más urge ver:
 * mensajes entrantes, asignaciones, notificaciones— se emitiría al vacío. Ese
 * es exactamente el fallo silencioso que este servicio evita: no rompe nada,
 * simplemente no llega nada, y solo se nota en producción.
 */
@Injectable()
export class RealtimeTransport implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeTransport.name);
  private headless?: Server;
  private clientes: Redis[] = [];

  constructor(private readonly gateway: RealtimeGateway) {}

  /** El servidor por el que emitir, o `undefined` si aún no hay ninguno. */
  get server(): Server | undefined {
    return this.headless ?? this.gateway.server;
  }

  async onModuleInit(): Promise<void> {
    // Solo el worker necesita servidor propio. En el backend el gateway ya
    // tiene el suyo, con el adaptador de Redis puesto desde el arranque.
    if (!isQueueWorker() || !usaPuenteRedis()) return;

    try {
      const { pub, sub } = crearClientesRedis();
      this.clientes = [pub, sub];
      pub.on('error', () => undefined);
      sub.on('error', () => undefined);

      // Con límite de tiempo: un `ping` a un Redis inalcanzable no falla, se
      // queda reintentando, y el worker se colgaría a mitad del arranque sin
      // llegar nunca a consumir la cola.
      const conectado = await conTiempoLimite(
        Promise.all([pub.ping(), sub.ping()]),
      );
      if (!conectado) throw new Error('redis inalcanzable');

      // Sin puerto ni servidor HTTP: nadie se conecta aquí. Solo publica.
      const { createAdapter } = await import('@socket.io/redis-adapter');
      const server = new Server();
      server.adapter(createAdapter(pub, sub));
      this.headless = server;

      this.logger.log('Puente de tiempo real del worker conectado a Redis');
    } catch {
      this.logger.warn(
        'El worker no pudo abrir el puente de tiempo real: sus eventos no llegarán en vivo (el polling los cubre)',
      );
      await this.onModuleDestroy();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.headless?.close();
    this.headless = undefined;
    // `disconnect` y no `quit`: si nunca hubo conexión, `quit` espera a poder
    // enviar el comando y el cierre no termina nunca.
    for (const cliente of this.clientes) cliente.disconnect();
    this.clientes = [];
  }
}
