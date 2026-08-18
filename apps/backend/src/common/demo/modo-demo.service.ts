import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * El rechazo del modo demo, con forma propia.
 *
 * Es un 403 con un `code` estable para que la interfaz pueda decir «Modo
 * demo» en vez de enseñar un error genérico. Distinguirlo por el TEXTO sería
 * frágil: basta reescribir una frase para que la pantalla vuelva a mostrar
 * «algo salió mal» delante de alguien a quien le estás enseñando el producto.
 */
export class ModoDemoError extends ForbiddenException {
  constructor(accion: string) {
    super({
      statusCode: 403,
      code: 'MODO_DEMO',
      accion,
      message: `Modo demo: no se puede ${accion} desde la empresa de demostración. Todo lo demás funciona igual que en una empresa real.`,
    });
  }
}

/**
 * ¿Esta empresa es la de demostración?
 *
 * POR QUÉ NO BASTA CON LAS BANDERAS DE ENTORNO. `FLOWBOT_REAL_WHATSAPP_ENABLED`
 * y compañía protegen a TODA la instalación a la vez: si alguien las abre para
 * probar un envío real con una empresa de verdad, la empresa demo quedaría
 * abierta con ellas. Este guardarraíl no consulta el entorno, consulta la
 * EMPRESA, así que no hay combinación de variables que lo desactive.
 *
 * FAIL-CLOSED, y en las dos direcciones que importan: si la empresa no existe
 * o la consulta falla, se responde que SÍ es demo y se bloquea. Ante la duda,
 * no se manda nada afuera.
 *
 * SIN CACHÉ. Se lee en cada comprobación, por el mismo motivo que el
 * interruptor de emergencia de Pulso: guardarlo un minuto significa un minuto
 * en el que la respuesta puede ser la equivocada.
 */
@Injectable()
export class ModoDemoService {
  private readonly logger = new Logger(ModoDemoService.name);

  constructor(private readonly prisma: PrismaService) {}

  async esDemo(companyId: string): Promise<boolean> {
    try {
      const empresa = await this.prisma.company.findUnique({
        where: { id: companyId },
        select: { isDemo: true },
      });
      // Sin empresa, se bloquea: un `companyId` que no resuelve no es una
      // empresa real a la que se le deba permitir un efecto externo.
      return empresa?.isDemo ?? true;
    } catch (error) {
      this.logger.error(
        'No se pudo comprobar el modo demo; se asume que SÍ lo es',
        error as Error,
      );
      return true;
    }
  }

  /**
   * Corta la acción si la empresa es demo.
   *
   * `accion` se escribe en infinitivo y en lenguaje de producto —«enviar un
   * WhatsApp», «conectar WhatsApp con Meta»— porque acaba en pantalla tal
   * cual. No es un identificador técnico.
   */
  async bloquearSiDemo(companyId: string, accion: string): Promise<void> {
    if (await this.esDemo(companyId)) throw new ModoDemoError(accion);
  }
}
