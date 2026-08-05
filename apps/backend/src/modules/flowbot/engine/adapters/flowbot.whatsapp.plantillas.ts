import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';

/**
 * Qué sabe el CRM de una plantilla de WhatsApp.
 *
 * META ES LA AUTORIDAD; ESTO ES SOLO LO ÚLTIMO QUE SE COMPROBÓ. Preguntarle a
 * Meta en cada envío añadiría una llamada de red a cada mensaje y una
 * dependencia más que puede caerse; por eso hay tabla local y una fecha de
 * comprobación.
 *
 * LO DESCONOCIDO SE BLOQUEA. Una plantilla que no está en la tabla, o que está
 * pero nunca se verificó, NO se asume aprobada. Enviar una plantilla no
 * aprobada la rechaza Meta con un código que nadie sabe interpretar y, en
 * cantidad, degrada la calidad del número —que es un daño que tarda semanas en
 * revertirse—. Bloquear es reversible; enviar no.
 */
export interface EstadoPlantilla {
  aprobada: boolean;
  /** Por qué no se puede usar, cuando no se puede. */
  motivo?: string;
  /** Cuántos parámetros espera el cuerpo. */
  parametros: number;
  idioma: string;
  /** Cuándo se comprobó por última vez contra Meta. */
  verificadaEn: Date | null;
}

/**
 * Quién puede decir si una plantilla está aprobada de verdad.
 *
 * Se declara como interfaz porque la implementación real necesita credenciales
 * de Meta. En pruebas y hoy en producción se usa la falsa; el día que se
 * conecte, se registra otra clase y no cambia nada más.
 */
export interface ProveedorPlantillas {
  consultar(input: {
    companyId: string;
    whatsappIntegrationId: string | null;
    nombre: string;
    idioma: string;
  }): Promise<EstadoPlantilla | null>;
}

export const PROVEEDOR_PLANTILLAS = Symbol('ProveedorPlantillas');

/**
 * El proveedor falso: no sabe nada y lo dice.
 *
 * NO INVENTA UN «aprobada: true». Un proveedor falso optimista haría pasar las
 * pruebas y dejaría el sistema mandando plantillas sin verificar el día que se
 * encienda de verdad. Devolver `null` significa «pregunta a la tabla local», y
 * la tabla local solo tiene lo que alguien registró a mano.
 */
@Injectable()
export class ProveedorPlantillasFalso implements ProveedorPlantillas {
  async consultar(): Promise<EstadoPlantilla | null> {
    return null;
  }
}

@Injectable()
export class RegistroPlantillas {
  private readonly logger = new Logger(RegistroPlantillas.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * ¿Se puede mandar esta plantilla?
   *
   * El idioma entra en la búsqueda: una plantilla aprobada en `es` NO existe
   * en `en`, y el envío fallaría con un código que no dice que el problema
   * era el idioma.
   */
  async estado(input: {
    companyId: string;
    whatsappIntegrationId: string | null;
    nombre: string;
    idioma: string;
    parametrosEnviados: number;
  }): Promise<EstadoPlantilla> {
    const fila = await this.prisma.whatsAppTemplate.findFirst({
      where: {
        companyId: input.companyId,
        name: input.nombre,
        language: input.idioma,
        // Una plantilla registrada para un número concreto solo vale para ese
        // número; una sin número (`null`) vale para toda la empresa.
        OR: [
          { whatsappIntegrationId: input.whatsappIntegrationId },
          { whatsappIntegrationId: null },
        ],
      },
      // La específica del número gana sobre la genérica de la empresa.
      orderBy: [{ whatsappIntegrationId: 'desc' }, { updatedAt: 'desc' }],
      select: {
        status: true,
        bodyParams: true,
        language: true,
        lastCheckedAt: true,
        rejectionReason: true,
      },
    });

    if (!fila) {
      return {
        aprobada: false,
        motivo:
          'La plantilla no está registrada en el CRM. Regístrala y verifícala antes de usarla.',
        parametros: 0,
        idioma: input.idioma,
        verificadaEn: null,
      };
    }

    if (fila.status !== 'APPROVED') {
      return {
        aprobada: false,
        motivo:
          fila.status === 'UNKNOWN'
            ? 'La plantilla está registrada pero nunca se verificó contra WhatsApp.'
            : `WhatsApp la tiene como ${fila.status.toLowerCase()}${
                fila.rejectionReason ? `: ${fila.rejectionReason}` : ''
              }.`,
        parametros: fila.bodyParams,
        idioma: fila.language,
        verificadaEn: fila.lastCheckedAt,
      };
    }

    // Aprobada pero con otro número de parámetros: Meta la rechaza. Es un
    // fallo que solo se ve al enviar y cuyo código no menciona los parámetros.
    if (fila.bodyParams !== input.parametrosEnviados) {
      return {
        aprobada: false,
        motivo: `La plantilla espera ${fila.bodyParams} ${
          fila.bodyParams === 1 ? 'dato' : 'datos'
        } y se le están pasando ${input.parametrosEnviados}.`,
        parametros: fila.bodyParams,
        idioma: fila.language,
        verificadaEn: fila.lastCheckedAt,
      };
    }

    return {
      aprobada: true,
      parametros: fila.bodyParams,
      idioma: fila.language,
      verificadaEn: fila.lastCheckedAt,
    };
  }
}
