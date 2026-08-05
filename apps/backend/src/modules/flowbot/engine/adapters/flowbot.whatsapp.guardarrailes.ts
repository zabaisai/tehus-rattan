import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { FlowBotKillSwitchService } from '../flowbot.kill-switch.service';
import {
  ContadorFrecuencia,
  type ClavesEnvio,
} from './flowbot.whatsapp.frecuencia';
import { CircuitBreakerWhatsApp } from './flowbot.whatsapp.breaker';
import { MetricasEnvio } from '../flowbot.envio.metricas';
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
    private readonly frecuencia: ContadorFrecuencia,
    private readonly breaker: CircuitBreakerWhatsApp,
    private readonly metricas: MetricasEnvio,
  ) {}

  async evaluar(input: {
    companyId: string;
    executionId: string | null;
    flowBotId: string | null;
    conversationId: string;
    integrationId: string | null;
    phoneNumberId: string | null;
    destinatario: string | null;
    integracionConectada: boolean;
    idempotencyKey: string | null;
    ventanaOPlantilla: boolean;
  }): Promise<DecisionTransporte> {
    const [estadoBot, handoffActivo, killSwitch] = await Promise.all([
      this.estadoDeLaEjecucion(input.companyId, input.executionId),
      this.hayHandoffHumano(input.companyId, input.conversationId),
      this.killSwitch.activo(),
    ]);

    // PRIMERO SE DECIDE SIN TOCAR CONTADORES. El breaker y la frecuencia se
    // consultan al final y solo si todo lo demás pasó: consumir cupo por un
    // envío que el kill switch iba a bloquear de todas formas gasta el
    // presupuesto de la empresa sin que salga nada. Y el kill switch prevalece
    // sobre los dos, por eso va antes.
    const contextoBase: ContextoEnvio = {
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
      // Optimistas de momento: si algo anterior ya bloquea, no se consultan.
      dentroDeLimite: true,
      circuitoSano: true,
      killSwitch,
    };

    const previa = decidirModo(contextoBase, leerConfiguracion());

    // Con algo ya bloqueado se devuelve sin tocar breaker ni contador.
    if (previa.bloqueos.length > 0) {
      this.metricas.registrarBloqueo(previa.bloqueos);
      return previa;
    }

    // 9. Breaker: barato y no consume nada.
    const puerta = input.integrationId
      ? await this.breaker.permitir(input.integrationId)
      : { permitido: true, estado: 'CLOSED' as const };

    if (!puerta.permitido) {
      this.metricas.incrementar('bloqueados.breaker');
      return decidirModo(
        { ...contextoBase, circuitoSano: false },
        leerConfiguracion(),
      );
    }
    if (puerta.esPrueba) this.metricas.incrementar('breaker.pruebas');

    // 10. Frecuencia: es lo ÚLTIMO porque es lo único que consume.
    const reserva = await this.frecuencia.reservar({
      companyId: input.companyId,
      integrationId: input.integrationId,
      phoneNumberId: input.phoneNumberId ?? 'desconocido',
      flowBotId: input.flowBotId,
      conversationId: input.conversationId,
      destinatario: input.destinatario ?? '',
    });

    if (!reserva.permitido) {
      const decision = decidirModo(
        { ...contextoBase, dentroDeLimite: false },
        leerConfiguracion(),
      );

      // Sin Redis NO se asume cero. Para el modo real esto bloquea; para falso
      // y dry-run el envío sigue, pero se dice que el cupo no se consumió.
      if ('indisponible' in reserva) {
        this.metricas.incrementar('bloqueados.contadorCaido');
        this.logger.error(
          'Contador de frecuencia no disponible: el envío real queda bloqueado',
        );
        return {
          ...decision,
          contadorIndisponible: true,
          cupoConsumido: false,
        };
      }

      this.metricas.incrementar('bloqueados.frecuencia');
      return {
        ...decision,
        cupoConsumido: false,
        retryAfterSegundos: reserva.retryAfterSegundos,
        limiteAlcanzado: {
          dimension: reserva.dimension,
          ventana: reserva.ventana,
          limite: reserva.limite,
        },
      };
    }

    this.metricas.incrementar(
      previa.modo === 'dry-run' ? 'dryRun' : 'permitidos',
    );
    return {
      ...previa,
      cupoConsumido: true,
      esPruebaDelBreaker: puerta.esPrueba === true,
    };
  }

  /**
   * Devuelve el cupo de un envío que al final NO salió.
   *
   * Solo cuando se sabe con certeza que no salió nada. Un resultado ambiguo
   * conserva el cupo a propósito: puede que el mensaje sí saliera, y devolver
   * el cupo permitiría que otro ocupara su sitio y acabaran saliendo dos.
   */
  async devolverCupo(input: ClavesEnvio): Promise<void> {
    await this.frecuencia.devolver(input);
  }

  /**
   * El envío salió: cierra el breaker de ese número.
   *
   * Va por aquí y no directo al breaker desde el adaptador para que el
   * adaptador siga sin conocer a Redis: lo único que sabe es que hubo un
   * éxito y a quién avisar.
   */
  async registrarExito(integrationId: string): Promise<void> {
    const antes = await this.breaker.foto(integrationId);
    await this.breaker.registrarExito(integrationId);
    if (antes.estado !== 'CLOSED') this.metricas.incrementar('breaker.cierres');
  }

  async registrarFallo(integrationId: string, errorCode: string) {
    if (errorCode === 'limite-de-tasa') this.metricas.incrementar('meta.429');
    if (errorCode === 'meta-caido') this.metricas.incrementar('meta.5xx');
    if (errorCode === 'resultado-ambiguo') {
      this.metricas.incrementar('meta.timeoutAmbiguo');
    }

    const r = await this.breaker.registrarFallo(integrationId, errorCode);
    if (r.abierto) this.metricas.incrementar('breaker.aperturas');
    return r;
  }

  /** Foto de las métricas, para el estado operativo. */
  fotoMetricas() {
    return this.metricas.foto();
  }

  alertas(entrada: Parameters<MetricasEnvio['alertas']>[0]) {
    return this.metricas.alertas(entrada);
  }

  /** Foto del breaker de un número, para la pantalla de estado. */
  async fotoBreaker(integrationId: string) {
    return this.breaker.foto(integrationId);
  }

  /** ¿Responde el contador? Para el estado operativo. */
  async contadorDisponible(): Promise<boolean> {
    return this.frecuencia.disponible();
  }

  limitesConfigurados() {
    return this.frecuencia.limitesConfigurados();
  }

  /** Levanta el breaker de un número. No toca ningún otro guardarraíl. */
  async reiniciarBreaker(integrationId: string): Promise<void> {
    await this.breaker.reiniciar(integrationId);
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
