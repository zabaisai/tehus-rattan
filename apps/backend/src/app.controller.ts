import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AppService } from './app.service';

// Liveness/readiness/version endpoints. Exempt from rate limiting so uptime
// probes and load balancers can poll them freely without ever being throttled.
@SkipThrottle()
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

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

  // Minimal deployed-version info (git SHA + build time). Safe to expose.
  @Get('health/version')
  getVersion() {
    return this.appService.getVersion();
  }
}
