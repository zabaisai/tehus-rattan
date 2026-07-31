import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

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
 */
@Injectable()
export class RealtimeAuthService {
  private readonly logger = new Logger(RealtimeAuthService.name);

  constructor(private readonly jwt: JwtService) {}

  /**
   * Devuelve la identidad si el token es válido y pertenece a una empresa;
   * `null` en cualquier otro caso. Nunca lanza: un handshake inválido se
   * rechaza cerrando el socket, no tumbando el gateway.
   */
  authenticate(handshake: {
    auth?: Record<string, unknown>;
    headers?: Record<string, unknown>;
  }): RealtimeIdentity | null {
    const token = this.extractToken(handshake);
    if (!token) return null;

    try {
      const payload = this.jwt.verify<{
        sub?: string;
        companyId?: string | null;
        role?: string;
      }>(token);

      // Sin empresa no hay canal. Aplica al SUPER_ADMIN de plataforma.
      if (!payload?.sub || !payload?.companyId) return null;

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
