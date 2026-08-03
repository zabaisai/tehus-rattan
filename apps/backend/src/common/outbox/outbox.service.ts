import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Cliente capaz de escribir en el outbox: PrismaService o un `tx`. */
type OutboxWriter = Pick<PrismaService, 'outboxEvent'>;

export const OUTBOX_TYPES = {
  INBOUND_MESSAGE: 'inbound.message',
} as const;

export interface RecordOutboxInput {
  type: string;
  companyId: string;
  /** Suele ser el id del mensaje: identifica el HECHO, no el intento. */
  idempotencyKey: string;
  payload: Prisma.InputJsonValue;
}

/** Cuántos intentos antes de darse por vencido, cuando el tipo no dice otra cosa. */
export const OUTBOX_MAX_ATTEMPTS = 6;

/**
 * Política de reintento del despacho.
 *
 * POR TIPO Y NO UNA SOLA PARA TODOS, porque el coste de reintentar y el de
 * rendirse no son iguales en todos los eventos. Insistir doce veces en algo que
 * el reconciliador va a rehacer en un minuto solo gasta base de datos; rendirse
 * a las seis en algo que nadie más va a rehacer pierde el trabajo de verdad.
 */
export interface PoliticaReintento {
  maxIntentos: number;
  /** Espera del primer reintento. Se duplica en cada uno. */
  baseMs: number;
  /** Tope, para que el backoff exponencial no se vaya a horas. */
  topeMs: number;
}

export const POLITICA_POR_DEFECTO: PoliticaReintento = {
  maxIntentos: OUTBOX_MAX_ATTEMPTS,
  baseMs: 5_000,
  topeMs: 160_000,
};

const POLITICAS: Record<string, PoliticaReintento> = {
  // Un mensaje entrante sin despachar es un cliente sin atender: se insiste
  // con la cadencia histórica, que ya está validada en producción.
  'inbound.message': POLITICA_POR_DEFECTO,

  // Un avance bloqueado deja al cliente esperando respuesta: se reintenta
  // rápido. Y se abandona antes que el resto porque no se pierde nada: el
  // reconciliador ve la ejecución parada y vuelve a encolarla.
  'flowbot.advance': { maxIntentos: 8, baseMs: 2_000, topeMs: 60_000 },

  // Un despertar es lo contrario: nadie está esperando ahora mismo, así que la
  // prisa sobra, pero perderlo deja la ejecución dormida para siempre. Se
  // insiste mucho más y con más calma.
  'flowbot.wake': { maxIntentos: 12, baseMs: 5_000, topeMs: 300_000 },
};

export function politicaDe(type: string): PoliticaReintento {
  return POLITICAS[type] ?? POLITICA_POR_DEFECTO;
}

/** Cuánto puede estar un evento reclamado antes de considerarlo colgado. */
export const OUTBOX_STALE_CLAIM_MS = 5 * 60_000;

/**
 * Outbox transaccional.
 *
 * EL PROBLEMA QUE RESUELVE
 * Persistir el mensaje y encolar sus efectos son dos operaciones contra
 * sistemas distintos. Si el proceso muere entre ambas, el mensaje queda
 * guardado y sus efectos no ocurren nunca: ni asignación, ni tarea, ni aviso
 * al asesor. Y nadie se entera, porque no hay error en ningún log — el
 * webhook respondió 200 y Meta no reintenta.
 *
 * LA SOLUCIÓN
 * El evento se escribe en LA MISMA TRANSACCIÓN que el cambio esencial. O
 * existen ambos o no existe ninguno. Un dispatcher posterior lo empuja a la
 * cola; si el empujón falla, el evento sigue ahí en PENDING y se reintenta.
 *
 * El precio es latencia: los efectos ocurren cuando el dispatcher pasa, no en
 * el mismo instante. Es un precio que merece la pena frente a perderlos.
 */
@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra un evento DENTRO de la transacción del llamador.
   *
   * Idempotente por `idempotencyKey`: registrar dos veces el mismo hecho no
   * crea dos eventos. Devuelve `false` si ya existía, para que el llamador
   * pueda distinguir "nuevo" de "repetido" sin tratarlo como error.
   *
   * NO lanza ante un duplicado: un reintento de Meta es un caso normal, no
   * una anomalía, y hacer fallar la transacción entera por él haría perder el
   * mensaje que sí queríamos guardar.
   */
  async record(
    writer: OutboxWriter,
    input: RecordOutboxInput,
  ): Promise<boolean> {
    try {
      await writer.outboxEvent.create({
        data: {
          type: input.type,
          companyId: input.companyId,
          idempotencyKey: input.idempotencyKey,
          payload: input.payload,
        },
      });
      return true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Reclama un lote de eventos pendientes para este dispatcher.
   *
   * `FOR UPDATE SKIP LOCKED` es lo que hace segura la concurrencia: si dos
   * dispatchers corren a la vez (dos workers, o un despliegue solapado), cada
   * uno se lleva filas distintas en vez de pelearse por las mismas. Sin él,
   * ambos leerían el mismo lote y los efectos se duplicarían.
   *
   * Incluye los eventos PROCESSING que llevan colgados más de
   * OUTBOX_STALE_CLAIM_MS: son los que reclamó un proceso que murió antes de
   * terminar. Recuperarlos es lo que hace que un reinicio no pierda trabajo.
   */
  async claimBatch(limit = 50): Promise<
    Array<{
      id: string;
      type: string;
      companyId: string;
      payload: unknown;
      idempotencyKey: string;
      attempts: number;
    }>
  > {
    const corte = new Date(Date.now() - OUTBOX_STALE_CLAIM_MS);

    return this.prisma.$queryRaw`
      UPDATE "outbox_events" SET
        "status" = 'PROCESSING',
        "claimedAt" = now(),
        "updatedAt" = now()
      WHERE "id" IN (
        SELECT "id" FROM "outbox_events"
        WHERE (
          ("status" = 'PENDING' AND "availableAt" <= now())
          OR ("status" = 'PROCESSING' AND "claimedAt" < ${corte})
        )
        ORDER BY "availableAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "type", "companyId", "payload", "idempotencyKey", "attempts";
    `;
  }

  /**
   * Completa por clave de idempotencia, para cuando el productor consiguió
   * encolar de inmediato y no necesita esperar al dispatcher.
   *
   * `updateMany` y no `update`: si el evento ya no está (otro dispatcher lo
   * completó), no debe lanzar. Es un atajo de latencia, no una garantía.
   */
  async markCompletedByKey(idempotencyKey: string): Promise<void> {
    await this.prisma.outboxEvent.updateMany({
      where: { idempotencyKey, status: { in: ['PENDING', 'PROCESSING'] } },
      data: { status: 'COMPLETED', processedAt: new Date(), lastError: null },
    });
  }

  /** El evento llegó a la cola. */
  async markCompleted(id: string): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id },
      data: { status: 'COMPLETED', processedAt: new Date(), lastError: null },
    });
  }

  /**
   * El despacho falló: se reprograma con backoff exponencial, o se marca
   * FAILED si ya agotó los intentos.
   *
   * El backoff se materializa en `availableAt`, no en un timer: así sobrevive
   * a un reinicio. Un retraso en memoria se perdería y el evento se
   * reintentaría de inmediato, machacando un servicio ya caído.
   */
  async markFailed(
    id: string,
    attempts: number,
    error: unknown,
    type?: string,
  ): Promise<void> {
    // Solo el clasificador; nunca el mensaje crudo, que puede arrastrar PII o
    // fragmentos de la cadena de conexión.
    const clasificador =
      error instanceof Error ? error.name || 'Error' : 'DesconocidoError';

    // Sin tipo se aplica la política por defecto: un llamador que no lo pasa no
    // debe quedarse sin reintentos.
    const politica = politicaDe(type ?? '');
    const intentos = attempts + 1;
    const agotado = intentos >= politica.maxIntentos;

    // Exponencial con tope: 5s, 10s, 20s, 40s… hasta `topeMs`.
    const esperaMs = Math.min(
      politica.baseMs * Math.pow(2, intentos - 1),
      politica.topeMs,
    );

    await this.prisma.outboxEvent.update({
      where: { id },
      data: {
        status: agotado ? 'FAILED' : 'PENDING',
        attempts: intentos,
        lastError: clasificador,
        availableAt: new Date(Date.now() + esperaMs),
        claimedAt: null,
      },
    });

    if (agotado) {
      this.logger.error(
        `Evento de outbox "${type ?? 'sin tipo'}" agotó sus ${
          politica.maxIntentos
        } intentos [${clasificador}]; queda en FAILED para inspección`,
      );
    }
  }
}
