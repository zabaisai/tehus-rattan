import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AppService } from './app.service';
import { QueueHealthService } from './common/queue/queue.health';
import { QueuePingService } from './common/queue/queue.ping';

// Liveness/readiness/version endpoints. Exempt from rate limiting so uptime
// probes and load balancers can poll them freely without ever being throttled.
@SkipThrottle()
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly queueHealth: QueueHealthService,
    private readonly queuePing: QueuePingService,
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

  // Minimal deployed-version info (git SHA + build time). Safe to expose.
  @Get('health/version')
  getVersion() {
    return this.appService.getVersion();
  }
}
