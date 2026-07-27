import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Prisma connected to the database');
  }

  // Called by Nest's shutdown hooks (enableShutdownHooks in main.ts) on
  // SIGTERM/SIGINT so connections close cleanly on container stop / redeploy.
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
