import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { isSessionInactiveExpired } from '../../modules/sessions/sessions.constants';

export interface RealtimeIdentity {
  userId: string;
  companyId: string;
  role: string;
}

/**
 * Autenticación del handshake de WebSocket.
 *
 * EL PUNTO CRÍTICO DE TODO EL GATEWAY.
 *
 * La empresa se resuelve SIEMPRE del token, nunca de un parámetro que envíe el
 * cliente. Si se aceptara un `companyId` del handshake, cualquiera podría
 * escuchar las conversaciones de otra empresa cambiando un valor en el
 * navegador. Es exactamente la misma regla que ya rige la API REST, donde el
 * `companyId` sale del JWT y jamás del body.
 *
 * Un SUPER_ADMIN de plataforma tiene `companyId` null: no pertenece a ninguna
 * empresa y por tanto NO se le abre canal de tiempo real. Ver conversaciones
 * de una empresa exige una sesión de soporte activa y auditada, que es un
 * camino distinto y deliberadamente más lento.
 *
 * Además del token, se valida la SESIÓN (`sid`) contra la base, igual que
 * `JwtStrategy` en cada request REST: un token cuya sesión fue revocada,
 * cerrada o caducada por inactividad NO puede abrir un canal nuevo. Sin esta
 * comprobación, revocar una sesión no cerraría la puerta del tiempo real
 * mientras el access token (15 min) siguiera vivo.
 */
@Injectable()
export class RealtimeAuthService {
  private readonly logger = new Logger(RealtimeAuthService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Devuelve la identidad si el token es válido, pertenece a una empresa y su
   * sesión sigue activa; `null` en cualquier otro caso. Nunca lanza: un
   * handshake inválido se rechaza cerrando el socket, no tumbando el gateway.
   */
  async authenticate(handshake: {
    auth?: Record<string, unknown>;
    headers?: Record<string, unknown>;
  }): Promise<RealtimeIdentity | null> {
    const token = this.extractToken(handshake);
    if (!token) return null;

    try {
      const payload = this.jwt.verify<{
        sub?: string;
        companyId?: string | null;
        role?: string;
        sid?: string;
      }>(token, {
        // Allowlist explícito: el token es HMAC (HS256). Fijarlo evita
        // cualquier confusión de algoritmo.
        algorithms: ['HS256'],
      });

      // Sin empresa no hay canal. Aplica al SUPER_ADMIN de plataforma.
      if (!payload?.sub || !payload?.companyId) return null;
      // Sin sesión no hay forma de saber si sigue vigente: se rechaza, igual
      // que en la API REST.
      if (!payload?.sid) return null;

      const sesionVigente = await this.sesionSigueActiva(
        payload.sid,
        payload.sub,
        payload.companyId,
      );
      if (!sesionVigente) return null;

      return {
        userId: payload.sub,
        companyId: payload.companyId,
        role: payload.role ?? 'AGENT',
      };
    } catch {
      // Ni el token ni el motivo del fallo se registran: un token es un
      // secreto y su error puede contener fragmentos del mismo.
      this.logger.debug('Handshake de tiempo real rechazado');
      return null;
    }
  }

  /**
   * Misma regla que `JwtStrategy.validate`: la sesión debe existir, pertenecer
   * al usuario y a la empresa del token, estar ACTIVE, y no estar revocada,
   * cerrada ni caducada por inactividad.
   */
  private async sesionSigueActiva(
    sid: string,
    userId: string,
    companyId: string,
  ): Promise<boolean> {
    const session = await this.prisma.userSession.findUnique({
      where: { id: sid },
      select: {
        userId: true,
        companyId: true,
        status: true,
        revokedAt: true,
        loggedOutAt: true,
        lastSeenAt: true,
      },
    });

    if (!session) return false;
    if (session.userId !== userId) return false;
    if (session.companyId !== companyId) return false;
    if (session.status !== 'ACTIVE') return false;
    if (session.revokedAt) return false;
    if (session.loggedOutAt) return false;
    if (isSessionInactiveExpired(session.lastSeenAt)) return false;
    return true;
  }

  private extractToken(handshake: {
    auth?: Record<string, unknown>;
    headers?: Record<string, unknown>;
  }): string | null {
    // Preferido: `auth.token` del cliente de socket.io, que no viaja en la URL
    // y por tanto no acaba en logs de proxy ni en el historial del navegador.
    const desdeAuth = handshake.auth?.token;
    if (typeof desdeAuth === 'string' && desdeAuth.trim()) {
      return desdeAuth.trim();
    }

    const cabecera = handshake.headers?.authorization;
    if (typeof cabecera === 'string' && cabecera.startsWith('Bearer ')) {
      const valor = cabecera.slice(7).trim();
      if (valor) return valor;
    }

    return null;
  }
}
