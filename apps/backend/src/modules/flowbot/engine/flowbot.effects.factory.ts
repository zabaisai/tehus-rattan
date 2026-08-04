import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { EfectosFalsos } from './flowbot.fake-effects';
import {
  Efectos,
  PuertoAuditoria,
  PuertoCrm,
  PuertoHttp,
  PuertoIa,
  PuertoReloj,
} from './flowbot.ports';
import { CrmAdapter } from './adapters/flowbot.crm.adapter';
import { WhatsappAdapter } from './adapters/flowbot.whatsapp.adapter';
import { TransporteWhatsAppFalso } from './adapters/flowbot.whatsapp.fake-transport';
import { CustomFieldsService } from '../../custom-fields/custom-fields.service';
import { HandoffService } from '../../conversations/handoff.service';
import { WhatsAppTokenCryptoService } from '../../whatsapp-integration/whatsapp-token-crypto.service';

/**
 * Construye el juego de efectos que recibe una ejecución.
 *
 * DÓNDE ESTÁ HOY LA LÍNEA ENTRE REAL Y SIMULADO:
 *
 *   CRM        → REAL. Contactos, oportunidades, etapas, tareas, notas,
 *                campos personalizados y handoff se escriben de verdad. Son
 *                operaciones internas, reversibles y acotadas por empresa.
 *   WhatsApp   → adaptador REAL sobre transporte FALSO. Todo el camino se
 *                ejecuta —número remitente, ventana de 24 h, idempotencia,
 *                persistencia en el hilo, clasificación de errores— y solo la
 *                petición HTTP a Meta se sustituye.
 *   HTTP e IA  → FALSOS. No se sale a la red ni se llama a un proveedor de
 *                pago.
 *
 * QUE EL TRANSPORTE SEA FALSO Y NO EL ADAPTADOR ENTERO ES LO IMPORTANTE. Si se
 * falseara el adaptador completo, el día que se conecte de verdad se estrenaría
 * en producción todo el código que nunca corrió: el que decide desde qué número
 * sale, el que impide reenviar tras un reintento y el que distingue un fallo
 * transitorio de uno definitivo. Así ese código lleva meses ejecutándose antes
 * de que salga el primer mensaje real.
 *
 * ACTIVAR ENVÍOS REALES ES CAMBIAR ESTA CLASE, no una bandera repartida por los
 * nodos que alguien pueda encender por error en uno.
 */
@Injectable()
export class FlowBotEffectsFactory {
  private readonly logger = new Logger(FlowBotEffectsFactory.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly campos: CustomFieldsService,
    private readonly handoff: HandoffService,
    private readonly cripto: WhatsAppTokenCryptoService,
    /**
     * Inyectado y no construido aquí: las pruebas y la demostración necesitan
     * mirar lo que se habría enviado, y para eso tienen que compartir la misma
     * instancia que usa el motor.
     */
    private readonly transporte: TransporteWhatsAppFalso,
  ) {}

  /**
   * Efectos para una empresa concreta.
   *
   * El `companyId` se fija AQUÍ y los adaptadores lo aplican a cada consulta:
   * un nodo no puede pedir datos de otra empresa porque no tiene forma de
   * indicar cuál.
   */
  paraEmpresa(companyId: string, executionId: string | null = null): Efectos {
    const falsos = new EfectosFalsos({ dentroDeVentana: true });

    return {
      crm: new CrmAdapter(
        this.prisma,
        companyId,
        this.campos,
        this.handoff,
        // La ejecución viaja al adaptador SOLO para el historial de cambios:
        // saber qué bot tocó un campo del cliente es la mitad de poder
        // explicarlo después.
        executionId,
      ),
      mensajeria: new WhatsappAdapter(
        this.prisma,
        companyId,
        this.transporte,
        this.cripto,
      ),
      http: falsos.http satisfies PuertoHttp,
      ia: falsos.ia satisfies PuertoIa,
      reloj: relojReal satisfies PuertoReloj,
      auditoria: falsos.auditoria satisfies PuertoAuditoria,
    } satisfies Efectos;
  }

  /** Lo que el motor habría mandado. Para la demostración y las pruebas. */
  get envios(): TransporteWhatsAppFalso {
    return this.transporte;
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
