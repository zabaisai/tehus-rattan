import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { SupportSessionsService } from '../../platform/support-sessions.service';

/**
 * Cómo entra un SUPER_ADMIN de plataforma a los bots de una empresa.
 *
 * NO ENTRA POR SER SUPER_ADMIN. Un rol de plataforma da acceso a la
 * plataforma, no a los datos de los clientes: sin más, cualquiera con ese rol
 * podría leer y publicar bots de cualquier empresa sin dejar rastro de por
 * qué. Entra abriendo una SESIÓN DE SOPORTE, que ya existe en el producto y
 * exige empresa concreta, motivo escrito y caducidad.
 *
 * LA SESIÓN VIAJA EN UNA CABECERA, no en el token: el token dura lo que dura y
 * la sesión de soporte se puede cerrar en el acto. Atarlas obligaría a
 * reautenticar para revocar un acceso, que es justo lo contrario de lo que se
 * quiere cuando alguien se equivoca de empresa.
 *
 * CERO ACCESO TRANSVERSAL. La sesión fija UNA empresa, y esta guarda escribe
 * esa empresa en `req.user.companyId`: a partir de ahí el SUPER_ADMIN es, para
 * todos los efectos, un usuario de esa empresa. No hay ninguna ruta que le
 * deje ver dos a la vez.
 */
export const CABECERA_SOPORTE = 'x-support-session-id';

@Injectable()
export class FlowBotSupportGuard implements CanActivate {
  constructor(private readonly soporte: SupportSessionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = req.user;

    // Un usuario de empresa pasa de largo: esta guarda solo mira a plataforma.
    if (!user || user.role !== 'SUPER_ADMIN' || user.companyId) return true;

    const sessionId = this.cabecera(req);
    if (!sessionId) {
      throw new ForbiddenException(
        'Para administrar los bots de una empresa necesitas una sesión de soporte activa',
      );
    }

    // Reutiliza la validación de soporte tal cual: activa, no caducada y del
    // propio actor. NO se reimplementa aquí — dos comprobaciones distintas de
    // lo mismo acaban divergiendo, y la que se quede corta será la que use
    // alguien.
    const sesion = await this.soporte.validateActiveSupportSession(
      sessionId,
      user.sub,
    );

    if (!sesion.companyId) {
      throw new BadRequestException(
        'La sesión de soporte no tiene empresa seleccionada',
      );
    }

    // A partir de aquí actúa COMO esa empresa. Los servicios filtran por
    // `companyId` sin saber quién es: no hay un camino paralelo para soporte
    // que pueda quedarse sin el filtro.
    req.user = {
      ...user,
      companyId: sesion.companyId,
      // Se conserva quién es de verdad para la auditoría: el registro tiene
      // que decir que fue plataforma, no la empresa.
      soporte: {
        sessionId: sesion.id,
        motivo: sesion.reason,
        empresa: sesion.companyId,
      },
    };
    return true;
  }

  private cabecera(req: {
    headers: Record<string, string | string[] | undefined>;
  }): string | null {
    const valor = req.headers[CABECERA_SOPORTE];
    const bruto = Array.isArray(valor) ? valor[0] : valor;
    return bruto?.trim() ? bruto.trim() : null;
  }
}
