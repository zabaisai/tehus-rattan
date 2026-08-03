import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { EfectosFalsos } from './flowbot.fake-effects';
import {
  Efectos,
  PuertoAuditoria,
  PuertoCrm,
  PuertoHttp,
  PuertoIa,
  PuertoMensajeria,
  PuertoReloj,
} from './flowbot.ports';
import { CrmAdapter } from './adapters/flowbot.crm.adapter';

/**
 * Construye el juego de efectos que recibe una ejecución.
 *
 * MEZCLA DELIBERADA EN ESTA ETAPA:
 *
 *   CRM        → adaptador REAL. Crear un contacto o una tarea es una
 *                operación interna, reversible y acotada por `companyId`.
 *   Mensajería → FALSO. Todavía no se manda nada por WhatsApp.
 *   HTTP e IA  → FALSOS. No se sale a la red ni se llama a un proveedor de
 *                pago.
 *
 * La mezcla es explícita y está en un solo sitio a propósito. Si «enviar de
 * verdad» fuese una bandera dentro de cada nodo, activarla por error en uno
 * bastaría para escribirle a un cliente. Aquí hay que cambiar esta clase.
 */
@Injectable()
export class FlowBotEffectsFactory {
  private readonly logger = new Logger(FlowBotEffectsFactory.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Efectos para una empresa concreta.
   *
   * El `companyId` se fija AQUÍ y los adaptadores lo aplican a cada consulta:
   * un nodo no puede pedir datos de otra empresa porque no tiene forma de
   * indicar cuál.
   */
  paraEmpresa(companyId: string): Efectos {
    // Los falsos aportan mensajería, HTTP, IA y auditoría de momento; el CRM
    // se sustituye por el real.
    const falsos = new EfectosFalsos({ dentroDeVentana: true });

    return {
      crm: new CrmAdapter(this.prisma, companyId),
      mensajeria: falsos.mensajeria satisfies PuertoMensajeria,
      http: falsos.http satisfies PuertoHttp,
      ia: falsos.ia satisfies PuertoIa,
      reloj: relojReal satisfies PuertoReloj,
      auditoria: falsos.auditoria satisfies PuertoAuditoria,
    } satisfies Efectos;
  }

  /** Efectos completamente falsos, para el simulador. No tocan nada. */
  paraSimulacion(): EfectosFalsos {
    return new EfectosFalsos({ dentroDeVentana: true });
  }
}

/** El reloj real. Se inyecta para poder falsearlo en las pruebas. */
export const relojReal: PuertoReloj = {
  ahora: () => new Date(),
};

export type { PuertoCrm };
