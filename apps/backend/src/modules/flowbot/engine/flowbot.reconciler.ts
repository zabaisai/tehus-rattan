import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { shouldEnqueue } from '../../../common/queue/queue.role';
import { PrismaService } from '../../../prisma/prisma.service';
import { FlowBotQueueService } from './flowbot.queue';
import { LEASE_MS, OUTBOX_FLOWBOT } from './flowbot.runner';

/**
 * Reconciliador de FlowBot.
 *
 * EXISTE PORQUE LA COLA MIENTE. Redis puede vaciarse, un worker puede morir a
 * mitad de un paso, un trabajo puede perderse en un failover. Cuando eso pasa,
 * PostgreSQL sigue diciendo la verdad —«esta ejecución está esperando»— pero
 * no hay nada en ninguna cola que vaya a atenderla. Sin este servicio, esas
 * ejecuciones se quedan dormidas para siempre y nadie se entera: no hay error
 * en ningún log, simplemente el cliente no recibe respuesta.
 *
 * PROPIEDADES QUE TIENE QUE CUMPLIR, y por qué:
 *
 *   IDEMPOTENTE. Pasa cada minuto. Si cada pase repitiera lo del anterior, una
 *   ejecución atascada acumularía un trabajo por minuto hasta llenar la cola.
 *
 *   ACOTADO. Cada condición mira como mucho `LOTE` filas. Un incidente que
 *   deje diez mil ejecuciones colgadas no puede convertirse en una consulta
 *   que tumbe la base mientras intenta arreglarlo.
 *
 *   SEGURO CON DOS INSTANCIAS. Backend y worker lo ejecutan. Todo lo que
 *   escribe usa `updateMany` con el estado esperado en el `where`, y todo lo
 *   que encola usa un `jobId` determinista: dos instancias haciendo lo mismo a
 *   la vez producen un solo efecto.
 *
 *   NO INVENTA. Reparar significa volver a encolar o cerrar lo que ya no
 *   puede seguir. NUNCA reejecuta un efecto externo. Cuando no puede probar
 *   que algo no ocurrió, marca `NEEDS_ATTENTION` y para.
 */

/** Cuántas filas por condición y por pase. */
export const LOTE = 100;

/** Sin avanzar más de esto, una ejecución RUNNING está atascada. */
export const ATASCO_MS = 5 * 60_000;

/** Una ejecución viva más tiempo que esto ya no va a terminar sola. */
export const ABANDONO_MS = 24 * 60 * 60_000;

/** Cuántas recuperaciones antes de dejar de intentarlo. */
export const MAX_RECUPERACIONES = 5;

export interface InformeReconciliacion {
  /** Qué se encontró, por condición. */
  detectado: Record<string, number>;
  /** Qué se reparó, por condición. */
  reparado: Record<string, number>;
  /** Cuántas quedaron para revisión humana. */
  necesitanAtencion: number;
  /** `true` si hay algo que una persona debería mirar. */
  degradado: boolean;
  duracionMs: number;
}

@Injectable()
export class FlowBotReconcilerService {
  private readonly logger = new Logger(FlowBotReconcilerService.name);
  private corriendo = false;

  private ultimoInforme: InformeReconciliacion | null = null;
  private ultimoPaseEn: Date | null = null;
  private pases = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cola: FlowBotQueueService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Cada minuto. No cada cinco segundos como el despachador: aquí se barren
   * varias condiciones sobre índices distintos, y lo que se corrige son fallos
   * raros. Un minuto de retraso en recuperar una ejecución colgada es
   * aceptable; un barrido cada cinco segundos no lo es.
   */
  @Interval(60_000)
  async pasar(): Promise<void> {
    if (this.corriendo) return;
    // Mismo criterio que el despachador: solo donde tiene sentido encolar.
    if (!shouldEnqueue()) return;

    this.corriendo = true;
    try {
      await this.reconciliar();
    } catch (error) {
      // Un fallo aquí no puede tumbar el proceso: lo que estaba roto sigue
      // roto y el siguiente pase lo volverá a intentar.
      this.logger.warn(
        `Pase del reconciliador fallido [${
          error instanceof Error ? error.name : 'Error'
        }]`,
      );
    } finally {
      this.corriendo = false;
    }
  }

  /**
   * Un pase completo. Público para el endpoint de administración y para las
   * pruebas: la comprobación de que es idempotente consiste en llamarlo dos
   * veces seguidas y comparar.
   */
  async reconciliar(ahora = new Date()): Promise<InformeReconciliacion> {
    const inicio = Date.now();
    const detectado: Record<string, number> = {};
    const reparado: Record<string, number> = {};

    const cuenta = (
      registro: Record<string, number>,
      clave: string,
      n: number,
    ) => {
      if (n > 0) registro[clave] = (registro[clave] ?? 0) + n;
    };

    // El orden importa poco porque cada condición es independiente, pero se
    // empieza por lo que devuelve trabajo a la cola: es lo que desatasca a un
    // cliente que está esperando ahora mismo.
    const pasos: Array<
      [string, () => Promise<{ detectado: number; reparado: number }>]
    > = [
      ['esperas-vencidas', () => this.esperasVencidas(ahora)],
      ['ejecuciones-atascadas', () => this.ejecucionesAtascadas(ahora)],
      ['leases-vencidos', () => this.leasesVencidos(ahora)],
      ['dormidas-sin-despertador', () => this.dormidasSinDespertador(ahora)],
      ['esperas-huerfanas', () => this.esperasHuerfanas(ahora)],
      ['esperas-de-canceladas', () => this.esperasDeCanceladas(ahora)],
      ['version-desaparecida', () => this.versionDesaparecida(ahora)],
      ['abandonadas', () => this.abandonadas(ahora)],
      ['outbox-atrasado', () => this.outboxAtrasado(ahora)],
      ['outbox-fallido', () => this.outboxFallido()],
      ['recuperaciones-en-bucle', () => this.recuperacionesEnBucle()],
      ['atencion-pendiente', () => this.atencionPendiente()],
    ];

    for (const [nombre, fn] of pasos) {
      try {
        const r = await fn();
        cuenta(detectado, nombre, r.detectado);
        cuenta(reparado, nombre, r.reparado);
      } catch (error) {
        // Una condición que falla no puede impedir que las demás se revisen.
        this.logger.warn(
          `Condición "${nombre}" falló [${
            error instanceof Error ? error.name : 'Error'
          }]`,
        );
        cuenta(detectado, `${nombre}:error`, 1);
      }
    }

    const necesitanAtencion = detectado['atencion-pendiente'] ?? 0;

    const informe: InformeReconciliacion = {
      detectado,
      reparado,
      necesitanAtencion,
      // DEGRADADO, NO ENFERMO. Que haya trabajo que recuperar no significa que
      // el backend esté caído: significa que algo pasó y se está arreglando.
      // Marcarlo como no sano sacaría el proceso del balanceador y dejaría de
      // atender peticiones que sí puede atender.
      degradado:
        necesitanAtencion > 0 ||
        (detectado['outbox-fallido'] ?? 0) > 0 ||
        (detectado['recuperaciones-en-bucle'] ?? 0) > 0,
      duracionMs: Date.now() - inicio,
    };

    this.ultimoInforme = informe;
    this.ultimoPaseEn = new Date();
    this.pases += 1;

    if (Object.keys(reparado).length > 0) {
      this.logger.log(
        `Reconciliador reparó: ${Object.entries(reparado)
          .map(([k, v]) => `${k}=${v}`)
          .join(' ')}`,
      );
    }

    return informe;
  }

  /** Lo que publica el health. Sin PII: solo cuántos. */
  estado(): {
    pases: number;
    ultimoPaseEn: string | null;
    degradado: boolean;
    ultimoInforme: InformeReconciliacion | null;
  } {
    return {
      pases: this.pases,
      ultimoPaseEn: this.ultimoPaseEn?.toISOString() ?? null,
      degradado: this.ultimoInforme?.degradado ?? false,
      ultimoInforme: this.ultimoInforme,
    };
  }

  // ── 1. Esperas de tiempo que vencieron y nadie despertó ─────

  /**
   * La condición más común y la más dañina: una espera con `wakeAt` pasado que
   * sigue sin consumir. Su trabajo se perdió, o nunca se llegó a encolar.
   *
   * Se REENCOLA, no se avanza aquí: quien avanza es el consumidor, con su
   * lease. El `jobId` es el de la espera, así que reencolar algo que sí estaba
   * en la cola no crea un segundo trabajo.
   */
  private async esperasVencidas(ahora: Date) {
    const esperas = await this.prisma.flowBotWait.findMany({
      where: {
        consumedAt: null,
        wakeAt: { not: null, lte: ahora },
        execution: { status: { in: ['WAITING_TIME', 'WAITING_INPUT'] } },
      },
      orderBy: { wakeAt: 'asc' },
      take: LOTE,
      select: {
        id: true,
        wakeAt: true,
        companyId: true,
        execution: { select: { id: true, correlationId: true } },
      },
    });

    let reparado = 0;
    for (const espera of esperas) {
      const ok = await this.cola.encolarDespertar(
        {
          tipo: 'despertar',
          companyId: espera.companyId,
          executionId: espera.execution.id,
          waitId: espera.id,
          correlationId: espera.execution.correlationId,
        },
        // Ya venció: el retraso sale 0 y se procesa de inmediato.
        espera.wakeAt as Date,
      );
      if (ok) reparado += 1;
    }
    return { detectado: esperas.length, reparado };
  }

  // ── 2. Ejecuciones RUNNING que dejaron de avanzar ───────────

  /**
   * Una ejecución RUNNING sin lease y sin avanzar desde hace rato perdió su
   * trabajo. Se le encola otro.
   *
   * El `jobId` lleva el paso actual, así que si el trabajo original todavía
   * estuviera en la cola, este se descartaría por duplicado. Esa es
   * exactamente la garantía que hace seguro llamar a esto cada minuto.
   */
  private async ejecucionesAtascadas(ahora: Date) {
    const corte = new Date(ahora.getTime() - ATASCO_MS);

    const ejecuciones = await this.prisma.flowBotExecution.findMany({
      where: {
        status: 'RUNNING',
        lastStepAt: { lt: corte },
        // Sin lease: con lease activo hay alguien trabajando y meterse sería
        // crear la duplicación que el lease existe para evitar.
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: ahora } }],
        recoveries: { lt: MAX_RECUPERACIONES },
      },
      orderBy: { lastStepAt: 'asc' },
      take: LOTE,
      select: {
        id: true,
        companyId: true,
        correlationId: true,
        steps: true,
        recoveries: true,
      },
    });

    let reparado = 0;
    for (const e of ejecuciones) {
      const ok = await this.cola.encolarAvance(
        {
          tipo: 'avanzar',
          companyId: e.companyId,
          executionId: e.id,
          correlationId: e.correlationId,
        },
        e.steps,
      );
      if (ok) {
        await this.marcarRecuperada(e.id, e.recoveries);
        reparado += 1;
      }
    }
    return { detectado: ejecuciones.length, reparado };
  }

  // ── 3. Leases vencidos: el caso delicado ────────────────────

  /**
   * Un lease vencido significa que un worker murió MIENTRAS avanzaba.
   *
   * AQUÍ ESTÁ LA DECISIÓN MÁS IMPORTANTE DE TODO EL MOTOR. El worker pudo
   * morir antes de ejecutar el nodo, durante, o después de ejecutarlo pero
   * antes de persistir el paso. En el tercer caso el efecto YA OCURRIÓ —el
   * WhatsApp salió, la tarea se creó— y no hay rastro en la base.
   *
   * Si el paso más reciente quedó registrado, sabemos dónde estaba y podemos
   * seguir: el efecto está probado y su clave de idempotencia lo protege.
   *
   * Si NO hay paso registrado después de que empezara el lease, no sabemos
   * nada. Reintentar podría mandarle el mismo mensaje otra vez al cliente.
   * Abandonar podría dejarlo a medias. Ninguna de las dos es aceptable como
   * decisión automática, así que la ejecución pasa a NEEDS_ATTENTION con el
   * motivo, y una persona decide.
   *
   * Es más lento y más molesto que reintentar a ciegas. También es la
   * diferencia entre un cliente que espera y un cliente que recibe la misma
   * pregunta tres veces.
   */
  private async leasesVencidos(ahora: Date) {
    const corte = new Date(ahora.getTime() - LEASE_MS);

    const ejecuciones = await this.prisma.flowBotExecution.findMany({
      where: {
        status: { in: ['RUNNING', 'WAITING_INPUT', 'WAITING_TIME'] },
        leaseOwner: { not: null },
        leaseUntil: { lt: corte },
      },
      orderBy: { leaseUntil: 'asc' },
      take: LOTE,
      select: {
        id: true,
        companyId: true,
        correlationId: true,
        steps: true,
        recoveries: true,
        leaseUntil: true,
        currentNodeId: true,
      },
    });

    let reparado = 0;
    for (const e of ejecuciones) {
      const puedeProbar = await this.pasoRegistradoTras(
        e.id,
        // El lease se tomó `LEASE_MS` antes de vencer.
        new Date((e.leaseUntil as Date).getTime() - LEASE_MS),
      );

      if (!puedeProbar) {
        await this.marcarNecesitaAtencion(
          e.id,
          'lease-vencido-sin-paso-registrado',
        );
        continue;
      }

      // Hay paso registrado: el efecto está probado y su clave de idempotencia
      // lo protege. Se libera el lease y se reencola.
      const liberado = await this.prisma.flowBotExecution.updateMany({
        where: { id: e.id, leaseUntil: e.leaseUntil },
        data: { leaseOwner: null, leaseUntil: null },
      });
      if (liberado.count === 0) continue; // otra instancia se adelantó

      const ok = await this.cola.encolarAvance(
        {
          tipo: 'avanzar',
          companyId: e.companyId,
          executionId: e.id,
          correlationId: e.correlationId,
        },
        e.steps,
      );
      if (ok) {
        await this.marcarRecuperada(e.id, e.recoveries);
        reparado += 1;
      }
    }
    return { detectado: ejecuciones.length, reparado };
  }

  /** ¿Se registró algún paso desde que se tomó el lease? */
  private async pasoRegistradoTras(
    executionId: string,
    desde: Date,
  ): Promise<boolean> {
    const paso = await this.prisma.flowBotExecutionStep.findFirst({
      where: { executionId, createdAt: { gte: desde } },
      select: { id: true },
    });
    return paso !== null;
  }

  // ── 4. Dormidas sin nada que las despierte ──────────────────

  /**
   * Una ejecución WAITING_TIME sin ninguna espera abierta está dormida sin
   * despertador. Ocurre si la transacción que debía crear la espera se
   * revirtió y el estado sí quedó escrito.
   *
   * No se puede reencolar —no hay espera que consumir— así que se marca. Es
   * un fallo de consistencia y merece que alguien lo mire.
   */
  private async dormidasSinDespertador(ahora: Date) {
    // Margen para no confundirse con una espera que se está creando en este
    // mismo instante.
    const corte = new Date(ahora.getTime() - ATASCO_MS);

    const ejecuciones = await this.prisma.flowBotExecution.findMany({
      where: {
        status: { in: ['WAITING_TIME', 'WAITING_INPUT'] },
        lastStepAt: { lt: corte },
        waits: { none: { consumedAt: null } },
      },
      take: LOTE,
      select: { id: true, status: true },
    });

    let reparado = 0;
    for (const e of ejecuciones) {
      const marcada = await this.marcarNecesitaAtencion(
        e.id,
        'sin-espera-abierta',
      );
      if (marcada) reparado += 1;
    }
    return { detectado: ejecuciones.length, reparado };
  }

  // ── 5. Esperas de ejecuciones que ya terminaron ─────────────

  /**
   * Una espera abierta cuya ejecución terminó es basura que además puede
   * disparar un despertar inútil. Se consume.
   */
  private async esperasHuerfanas(ahora: Date) {
    const huerfanas = await this.prisma.flowBotWait.findMany({
      where: {
        consumedAt: null,
        execution: {
          status: { in: ['COMPLETED', 'FAILED', 'HANDED_OFF'] },
        },
      },
      take: LOTE,
      select: { id: true },
    });
    if (huerfanas.length === 0) return { detectado: 0, reparado: 0 };

    const { count } = await this.prisma.flowBotWait.updateMany({
      where: { id: { in: huerfanas.map((w) => w.id) }, consumedAt: null },
      data: { consumedAt: ahora },
    });
    for (const w of huerfanas) await this.cola.cancelarDespertar(w.id);

    return { detectado: huerfanas.length, reparado: count };
  }

  // ── 6. Esperas de ejecuciones canceladas ────────────────────

  /**
   * Igual que las huérfanas pero para canceladas y pausadas, que se cuentan
   * aparte porque su causa es distinta: no es un fallo, es que `cancelar()` no
   * llegó a limpiar (por ejemplo si el proceso murió a mitad).
   */
  private async esperasDeCanceladas(ahora: Date) {
    const esperas = await this.prisma.flowBotWait.findMany({
      where: {
        consumedAt: null,
        execution: { status: { in: ['CANCELLED', 'NEEDS_ATTENTION'] } },
      },
      take: LOTE,
      select: { id: true },
    });
    if (esperas.length === 0) return { detectado: 0, reparado: 0 };

    const { count } = await this.prisma.flowBotWait.updateMany({
      where: { id: { in: esperas.map((w) => w.id) }, consumedAt: null },
      data: { consumedAt: ahora },
    });
    for (const w of esperas) await this.cola.cancelarDespertar(w.id);

    return { detectado: esperas.length, reparado: count };
  }

  // ── 7. La versión que ejecutaba ya no está publicada ────────

  /**
   * Una ejecución viva cuyo bot se archivó. Seguir ejecutándolo sería
   * contestarle a un cliente con un flujo que su dueño retiró a propósito.
   *
   * Se cancela, no se marca para revisión: aquí sí sabemos qué hacer.
   */
  private async versionDesaparecida(ahora: Date) {
    const ejecuciones = await this.prisma.flowBotExecution.findMany({
      where: {
        status: { in: ['RUNNING', 'WAITING_INPUT', 'WAITING_TIME'] },
        flowBot: { status: 'ARCHIVED' },
      },
      take: LOTE,
      select: { id: true },
    });
    if (ejecuciones.length === 0) return { detectado: 0, reparado: 0 };

    const { count } = await this.prisma.flowBotExecution.updateMany({
      where: {
        id: { in: ejecuciones.map((e) => e.id) },
        status: { in: ['RUNNING', 'WAITING_INPUT', 'WAITING_TIME'] },
      },
      data: {
        status: 'CANCELLED',
        endedReason: 'bot-archivado',
        endedAt: ahora,
        leaseOwner: null,
        leaseUntil: null,
      },
    });
    return { detectado: ejecuciones.length, reparado: count };
  }

  // ── 8. Ejecuciones abandonadas ──────────────────────────────

  /**
   * Una ejecución viva desde hace más de un día no va a terminar sola. Suele
   * ser una espera de entrada a la que el cliente nunca contestó y que se
   * configuró sin vencimiento.
   *
   * Se cierra como CANCELLED con motivo propio, para que no se confunda con
   * una cancelación humana en las métricas.
   */
  private async abandonadas(ahora: Date) {
    const corte = new Date(ahora.getTime() - ABANDONO_MS);

    const ejecuciones = await this.prisma.flowBotExecution.findMany({
      where: {
        status: { in: ['RUNNING', 'WAITING_INPUT', 'WAITING_TIME'] },
        startedAt: { lt: corte },
      },
      orderBy: { startedAt: 'asc' },
      take: LOTE,
      select: { id: true },
    });
    if (ejecuciones.length === 0) return { detectado: 0, reparado: 0 };

    const { count } = await this.prisma.flowBotExecution.updateMany({
      where: {
        id: { in: ejecuciones.map((e) => e.id) },
        status: { in: ['RUNNING', 'WAITING_INPUT', 'WAITING_TIME'] },
      },
      data: {
        status: 'CANCELLED',
        endedReason: 'abandonada-por-inactividad',
        endedAt: ahora,
        leaseOwner: null,
        leaseUntil: null,
      },
    });
    return { detectado: ejecuciones.length, reparado: count };
  }

  // ── 9. Outbox atrasado ──────────────────────────────────────

  /**
   * Eventos de FlowBot que llevan pendientes mucho más de lo que tarda el
   * despachador. No se reparan aquí —el despachador es quien publica— pero se
   * CUENTAN: es la señal de que Redis lleva rato caído, y sin ella el sistema
   * parecería sano mientras nada avanza.
   */
  private async outboxAtrasado(ahora: Date) {
    const corte = new Date(ahora.getTime() - ATASCO_MS);

    const detectado = await this.prisma.outboxEvent.count({
      where: {
        type: { in: [OUTBOX_FLOWBOT.AVANZAR, OUTBOX_FLOWBOT.DESPERTAR] },
        status: 'PENDING',
        availableAt: { lt: corte },
      },
    });
    return { detectado, reparado: 0 };
  }

  /**
   * Eventos que agotaron sus reintentos. Cada uno es un avance o un despertar
   * que no llegó a la cola. Solo se cuentan: reintentarlos automáticamente
   * después de que la política se rindiera sería ignorar la política.
   */
  private async outboxFallido() {
    const detectado = await this.prisma.outboxEvent.count({
      where: {
        type: { in: [OUTBOX_FLOWBOT.AVANZAR, OUTBOX_FLOWBOT.DESPERTAR] },
        status: 'FAILED',
      },
    });
    return { detectado, reparado: 0 };
  }

  // ── 10. Ejecuciones que se recuperan una y otra vez ─────────

  /**
   * Recuperar la misma ejecución cinco veces no la va a arreglar la sexta. Se
   * marca para revisión: hay algo mal en el flujo o en un efecto, y seguir
   * reencolándola solo gasta cola.
   */
  private async recuperacionesEnBucle() {
    const ejecuciones = await this.prisma.flowBotExecution.findMany({
      where: {
        status: { in: ['RUNNING', 'WAITING_INPUT', 'WAITING_TIME'] },
        recoveries: { gte: MAX_RECUPERACIONES },
      },
      take: LOTE,
      select: { id: true },
    });

    let reparado = 0;
    for (const e of ejecuciones) {
      const marcada = await this.marcarNecesitaAtencion(
        e.id,
        'recuperaciones-agotadas',
      );
      if (marcada) reparado += 1;
    }
    return { detectado: ejecuciones.length, reparado };
  }

  /** Cuántas esperan a que una persona decida. Solo se cuentan. */
  private async atencionPendiente() {
    const detectado = await this.prisma.flowBotExecution.count({
      where: { status: 'NEEDS_ATTENTION' },
    });
    return { detectado, reparado: 0 };
  }

  // ── escrituras compartidas ──────────────────────────────────

  /**
   * Deja la ejecución a la espera de una persona.
   *
   * `updateMany` con el estado esperado: si otra instancia ya la marcó, o si
   * la ejecución terminó entre la lectura y esto, no se toca. Devuelve si
   * fue ESTA llamada la que la marcó, para no contar dos veces.
   */
  private async marcarNecesitaAtencion(
    executionId: string,
    motivo: string,
  ): Promise<boolean> {
    const { count } = await this.prisma.flowBotExecution.updateMany({
      where: {
        id: executionId,
        status: { in: ['RUNNING', 'WAITING_INPUT', 'WAITING_TIME'] },
      },
      data: {
        status: 'NEEDS_ATTENTION',
        attentionReason: motivo,
        lastRecoveryAt: new Date(),
        // El lease se suelta: nadie está trabajando y dejarlo puesto haría
        // que una reanudación manual tuviera que esperar a que venciera.
        leaseOwner: null,
        leaseUntil: null,
      },
    });

    if (count > 0) {
      // Rastro en la propia línea de tiempo de la ejecución, que es donde
      // mirará quien la revise. Sin PII: solo el clasificador.
      await this.registrarIntervencion(executionId, motivo);
      this.logger.warn(
        `Ejecución marcada para revisión humana [${motivo}] ${executionId}`,
      );
    }
    return count > 0;
  }

  private async marcarRecuperada(
    executionId: string,
    recoveries: number,
  ): Promise<void> {
    await this.prisma.flowBotExecution.updateMany({
      // El contador esperado va en el `where`: si otra instancia ya lo subió,
      // esta no lo vuelve a subir y el número sigue significando algo.
      where: { id: executionId, recoveries },
      data: { recoveries: recoveries + 1, lastRecoveryAt: new Date() },
    });
  }

  /**
   * Anota la intervención como un paso del sistema.
   *
   * Va en la línea de tiempo de la ejecución y no en `AuditLog` a propósito:
   * `AuditLog` registra lo que hace una PERSONA y exige un rol de actor.
   * Meter ahí al reconciliador con un rol inventado convertiría el registro de
   * auditoría en algo que miente sobre quién hizo qué.
   */
  private async registrarIntervencion(
    executionId: string,
    motivo: string,
  ): Promise<void> {
    await this.prisma.flowBotExecutionStep
      .create({
        data: {
          executionId,
          nodeId: 'reconciliador',
          nodeType: 'system.reconcile',
          status: 'SKIPPED',
          outPort: motivo,
          errorCode: motivo,
          // La clave impide que dos instancias escriban dos veces la misma
          // intervención.
          idempotencyKey: `reconcile:${executionId}:${motivo}`,
          output: { motivo },
        },
      })
      .catch(() => undefined);
  }
}
