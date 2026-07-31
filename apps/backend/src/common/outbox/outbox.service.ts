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

/** Cuántos intentos antes de darse por vencido. */
export const OUTBOX_MAX_ATTEMPTS = 6;

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
  ): Promise<void> {
    // Solo el clasificador; nunca el mensaje crudo, que puede arrastrar PII o
    // fragmentos de la cadena de conexión.
    const clasificador =
      error instanceof Error ? error.name || 'Error' : 'DesconocidoError';

    const intentos = attempts + 1;
    const agotado = intentos >= OUTBOX_MAX_ATTEMPTS;

    // 5s, 10s, 20s, 40s, 80s…
    const esperaMs = 5_000 * Math.pow(2, Math.min(intentos - 1, 5));

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
        `Evento de outbox agotó sus ${OUTBOX_MAX_ATTEMPTS} intentos [${clasificador}]; queda en FAILED para inspección`,
      );
    }
  }
}
