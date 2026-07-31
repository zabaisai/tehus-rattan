import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RealtimeAuthService } from './realtime.auth';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeEmitter } from './realtime.emitter';
import { RealtimeTransport } from './realtime.transport';

/**
 * Tiempo real. Global porque cualquier módulo de negocio puede necesitar
 * emitir, y obligarles a importarlo uno a uno solo añadiría ceremonia.
 *
 * El JwtModule se configura con el MISMO secreto que la API: un token válido
 * para REST debe serlo para el canal, y al revés. Dos secretos distintos
 * abrirían la puerta a que uno caducara sin que el otro se enterara.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  providers: [
    RealtimeAuthService,
    RealtimeGateway,
    RealtimeTransport,
    RealtimeEmitter,
  ],
  exports: [RealtimeEmitter],
})
export class RealtimeModule {}
