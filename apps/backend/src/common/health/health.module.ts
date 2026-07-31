import { Global, Module } from '@nestjs/common';
import { HeartbeatService } from './heartbeat.service';
import { SystemHealthService } from './system-health.service';

/**
 * Observabilidad de los componentes de fondo.
 *
 * Global porque el controlador de health vive en la raiz y el latido lo
 * escribe el worker: ambos extremos estan fuera de cualquier modulo de
 * negocio.
 */
@Global()
@Module({
  providers: [HeartbeatService, SystemHealthService],
  exports: [HeartbeatService, SystemHealthService],
})
export class HealthModule {}
