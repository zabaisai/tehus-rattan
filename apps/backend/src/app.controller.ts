import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { AppService } from './app.service';
import { QueueHealthService } from './common/queue/queue.health';
import { QueuePingService } from './common/queue/queue.ping';
import { SystemHealthService } from './common/health/system-health.service';

// Liveness/readiness/version endpoints. Exempt from rate limiting so uptime
// probes and load balancers can poll them freely without ever being throttled.
@SkipThrottle()
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly queueHealth: QueueHealthService,
    private readonly queuePing: QueuePingService,
    private readonly systemHealth: SystemHealthService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // Readiness (DB reachable). Kept for backward compatibility with the existing
  // Docker/Caddy healthchecks and deploy scripts.
  @Get('health')
  getHealth() {
    return this.appService.getHealth();
  }

  // Liveness — process up, no DB dependency.
  @Get('health/live')
  getLiveness() {
    return this.appService.getLiveness();
  }

  // Readiness — explicit name (DB SELECT 1 with timeout → 503 if unreachable).
  @Get('health/ready')
  getReadiness() {
    return this.appService.getReadiness();
  }

  // Salud de la cola durable, SEPARADA de readiness a proposito.
  //
  // Que Redis este caido no debe hacer fallar /health/ready: el CRM tiene que
  // seguir sirviendo conversaciones y pipelines aunque el procesamiento
  // diferido este degradado. Un readiness que devolviera 503 por Redis haria
  // que el orquestador reiniciase un backend sano y convertiria una
  // degradacion parcial en una caida total.
  //
  // Siempre responde 200: informa, no decide. La monitorizacion lee `state`.
  @Get('health/queue')
  getQueueHealth() {
    return this.queueHealth.check(() => this.queuePing.ping());
  }

  /**
   * Salud AGREGADA del sistema: base, cola, worker, outbox y tiempo real.
   *
   * Responde una pregunta distinta de `/health/ready`. Readiness dice "¿puede
   * esta instancia atender peticiones?" y por eso solo mira la base: devolver
   * 503 por Redis haria que el orquestador reiniciara un backend sano y
   * convertiria una degradacion parcial en una caida total.
   *
   * Este endpoint dice "¿esta el sistema haciendo TODO su trabajo?". Con Redis
   * o el worker caidos las conversaciones se siguen guardando y la interfaz
   * responde, asi que las sondas clasicas dan verde mientras los efectos de
   * cada mensaje —asignacion, automatizaciones, avisos— se acumulan sin
   * procesar. Aqui eso sale como `degraded`, nunca como `ok`.
   *
   * Codigo HTTP: 200 para `ok` y `degraded`; 503 solo para `down`. Degradado
   * NO es 503 a proposito, porque el CRM si atiende y tumbar la instancia
   * empeoraria las cosas. Quien monitorice debe leer el campo `status`, que
   * es el que manda.
   */
  @Get('health/status')
  async getSystemHealth(@Res({ passthrough: true }) res: Response) {
    const salud = await this.systemHealth.check();
    if (salud.status === 'down') res.status(503);
    return salud;
  }

  // Minimal deployed-version info (git SHA + build time). Safe to expose.
  @Get('health/version')
  getVersion() {
    return this.appService.getVersion();
  }
}
