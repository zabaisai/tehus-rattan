import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { EfectosFalsos } from './flowbot.fake-effects';
import {
  Efectos,
  PuertoAuditoria,
  PuertoCrm,
  PuertoReloj,
} from './flowbot.ports';
import { CrmAdapter } from './adapters/flowbot.crm.adapter';
import { WhatsappAdapter } from './adapters/flowbot.whatsapp.adapter';
import { TransporteWhatsAppFalso } from './adapters/flowbot.whatsapp.fake-transport';
import { TransporteWhatsAppDryRun } from './adapters/flowbot.whatsapp.dry-run-transport';
import { TransporteWhatsAppReal } from './adapters/flowbot.whatsapp.transport';
import { GuardarrailesWhatsApp } from './adapters/flowbot.whatsapp.guardarrailes';
import { RegistroPlantillas } from './adapters/flowbot.whatsapp.plantillas';
import { leerConfiguracion } from './adapters/flowbot.whatsapp.modo';
import { HttpAdapter } from './adapters/flowbot.http.adapter';
import { IaAdapter } from './adapters/flowbot.ia.adapter';
import { RegistroProveedoresIa } from './adapters/flowbot.ia.provider';
import { ProveedorIaFalso } from './adapters/flowbot.ia.fake-provider';
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
 *   WhatsApp   → adaptador REAL con TRES transportes disponibles y la
 *                elección hecha aquí, envío a envío:
 *
 *                  falso    devuelve un identificador inventado. Nada sale.
 *                  dry-run  se prepara la petición exacta y no se abre la
 *                           conexión.
 *                  real     sale de verdad.
 *
 *                Los tres se construyen SIEMPRE; lo que decide cuál se usa es
 *                `GuardarrailesWhatsApp`, en el momento del envío y con el
 *                estado real del sistema delante. Con la configuración por
 *                defecto nunca se llega a `real`.
 *   HTTP       → adaptador REAL, APAGADO por defecto. Sin que la empresa lo
 *                encienda y declare sus destinos, cualquier llamada falla
 *                como «no configurado» antes de tocar la red.
 *   IA         → adaptador REAL sobre un registro de proveedores en el que
 *                hoy solo está el FALSO. Sin proveedor, `disponible()` dice
 *                que no y los nodos salen por su rama de reserva: el flujo
 *                sigue en vez de romperse.
 *
 * QUE EL TRANSPORTE SEA FALSO Y NO EL ADAPTADOR ENTERO ES LO IMPORTANTE. Si se
 * falseara el adaptador completo, el día que se conecte de verdad se estrenaría
 * en producción todo el código que nunca corrió: el que decide desde qué número
 * sale, el que impide reenviar tras un reintento y el que distingue un fallo
 * transitorio de uno definitivo. Así ese código lleva meses ejecutándose antes
 * de que salga el primer mensaje real.
 *
 * ACTIVAR ENVÍOS REALES ES CONFIGURAR ESTA FÁBRICA, no una bandera repartida
 * por los nodos que alguien pueda encender por error en uno. Un nodo no sabe
 * —ni puede saber— en qué modo está el sistema: recibe un puerto de mensajería
 * y lo usa.
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
    private readonly dryRun: TransporteWhatsAppDryRun,
    private readonly real: TransporteWhatsAppReal,
    private readonly guardarrailes: GuardarrailesWhatsApp,
    private readonly plantillas: RegistroPlantillas,
    private readonly registroIa: RegistroProveedoresIa,
    private readonly iaFalsa: ProveedorIaFalso,
  ) {
    // El unico proveedor registrado hoy es el falso, y es deliberado: sin
    // credenciales reales no se puede implementar uno de verdad, y fingir que
    // existe seria peor que decir que falta. Anadir el real es registrar otra
    // clase aqui; no se toca ni un nodo.
    this.registroIa.registrar(this.iaFalsa);
  }

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
        {
          falso: this.transporte,
          dryRun: this.dryRun,
          real: this.real,
        },
        this.cripto,
        this.guardarrailes,
        this.plantillas,
        executionId,
      ),
      // HTTP REAL, pero apagado salvo que la empresa lo encienda y declare
      // sus destinos. Con la configuracion por defecto, cualquier llamada
      // falla como «no configurado» antes de tocar la red.
      http: new HttpAdapter(this.prisma, companyId, this.cripto),
      // IA real sobre el registro de proveedores. Sin proveedor configurado,
      // `disponible()` responde que no y los nodos salen por su rama de
      // reserva: el flujo sigue, en vez de romperse.
      ia: new IaAdapter(this.prisma, companyId, this.registroIa, this.cripto),
      reloj: relojReal satisfies PuertoReloj,
      auditoria: falsos.auditoria satisfies PuertoAuditoria,
    } satisfies Efectos;
  }

  /** Lo que el motor habría mandado. Para la demostración y las pruebas. */
  get envios(): TransporteWhatsAppFalso {
    return this.transporte;
  }

  /** Lo preparado en modo prueba, sin salir. Para la pantalla de estado. */
  get preparados(): TransporteWhatsAppDryRun {
    return this.dryRun;
  }

  /**
   * En qué modo está el sistema, para enseñarlo.
   *
   * NO dice «real» solo porque las banderas lo permitan: dice el techo al que
   * se puede llegar. Cada envío vuelve a decidir con su propio contexto, y
   * cualquiera de los guardarraíles puede dejarlo por debajo.
   */
  modoConfigurado(): 'falso' | 'dry-run' | 'real' {
    const config = leerConfiguracion();
    if (!config.realHabilitado) return 'falso';
    return config.dryRun ? 'dry-run' : 'real';
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
