import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Resultado de una accion concreta, tal como se guarda en el historial. */
export interface PasoEjecutado {
  type: string;
  ok: boolean;
  /** Clasificador del fallo. NUNCA el mensaje crudo del proveedor. */
  error?: string;
  durationMs?: number;
}

/** Cuantas veces se reintenta antes de darla por muerta. */
export const MAXIMOS_INTENTOS = 3;

/**
 * Historial de ejecuciones de automatizaciones.
 *
 * POR QUE EXISTE: el motor actual ejecuta en linea y se traga los errores en
 * un `logger.error`. Si una automatizacion deja de funcionar nadie se entera,
 * y cuando alguien pregunta "¿por que no se mando ese mensaje?" no hay
 * absolutamente nada que mirar. Un log plano tampoco basta: no dice que
 * version de la regla corrio ni en que accion concreta se rompio.
 *
 * IDEMPOTENCIA: la llave es la misma que usa el outbox (el id del mensaje)
 * combinada con la automatizacion. Un reintento del job no vuelve a ejecutar
 * las acciones — que en este dominio significa no volver a mandarle un
 * WhatsApp al cliente.
 */
@Injectable()
export class AutomationRunsService {
  private readonly logger = new Logger(AutomationRunsService.name);

  /**
   * Abre una ejecucion. Devuelve `null` si esta llave ya se registro: no es
   * un error, es la idempotencia funcionando.
   */
  async abrir(
    prisma: PrismaService,
    input: {
      automationId: string;
      automationVersion: number;
      companyId: string;
      conversationId?: string | null;
      triggerType: string;
      idempotencyKey: string;
    },
  ): Promise<{ id: string } | null> {
    try {
      return await prisma.automationRun.create({
        data: {
          automationId: input.automationId,
          automationVersion: input.automationVersion,
          companyId: input.companyId,
          conversationId: input.conversationId ?? null,
          triggerType: input.triggerType,
          idempotencyKey: input.idempotencyKey,
          status: 'RUNNING',
          attempts: 1,
          startedAt: new Date(),
        },
        select: { id: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // Ya ejecutada. Silencio deliberado: registrarlo como incidencia
        // llenaria el log de falsas alarmas en cada reintento normal.
        return null;
      }
      throw error;
    }
  }

  /** Cierra la ejecucion con el resultado de cada accion. */
  async cerrar(
    prisma: PrismaService,
    runId: string,
    pasos: PasoEjecutado[],
  ): Promise<void> {
    const fallidos = pasos.filter((p) => !p.ok);

    await prisma.automationRun.update({
      where: { id: runId },
      data: {
        // Una ejecucion con alguna accion fallida NO es completada. Marcarla
        // verde porque "la mayoria funciono" es como se pierden los fallos.
        status: fallidos.length ? 'FAILED' : 'COMPLETED',
        steps: pasos as unknown as Prisma.InputJsonValue,
        lastError: fallidos[0]?.error ?? null,
        finishedAt: new Date(),
      },
    });
  }

  /**
   * Registra un reintento. Al agotar los intentos pasa a `DEAD`, que es el
   * equivalente a una cola de mensajes muertos pero en la base: sobrevive a
   * un reinicio de Redis y se puede consultar desde el propio CRM.
   */
  async registrarFallo(
    prisma: PrismaService,
    runId: string,
    error: string,
  ): Promise<'reintentara' | 'muerta'> {
    const run = await prisma.automationRun.update({
      where: { id: runId },
      data: { attempts: { increment: 1 }, lastError: error },
      select: { attempts: true },
    });

    if (run.attempts >= MAXIMOS_INTENTOS) {
      await prisma.automationRun.update({
        where: { id: runId },
        data: { status: 'DEAD', finishedAt: new Date() },
      });
      this.logger.warn(
        `Automatizacion agotada tras ${run.attempts} intentos [${error}]`,
      );
      return 'muerta';
    }

    await prisma.automationRun.update({
      where: { id: runId },
      data: { status: 'PENDING' },
    });
    return 'reintentara';
  }

  /** Historial de una empresa, para la pantalla de automatizaciones. */
  async listar(
    prisma: PrismaService,
    companyId: string,
    filtros: { automationId?: string; status?: string; limit?: number } = {},
  ) {
    return prisma.automationRun.findMany({
      where: {
        companyId,
        ...(filtros.automationId ? { automationId: filtros.automationId } : {}),
        ...(filtros.status ? { status: filtros.status as never } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(filtros.limit ?? 50, 200),
      select: {
        id: true,
        status: true,
        attempts: true,
        triggerType: true,
        automationVersion: true,
        steps: true,
        lastError: true,
        startedAt: true,
        finishedAt: true,
        createdAt: true,
        automation: { select: { id: true, name: true } },
        conversationId: true,
      },
    });
  }
}
