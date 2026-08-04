import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { FlowBotKillSwitchService } from '../flowbot.kill-switch.service';
import {
  ContextoEnvio,
  DecisionTransporte,
  decidirModo,
  leerConfiguracion,
} from './flowbot.whatsapp.modo';

/**
 * Reúne el estado real del sistema y decide si este envío puede salir.
 *
 * SE CONSULTA JUSTO ANTES DE ENVIAR, no al arrancar la ejecución. Entre que un
 * bot empieza a atender y llega a un nodo de mensaje pueden pasar horas: en
 * ese rato pueden haber pausado el bot, despublicado la versión, pasado la
 * conversación a una persona o activado el interruptor de emergencia. Decidir
 * al principio significa mandar mensajes en nombre de un estado que ya no
 * existe — que es exactamente el caso del «trabajo antiguo que revive».
 *
 * SE MIDE TODO AUNQUE EL PRIMERO YA BLOQUEE. Un informe que dice «falta la
 * bandera global» y esconde que además la empresa no está permitida obliga a
 * descubrir los problemas de uno en uno, encendiendo cosas por el camino.
 *
 * TODAS LAS CONSULTAS LLEVAN `companyId`. Ninguna se apoya solo en el id de la
 * ejecución o de la conversación: un identificador es adivinable y el filtro
 * de empresa es lo único que hace imposible mandar en nombre de otra.
 */
@Injectable()
export class GuardarrailesWhatsApp {
  private readonly logger = new Logger(GuardarrailesWhatsApp.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly killSwitch: FlowBotKillSwitchService,
  ) {}

  async evaluar(input: {
    companyId: string;
    executionId: string | null;
    conversationId: string;
    phoneNumberId: string | null;
    destinatario: string | null;
    integracionConectada: boolean;
    idempotencyKey: string | null;
    ventanaOPlantilla: boolean;
    dentroDeLimite: boolean;
    circuitoSano: boolean;
  }): Promise<DecisionTransporte> {
    const [estadoBot, handoffActivo, killSwitch] = await Promise.all([
      this.estadoDeLaEjecucion(input.companyId, input.executionId),
      this.hayHandoffHumano(input.companyId, input.conversationId),
      this.killSwitch.activo(),
    ]);

    const contexto: ContextoEnvio = {
      companyId: input.companyId,
      phoneNumberId: input.phoneNumberId,
      destinatario: input.destinatario,
      integracionConectada: input.integracionConectada,
      botPublicado: estadoBot.publicado,
      botActivo: estadoBot.activo,
      versionValida: estadoBot.versionValida,
      ejecucionViva: estadoBot.viva,
      handoffHumano: handoffActivo,
      idempotencyKey: input.idempotencyKey,
      ventanaOPlantilla: input.ventanaOPlantilla,
      dentroDeLimite: input.dentroDeLimite,
      circuitoSano: input.circuitoSano,
      killSwitch,
    };

    return decidirModo(contexto, leerConfiguracion());
  }

  /**
   * Estado del bot y de la ejecución, en una sola consulta.
   *
   * `versionValida` compara la versión con la que arrancó la ejecución con la
   * publicada AHORA: si alguien publicó otra mientras tanto, este trabajo
   * viene de una versión que ya no es la vigente. Se deja seguir en modo falso
   * —cancelar a mitad de una conversación es peor—, pero no se manda un
   * mensaje real en nombre de un flujo que nadie está usando ya.
   */
  private async estadoDeLaEjecucion(
    companyId: string,
    executionId: string | null,
  ): Promise<{
    publicado: boolean;
    activo: boolean;
    versionValida: boolean;
    viva: boolean;
  }> {
    if (!executionId) {
      // Sin ejecución no hay nada que comprobar y, por tanto, nada que
      // permita afirmar que el envío es legítimo.
      return {
        publicado: false,
        activo: false,
        versionValida: false,
        viva: false,
      };
    }

    const ejecucion = await this.prisma.flowBotExecution.findFirst({
      where: { id: executionId, companyId },
      select: {
        status: true,
        versionId: true,
        flowBot: {
          select: { status: true, publishedVersionId: true },
        },
      },
    });

    if (!ejecucion) {
      return {
        publicado: false,
        activo: false,
        versionValida: false,
        viva: false,
      };
    }

    const VIVAS = ['RUNNING', 'WAITING_INPUT', 'WAITING_TIME'];

    return {
      publicado: !!ejecucion.flowBot?.publishedVersionId,
      activo: ejecucion.flowBot?.status === 'ACTIVE',
      versionValida:
        !!ejecucion.versionId &&
        ejecucion.versionId === ejecucion.flowBot?.publishedVersionId,
      viva: VIVAS.includes(ejecucion.status),
    };
  }

  /**
   * ¿Está atendiendo una persona?
   *
   * Si el bot manda un mensaje mientras hay alguien escribiendo, el cliente
   * recibe dos interlocutores a la vez y la persona no se entera de lo que
   * dijo el bot. Es el peor fallo visible del producto.
   */
  private async hayHandoffHumano(
    companyId: string,
    conversationId: string,
  ): Promise<boolean> {
    const abierto = await this.prisma.conversationHandoff.findFirst({
      where: {
        companyId,
        conversationId,
        // Solo `ACTIVE` significa «hay alguien ahora»: `RESOLVED` y
        // `CANCELLED` son handoffs que ya terminaron y el bot puede seguir.
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    return !!abierto;
  }
}
