import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DeviceType, Role, UserSessionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformAuditLogService } from './platform-audit-log.service';
import { SESSION_INACTIVITY_EXPIRY_MS } from '../sessions/sessions.constants';

export interface ActivityAuditActor {
  actorUserId: string;
  actorRole: Role;
  ipAddress?: string | null;
  userAgent?: string | null;
}

interface ListSessionsFilters {
  page?: number;
  pageSize?: number;
  userId?: string;
  status?: string;
  deviceType?: string;
  dateFrom?: string;
  dateTo?: string;
}

const VALID_SESSION_STATUSES = Object.values(UserSessionStatus);
const VALID_DEVICE_TYPES = Object.values(DeviceType);

const SESSION_LIST_SELECT = {
  id: true,
  userId: true,
  status: true,
  ipPreview: true,
  userAgent: true,
  browser: true,
  operatingSystem: true,
  deviceType: true,
  firstSeenAt: true,
  lastSeenAt: true,
  lastLoginAt: true,
  lastActivityAt: true,
  loggedOutAt: true,
  revokedAt: true,
  revokedByUserId: true,
  user: { select: { id: true, name: true, email: true } },
} as const;

@Injectable()
export class PlatformActivityService {
  constructor(
    private prisma: PrismaService,
    private auditLogService: PlatformAuditLogService,
  ) {}

  async getSummary() {
    await this.expireOverdueSessions();

    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const sevenDaysAgo = daysAgo(7);
    const thirtyDaysAgo = daysAgo(30);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [
      companiesActiveToday,
      companiesActive7d,
      companiesActive30d,
      totalCompanies,
      activeSessions,
      recognizedDevices,
      recentFailedLogins,
    ] = await Promise.all([
      this.countDistinctActiveCompanies(startOfToday),
      this.countDistinctActiveCompanies(sevenDaysAgo),
      this.countDistinctActiveCompanies(thirtyDaysAgo),
      this.prisma.company.count({ where: { status: { not: 'DELETED' } } }),
      this.prisma.userSession.count({ where: { status: 'ACTIVE' } }),
      this.prisma.userSession.count(),
      this.prisma.loginEvent.count({
        where: { status: 'FAILED', createdAt: { gte: twentyFourHoursAgo } },
      }),
    ]);

    return {
      companiesActiveToday,
      companiesActive7d,
      companiesActive30d,
      companiesInactive30d: Math.max(0, totalCompanies - companiesActive30d),
      totalCompanies,
      activeSessions,
      recognizedDevices,
      recentFailedLogins,
    };
  }

  async getCompanyActivity(companyId: string) {
    const trimmedId = this.requireNonBlank(
      companyId,
      'companyId no puede estar vacio',
    );

    const company = await this.prisma.company.findUnique({
      where: { id: trimmedId },
      select: { id: true, name: true },
    });
    if (!company) throw new NotFoundException('Empresa no encontrada');

    await this.expireOverdueSessions();

    const [sessionCount, loginEventCount, users, sessions] = await Promise.all([
      this.prisma.userSession.count({ where: { companyId: trimmedId } }),
      this.prisma.loginEvent.count({ where: { companyId: trimmedId } }),
      this.prisma.user.findMany({
        where: { companyId: trimmedId },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
        },
      }),
      this.prisma.userSession.findMany({
        where: { companyId: trimmedId },
        select: {
          userId: true,
          deviceId: true,
          status: true,
          lastActivityAt: true,
        },
      }),
    ]);

    // A company with zero rows in either table has no recorded history at
    // all — never assumed to mean "nobody has ever logged in" (they may
    // predate this feature), only that nothing is known yet.
    const hasHistoricalData = sessionCount > 0 || loginEventCount > 0;
    if (!hasHistoricalData) {
      return {
        company,
        hasHistoricalData: false,
        message: 'Sin información histórica disponible',
      };
    }

    const now = Date.now();
    const activeUserIdsWithin = (days: number) => {
      const cutoff = now - days * 24 * 60 * 60 * 1000;
      return new Set(
        sessions
          .filter((s) => s.lastActivityAt.getTime() >= cutoff)
          .map((s) => s.userId),
      );
    };

    const usersWithAnySession = new Set(sessions.map((s) => s.userId));
    const usersNeverLoggedIn = users
      .filter((u) => !usersWithAnySession.has(u.id))
      .map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role }));

    const lastActivityAt = sessions.reduce<Date | null>(
      (max, s) => (!max || s.lastActivityAt > max ? s.lastActivityAt : max),
      null,
    );

    const historyDays = 14;
    const historyStart = new Date(now - historyDays * 24 * 60 * 60 * 1000);
    const recentSuccessEvents = await this.prisma.loginEvent.findMany({
      where: {
        companyId: trimmedId,
        status: 'SUCCESS',
        createdAt: { gte: historyStart },
      },
      select: { createdAt: true },
    });

    const recentLogins = await this.prisma.loginEvent.findMany({
      where: { companyId: trimmedId, status: 'SUCCESS' },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        createdAt: true,
        ipPreview: true,
        browser: true,
        operatingSystem: true,
        deviceType: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });

    return {
      company,
      hasHistoricalData: true,
      lastActivityAt,
      activityStatus: computeActivityStatus(lastActivityAt),
      totalUsers: users.length,
      usersActive7d: activeUserIdsWithin(7).size,
      usersActive30d: activeUserIdsWithin(30).size,
      usersActive90d: activeUserIdsWithin(90).size,
      usersNeverLoggedIn,
      totalSessions: sessions.length,
      activeSessions: sessions.filter((s) => s.status === 'ACTIVE').length,
      recognizedDevices: new Set(sessions.map((s) => s.deviceId)).size,
      recentLogins,
      dailyHistory: buildDailyHistory(
        recentSuccessEvents.map((e) => e.createdAt),
        historyDays,
      ),
    };
  }

  async listCompanySessions(companyId: string, filters: ListSessionsFilters) {
    const trimmedId = this.requireNonBlank(
      companyId,
      'companyId no puede estar vacio',
    );

    const company = await this.prisma.company.findUnique({
      where: { id: trimmedId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException('Empresa no encontrada');

    await this.expireOverdueSessions();

    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));

    const where: {
      companyId: string;
      userId?: string;
      status?: UserSessionStatus;
      deviceType?: DeviceType;
      lastActivityAt?: { gte?: Date; lte?: Date };
    } = { companyId: trimmedId };

    if (filters.userId?.trim()) where.userId = filters.userId.trim();
    if (filters.status !== undefined)
      where.status = this.parseSessionStatus(filters.status);
    if (filters.deviceType !== undefined)
      where.deviceType = this.parseDeviceType(filters.deviceType);
    if (filters.dateFrom || filters.dateTo) {
      where.lastActivityAt = {};
      if (filters.dateFrom)
        where.lastActivityAt.gte = this.parseDate(filters.dateFrom, 'dateFrom');
      if (filters.dateTo)
        where.lastActivityAt.lte = this.parseDate(filters.dateTo, 'dateTo');
    }

    const [total, items] = await Promise.all([
      this.prisma.userSession.count({ where }),
      this.prisma.userSession.findMany({
        where,
        orderBy: { lastActivityAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: SESSION_LIST_SELECT,
      }),
    ]);

    return {
      items,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  async revokeSession(sessionId: string, actor: ActivityAuditActor) {
    const trimmedId = this.requireNonBlank(
      sessionId,
      'sessionId no puede estar vacio',
    );

    const session = await this.prisma.userSession.findUnique({
      where: { id: trimmedId },
      select: {
        id: true,
        status: true,
        userId: true,
        companyId: true,
        deviceId: true,
      },
    });
    if (!session) throw new NotFoundException('Sesión no encontrada');

    return this.prisma.$transaction(async (tx) => {
      // Atomic conditional revoke: if the session was already closed
      // (logged out, revoked, or lazily expired) between the read above and
      // here, `count` comes back 0 and this fails instead of silently
      // overwriting whatever already closed it.
      const result = await tx.userSession.updateMany({
        where: { id: trimmedId, status: 'ACTIVE' },
        data: {
          status: 'REVOKED',
          revokedAt: new Date(),
          revokedByUserId: actor.actorUserId,
        },
      });
      if (result.count === 0) {
        throw new BadRequestException(
          'Solo se pueden revocar sesiones activas',
        );
      }

      await this.auditLogService.record(tx, {
        actorUserId: actor.actorUserId,
        actorRole: actor.actorRole,
        affectedCompanyId: session.companyId,
        action: 'REVOKE_SESSION',
        entityType: 'UserSession',
        entityId: trimmedId,
        metadata: {
          sessionId: trimmedId,
          userId: session.userId,
          deviceId: session.deviceId,
        },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return tx.userSession.findUniqueOrThrow({
        where: { id: trimmedId },
        select: SESSION_LIST_SELECT,
      });
    });
  }

  async revokeAllSessionsForUser(userId: string, actor: ActivityAuditActor) {
    const trimmedId = this.requireNonBlank(
      userId,
      'userId no puede estar vacio',
    );

    const user = await this.prisma.user.findUnique({
      where: { id: trimmedId },
      select: { id: true, companyId: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    return this.prisma.$transaction(async (tx) => {
      const result = await tx.userSession.updateMany({
        where: { userId: trimmedId, status: 'ACTIVE' },
        data: {
          status: 'REVOKED',
          revokedAt: new Date(),
          revokedByUserId: actor.actorUserId,
        },
      });

      await this.auditLogService.record(tx, {
        actorUserId: actor.actorUserId,
        actorRole: actor.actorRole,
        affectedCompanyId: user.companyId,
        action: 'REVOKE_ALL_USER_SESSIONS',
        entityType: 'User',
        entityId: trimmedId,
        metadata: { userId: trimmedId, revokedCount: result.count },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return { revokedCount: result.count };
    });
  }

  async revokeAllSessionsForCompany(
    companyId: string,
    actor: ActivityAuditActor,
  ) {
    const trimmedId = this.requireNonBlank(
      companyId,
      'companyId no puede estar vacio',
    );

    const company = await this.prisma.company.findUnique({
      where: { id: trimmedId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException('Empresa no encontrada');

    return this.prisma.$transaction(async (tx) => {
      const result = await tx.userSession.updateMany({
        where: { companyId: trimmedId, status: 'ACTIVE' },
        data: {
          status: 'REVOKED',
          revokedAt: new Date(),
          revokedByUserId: actor.actorUserId,
        },
      });

      await this.auditLogService.record(tx, {
        actorUserId: actor.actorUserId,
        actorRole: actor.actorRole,
        affectedCompanyId: trimmedId,
        action: 'REVOKE_ALL_COMPANY_SESSIONS',
        entityType: 'Company',
        entityId: trimmedId,
        metadata: { companyId: trimmedId, revokedCount: result.count },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return { revokedCount: result.count };
    });
  }

  // Lazily flips ACTIVE rows that have been inactive past the threshold to
  // EXPIRED — same pattern as InvitationCodesService.expireOverdue(), run
  // before every read so status shown/enforced is never stale.
  private async expireOverdueSessions(): Promise<void> {
    const cutoff = new Date(Date.now() - SESSION_INACTIVITY_EXPIRY_MS);
    await this.prisma.userSession.updateMany({
      where: { status: 'ACTIVE', lastSeenAt: { lt: cutoff } },
      data: { status: 'EXPIRED' },
    });
  }

  private async countDistinctActiveCompanies(since: Date): Promise<number> {
    const rows = await this.prisma.userSession.findMany({
      where: { lastActivityAt: { gte: since }, companyId: { not: null } },
      distinct: ['companyId'],
      select: { companyId: true },
    });
    return rows.length;
  }

  private parseSessionStatus(value: string): UserSessionStatus {
    if (!VALID_SESSION_STATUSES.includes(value as UserSessionStatus)) {
      throw new BadRequestException(
        'status debe ser ACTIVE, LOGGED_OUT, REVOKED o EXPIRED',
      );
    }
    return value as UserSessionStatus;
  }

  private parseDeviceType(value: string): DeviceType {
    if (!VALID_DEVICE_TYPES.includes(value as DeviceType)) {
      throw new BadRequestException(
        'deviceType debe ser DESKTOP, MOBILE, TABLET o UNKNOWN',
      );
    }
    return value as DeviceType;
  }

  private parseDate(value: string, field: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${field} no es una fecha válida`);
    }
    return date;
  }

  private requireNonBlank(value: string | undefined, message: string): string {
    if (!value?.trim()) {
      throw new BadRequestException(message);
    }
    return value.trim();
  }
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function computeActivityStatus(
  lastActivityAt: Date | null,
): 'ACTIVE_TODAY' | 'ACTIVE_WEEK' | 'ACTIVE_MONTH' | 'INACTIVE' {
  if (!lastActivityAt) return 'INACTIVE';
  const diffDays =
    (Date.now() - lastActivityAt.getTime()) / (24 * 60 * 60 * 1000);
  if (diffDays < 1) return 'ACTIVE_TODAY';
  if (diffDays <= 7) return 'ACTIVE_WEEK';
  if (diffDays <= 30) return 'ACTIVE_MONTH';
  return 'INACTIVE';
}

function buildDailyHistory(
  dates: Date[],
  days: number,
): { date: string; count: number }[] {
  const buckets = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    buckets.set(d.toISOString().slice(0, 10), 0);
  }
  for (const date of dates) {
    const key = date.toISOString().slice(0, 10);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return Array.from(buckets.entries()).map(([date, count]) => ({
    date,
    count,
  }));
}
