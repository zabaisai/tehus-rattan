import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { RELEASE_INFO } from './common/release/release.info';

// A hung database must not hang the readiness probe indefinitely.
const READINESS_TIMEOUT_MS = 3000;

@Injectable()
export class AppService {
  constructor(private prisma: PrismaService) {}

  getHello(): string {
    return 'Hello World!';
  }

  // Liveness: the process is up and serving. Deliberately does NOT touch the
  // database — a liveness probe that fails on a DB blip would make an
  // orchestrator kill an otherwise-healthy container.
  getLiveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  // Readiness: the app can actually serve traffic, i.e. PostgreSQL is reachable.
  // Bounded by a timeout so a stuck connection returns 503 instead of hanging.
  // Never returns the raw DB error, versions, or env — only a status.
  async getReadiness(): Promise<{ status: 'ok' }> {
    try {
      await this.withTimeout(
        this.prisma.$queryRaw`SELECT 1`,
        READINESS_TIMEOUT_MS,
      );
    } catch {
      throw new ServiceUnavailableException('Service unavailable');
    }
    return { status: 'ok' };
  }

  // Backward-compatible alias used by the container/edge health probes and
  // deploy scripts: same readiness semantics as before this split.
  getHealth(): Promise<{ status: 'ok' }> {
    return this.getReadiness();
  }

  // Minimal, safe deploy-traceability: the git SHA + build time only. Never a
  // secret. Values are the literal 'unknown' when not injected at build.
  getVersion(): { status: 'ok'; release: string; builtAt: string } {
    return {
      status: 'ok',
      release: RELEASE_INFO.sha,
      builtAt: RELEASE_INFO.builtAt,
    };
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_resolve, reject) =>
        setTimeout(() => reject(new Error('readiness timeout')), ms),
      ),
    ]);
  }
}
