import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

@Injectable()
export class AppService {
  constructor(private prisma: PrismaService) {}

  getHello(): string {
    return 'Hello World!';
  }

  // Used by Docker/Caddy healthchecks and uptime monitoring — deliberately
  // returns nothing beyond a status, never versions, env vars, or the raw
  // database error, even when the check fails.
  async getHealth(): Promise<{ status: 'ok' }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('Service unavailable');
    }
    return { status: 'ok' };
  }
}
