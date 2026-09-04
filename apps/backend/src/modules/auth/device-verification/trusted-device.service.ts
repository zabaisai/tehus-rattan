import { Injectable } from '@nestjs/common';
import type { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PlatformAuditLogService } from '../../platform/platform-audit-log.service';
import type { SessionRequestContext } from '../../sessions/utils/request-context.util';
import {
  generateOpaqueToken,
  hashToken,
} from '../../sessions/utils/token.util';
import {
  AUDIT_TRUSTED_DEVICE_CREATED,
  AUDIT_TRUSTED_DEVICE_REVOKED,
  TRUSTED_DEVICE_TOKEN_BYTES,
  TRUSTED_DEVICE_TTL_MS,
} from './device-verification.constants';

/** Escritor mínimo, para poder revocar dentro de una transacción ajena. */
export type TrustedDeviceWriter = Pick<PrismaService, 'trustedDevice'>;

/**
 * Dispositivos en los que la persona pidió no repetir el código.
 *
 * Un dispositivo confiable NO sustituye a la contraseña: solo evita el segundo
 * factor mientras siga vigente. El token es opaco, de 32 bytes, vive en una
 * cookie httpOnly y en base solo existe su SHA-256, así que leer la tabla no
 * permite fabricar una cookie válida.
 */
@Injectable()
export class TrustedDeviceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditLogService,
  ) {}

  /**
   * ¿Este token corresponde a un dispositivo vigente DE ESTE usuario?
   *
   * La búsqueda exige el `userId` además del hash: el token de una cuenta no
   * puede saltarse la verificación de otra aunque alguien mueva la cookie.
   * Renueva `lastUsedAt` para que la telemetría de sesiones tenga sentido, sin
   * extender la vigencia: los 30 días cuentan desde que se creó.
   */
  async isTrusted(userId: string, token: string | null): Promise<boolean> {
    if (!token) return false;
    const ahora = new Date();
    const fila = await this.prisma.trustedDevice.findFirst({
      where: {
        tokenHash: hashToken(token),
        userId,
        revokedAt: null,
        expiresAt: { gt: ahora },
      },
      select: { id: true },
    });
    if (!fila) return false;
    await this.prisma.trustedDevice
      .update({ where: { id: fila.id }, data: { lastUsedAt: ahora } })
      .catch(() => undefined);
    return true;
  }

  /**
   * Registra el dispositivo y devuelve el token en claro UNA vez: es lo único
   * que se escribe en la cookie y no vuelve a existir en ningún sitio.
   */
  async trustDevice(input: {
    user: { id: string; role: Role; companyId: string | null };
    context: SessionRequestContext;
  }): Promise<string> {
    const token = generateOpaqueToken(TRUSTED_DEVICE_TOKEN_BYTES);
    const ahora = new Date();
    const fila = await this.prisma.trustedDevice.create({
      data: {
        userId: input.user.id,
        tokenHash: hashToken(token),
        deviceIdHash: input.context.deviceIdHash,
        ipPreview: input.context.ipPreview,
        browser: input.context.browser,
        operatingSystem: input.context.operatingSystem,
        deviceType: input.context.deviceType,
        expiresAt: new Date(ahora.getTime() + TRUSTED_DEVICE_TTL_MS),
      },
      select: { id: true },
    });

    await this.audit
      .record(this.prisma, {
        actorUserId: input.user.id,
        actorRole: input.user.role,
        affectedCompanyId: input.user.companyId,
        action: AUDIT_TRUSTED_DEVICE_CREATED,
        entityType: 'User',
        entityId: input.user.id,
        metadata: {
          trustedDeviceId: fila.id,
          deviceType: input.context.deviceType,
          expiresAt: new Date(
            ahora.getTime() + TRUSTED_DEVICE_TTL_MS,
          ).toISOString(),
        },
        ipAddress: input.context.ipPreview ?? null,
      })
      .catch(() => undefined);

    return token;
  }

  /**
   * Revoca TODOS los dispositivos vigentes de una cuenta.
   *
   * Se llama en el mismo camino que la revocación de sesiones: restablecer la
   * contraseña, cerrar todas las sesiones o desactivar la cuenta. Si la
   * contraseña dejó de ser secreta, un dispositivo recordado no puede seguir
   * abriendo la puerta. Acepta el cliente de una transacción para escribirlo
   * junto al resto del cambio.
   */
  async revokeAllForUser(
    userId: string,
    writer: TrustedDeviceWriter | Prisma.TransactionClient = this.prisma,
  ): Promise<number> {
    const resultado = await writer.trustedDevice.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return resultado.count;
  }

  /**
   * Revocación pedida por la propia persona, auditada.
   *
   * Se separa de `revokeAllForUser` porque esa la llaman caminos que ya
   * escriben su propio registro (restablecer contraseña, revocación por
   * plataforma) y duplicarlo confundiría el historial.
   */
  async revokeAllForUserAudited(user: {
    id: string;
    role: Role;
    companyId: string | null;
  }): Promise<number> {
    const revocados = await this.revokeAllForUser(user.id);
    if (revocados > 0) {
      await this.audit
        .record(this.prisma, {
          actorUserId: user.id,
          actorRole: user.role,
          affectedCompanyId: user.companyId,
          action: AUDIT_TRUSTED_DEVICE_REVOKED,
          entityType: 'User',
          entityId: user.id,
          metadata: { revoked: revocados, scope: 'self' },
        })
        .catch(() => undefined);
    }
    return revocados;
  }

  /** Revoca solo el dispositivo cuyo token se presenta (cierre de sesión). */
  async revokeByToken(userId: string, token: string | null): Promise<number> {
    if (!token) return 0;
    const resultado = await this.prisma.trustedDevice.updateMany({
      where: { userId, tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return resultado.count;
  }
}
