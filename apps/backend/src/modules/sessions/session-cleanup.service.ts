import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { CLOSED_SESSION_RETENTION_DAYS, LOGIN_EVENT_RETENTION_DAYS } from './sessions.constants';

// Retention policy — must be reflected in the privacy policy before this
// ships to production:
//   - LoginEvent rows: deleted after LOGIN_EVENT_RETENTION_DAYS (180) days.
//   - UserSession rows that are LOGGED_OUT/REVOKED/EXPIRED: deleted after
//     CLOSED_SESSION_RETENTION_DAYS (180) days from when they closed.
//   - ACTIVE sessions are never touched by this job, regardless of age.
//
// This job only runs on a live, continuously-running instance (staging/
// production) via @Cron below. It is intentionally never invoked manually
// against staging or production data as part of this feature's rollout —
// only exercised in this codebase via unit tests against a mocked Prisma
// client.
@Injectable()
export class SessionCleanupService {
  private readonly logger = new Logger(SessionCleanupService.name);

  constructor(private prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleScheduledCleanup(): Promise<void> {
    await this.cleanupExpiredLoginEvents();
    await this.cleanupClosedSessions();
  }

  async cleanupExpiredLoginEvents(): Promise<number> {
    const cutoff = daysAgo(LOGIN_EVENT_RETENTION_DAYS);
    const result = await this.prisma.loginEvent.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    if (result.count > 0) {
      this.logger.log(`Eliminados ${result.count} eventos de login vencidos (retención de ${LOGIN_EVENT_RETENTION_DAYS} días)`);
    }
    return result.count;
  }

  async cleanupClosedSessions(): Promise<number> {
    const cutoff = daysAgo(CLOSED_SESSION_RETENTION_DAYS);
    const result = await this.prisma.userSession.deleteMany({
      where: {
        status: { in: ['LOGGED_OUT', 'REVOKED', 'EXPIRED'] },
        OR: [
          { loggedOutAt: { lt: cutoff } },
          { AND: [{ loggedOutAt: null }, { revokedAt: { lt: cutoff } }] },
          { AND: [{ loggedOutAt: null }, { revokedAt: null }, { updatedAt: { lt: cutoff } }] },
        ],
      },
    });
    if (result.count > 0) {
      this.logger.log(`Eliminadas ${result.count} sesiones cerradas vencidas (retención de ${CLOSED_SESSION_RETENTION_DAYS} días)`);
    }
    return result.count;
  }
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}
