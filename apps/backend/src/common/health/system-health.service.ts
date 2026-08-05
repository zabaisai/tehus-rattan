import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueHealthService } from '../queue/queue.health';
import { QueuePingService } from '../queue/queue.ping';
import { estadoDelPuente, usaPuenteRedis } from '../realtime/realtime.redis';
import { COMPONENTE_WORKER, INTERVALO_LATIDO_MS } from './heartbeat.service';

/**
 * `ok`       — todo funciona.
 * `degraded` — el CRM atiende, pero algo NO se está procesando como debe.
 * `down`     — no puede atender.
 */
export type EstadoGlobal = 'ok' | 'degraded' | 'down';

export interface ComponenteSalud {
  state: 'up' | 'down' | 'stale' | 'disabled' | 'unknown';
  /** Clasificador ya redactado. Nunca cadenas de conexión ni secretos. */
  reason?: string;
  [extra: string]: unknown;
}

export interface SaludDelSistema {
  status: EstadoGlobal;
  components: {
    database: ComponenteSalud;
    queue: ComponenteSalud;
    worker: ComponenteSalud;
    outbox: ComponenteSalud;
    realtime: ComponenteSalud;
    flowbot: ComponenteSalud;
  };
}

/** El worker se da por muerto tras tres latidos perdidos. */
export const MARGEN_LATIDO_MS = INTERVALO_LATIDO_MS * 3;

/**
 * Un evento pendiente más viejo que esto significa que nadie está drenando el
 * outbox. Diez minutos dan margen a un reintento con backoff sin convertir un
 * retraso normal en una alarma.
 */
export const ANTIGUEDAD_MAXIMA_OUTBOX_MS = 10 * 60_000;

/**
 * Una espera vencida más de esto significa que su despertar no llegó. El
 * reconciliador pasa cada minuto, así que cinco minutos ya son varias
 * oportunidades perdidas y no un retraso normal.
 */
export const RETRASO_MAXIMO_FLOWBOT_MS = 5 * 60_000;

/**
 * Salud agregada del sistema.
 *
 * LA REGLA QUE JUSTIFICA ESTE SERVICIO: **si el outbox no se está procesando,
 * el sistema NO puede reportarse sano.** Los efectos de cada mensaje entrante
 * —asignación, automatizaciones, avisos— viajan por ahí. Con Redis o el
 * worker caídos, las conversaciones se siguen guardando y la interfaz
 * responde, así que todas las sondas clásicas dan verde mientras el trabajo
 * comercial se acumula sin que nadie lo toque. Ese es exactamente el fallo
 * silencioso que esto hace visible.
 *
 * SEPARACIÓN DELIBERADA CON `/health/ready`: readiness responde "¿puede esta
 * instancia atender peticiones?" y sigue mirando solo la base. Devolver 503
 * por Redis haría que el orquestador reiniciara un backend sano y convertiría
 * una degradación parcial en una caída total. Este endpoint responde otra
 * pregunta: "¿está el sistema haciendo todo su trabajo?".
 *
 * El tiempo real sí puede degradarse a polling sin romper nada, pero se
 * reporta igual: una degradación invisible se queda instalada durante meses.
 */
@Injectable()
export class SystemHealthService {
  private readonly logger = new Logger(SystemHealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueHealth: QueueHealthService,
    private readonly queuePing: QueuePingService,
  ) {}

  async check(env: NodeJS.ProcessEnv = process.env): Promise<SaludDelSistema> {
    const [database, queue, worker, outbox, flowbot] = await Promise.all([
      this.comprobarBase(),
      this.comprobarCola(env),
      this.comprobarWorker(env),
      this.comprobarOutbox(),
      this.comprobarFlowBot(),
    ]);
    const realtime = this.comprobarTiempoReal(env);

    const components = { database, queue, worker, outbox, realtime, flowbot };
    return { status: this.agregar(components), components };
  }

  /**
   * La base es la única dependencia sin la cual no se puede atender: sin ella
   * no hay conversaciones, ni pipelines, ni sesiones.
   */
  private async comprobarBase(): Promise<ComponenteSalud> {
    const inicio = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { state: 'up', latencyMs: Date.now() - inicio };
    } catch (error) {
      return {
        state: 'down',
        reason: error instanceof Error ? error.name || 'Error' : 'Error',
      };
    }
  }

  private async comprobarCola(
    env: NodeJS.ProcessEnv,
  ): Promise<ComponenteSalud> {
    const salud = await this.queueHealth.check(
      () => this.queuePing.ping(),
      env,
    );
    return { ...salud };
  }

  /**
   * El worker no expone puerto, así que se mira su latido en la base. Sin
   * latido nunca escrito el estado es `unknown` y no `down`: puede ser un
   * despliegue recién levantado, y confundir "aún no ha latido" con "está
   * muerto" produce alarmas en cada arranque.
   */
  private async comprobarWorker(
    env: NodeJS.ProcessEnv,
  ): Promise<ComponenteSalud> {
    if (!this.queueHealth.isEnabled(env)) return { state: 'disabled' };

    try {
      const latido = await this.prisma.systemHeartbeat.findUnique({
        where: { component: COMPONENTE_WORKER },
        select: { seenAt: true },
      });

      if (!latido) {
        return { state: 'unknown', reason: 'sin-latido-registrado' };
      }

      const antiguedadMs = Date.now() - latido.seenAt.getTime();
      if (antiguedadMs > MARGEN_LATIDO_MS) {
        return {
          state: 'stale',
          ageMs: antiguedadMs,
          reason: 'latido-vencido',
        };
      }
      return { state: 'up', ageMs: antiguedadMs };
    } catch (error) {
      return {
        state: 'unknown',
        reason: error instanceof Error ? error.name || 'Error' : 'Error',
      };
    }
  }

  /**
   * El síntoma que de verdad importa, independientemente de la causa: hay
   * eventos vencidos esperando a que alguien los procese.
   */
  private async comprobarOutbox(): Promise<ComponenteSalud> {
    try {
      const ahora = new Date();
      const [pendientes, masAntiguo] = await Promise.all([
        this.prisma.outboxEvent.count({
          where: { status: 'PENDING', availableAt: { lte: ahora } },
        }),
        this.prisma.outboxEvent.findFirst({
          where: { status: 'PENDING', availableAt: { lte: ahora } },
          orderBy: { availableAt: 'asc' },
          select: { availableAt: true },
        }),
      ]);

      const antiguedadMs = masAntiguo
        ? ahora.getTime() - masAntiguo.availableAt.getTime()
        : 0;

      if (antiguedadMs > ANTIGUEDAD_MAXIMA_OUTBOX_MS) {
        return {
          state: 'stale',
          pending: pendientes,
          oldestPendingMs: antiguedadMs,
          reason: 'eventos-sin-procesar',
        };
      }

      return {
        state: 'up',
        pending: pendientes,
        oldestPendingMs: antiguedadMs,
      };
    } catch (error) {
      return {
        state: 'unknown',
        reason: error instanceof Error ? error.name || 'Error' : 'Error',
      };
    }
  }

  /**
   * Salud del motor de bots.
   *
   * SE CONSULTA LA BASE, NO LOS SERVICIOS DE FLOWBOT. Este servicio vive en
   * `common/` y hacerlo depender de `modules/flowbot` invertiría las capas.
   * Además los síntomas están en PostgreSQL, así que el backend puede verlos
   * aunque el motor solo corra en el worker: es justo el caso en el que
   * preguntar a un servicio en memoria no serviría de nada.
   *
   * DEGRADA, NO TUMBA. Que haya ejecuciones esperando revisión significa que
   * el motor necesita atención, no que el CRM no pueda atender. Marcar el
   * backend como no sano por esto lo sacaría del balanceador y convertiría un
   * problema de bots en una caída del producto.
   */
  private async comprobarFlowBot(): Promise<ComponenteSalud> {
    try {
      const corte = new Date(Date.now() - RETRASO_MAXIMO_FLOWBOT_MS);

      const [necesitanAtencion, esperasVencidas] = await Promise.all([
        this.prisma.flowBotExecution.count({
          where: { status: 'NEEDS_ATTENTION' },
        }),
        // Esperas que debieron dispararse y siguen sin consumir: la señal de
        // que un despertar se perdió y el reconciliador aún no lo ha repuesto.
        this.prisma.flowBotWait.count({
          where: {
            consumedAt: null,
            wakeAt: { not: null, lt: corte },
            execution: { status: { in: ['WAITING_TIME', 'WAITING_INPUT'] } },
          },
        }),
      ]);

      if (necesitanAtencion > 0 || esperasVencidas > 0) {
        return {
          state: 'stale',
          needsAttention: necesitanAtencion,
          overdueWaits: esperasVencidas,
          reason:
            necesitanAtencion > 0
              ? 'ejecuciones-esperando-revision'
              : 'despertares-sin-disparar',
        };
      }

      return { state: 'up', needsAttention: 0, overdueWaits: 0 };
    } catch (error) {
      return {
        state: 'unknown',
        reason: error instanceof Error ? error.name || 'Error' : 'Error',
      };
    }
  }

  private comprobarTiempoReal(env: NodeJS.ProcessEnv): ComponenteSalud {
    if (!usaPuenteRedis(env)) return { state: 'disabled' };
    return estadoDelPuente.conectado
      ? { state: 'up' }
      : {
          state: 'down',
          reason: estadoDelPuente.motivo ?? 'puente-no-conectado',
          // Se dice explícitamente para que quien lea la alarma sepa que no
          // se están perdiendo datos, solo inmediatez.
          fallback: 'polling',
        };
  }

  private agregar(components: SaludDelSistema['components']): EstadoGlobal {
    // Sin base no se atiende: es lo único que hace caer el sistema entero.
    if (components.database.state === 'down') return 'down';

    const degradados = [
      components.queue,
      components.worker,
      components.outbox,
      components.realtime,
      // FlowBot degrada como los demás y NUNCA tumba: un motor de bots que
      // necesita revisión no impide atender conversaciones a mano.
      components.flowbot,
    ].some((c) => c.state === 'down' || c.state === 'stale');

    return degradados ? 'degraded' : 'ok';
  }
}
