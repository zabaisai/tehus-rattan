import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { MetricasDto } from './flowbot.contracts';

/**
 * Métricas agregadas de FlowBot.
 *
 * SIEMPRE POR EMPRESA y SIEMPRE AGREGADAS. Aquí no sale ni un identificador de
 * contacto, ni un teléfono, ni un texto: son cuentas. Una pantalla de métricas
 * se proyecta en reuniones y se exporta a hojas de cálculo, así que es el peor
 * sitio posible para que se cuele un dato personal.
 *
 * SIN N+1. Todo se resuelve con `groupBy` y `count` sobre índices existentes,
 * no recorriendo bots en un bucle. Con cincuenta bots, un bucle serían
 * cincuenta consultas para pintar un panel que se abre cada mañana.
 */
@Injectable()
export class FlowBotMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async resumen(
    companyId: string,
    rango: { desde?: Date; hasta?: Date; botId?: string } = {},
  ): Promise<MetricasDto> {
    // Treinta días por defecto: el periodo que la gente compara de un vistazo.
    const hasta = rango.hasta ?? new Date();
    const desde =
      rango.desde ?? new Date(hasta.getTime() - 30 * 24 * 60 * 60_000);

    const base = {
      companyId,
      startedAt: { gte: desde, lte: hasta },
      ...(rango.botId ? { flowBotId: rango.botId } : {}),
    };

    const [porEstado, duraciones, pasosConError, reintentos, porDiaCrudo] =
      await Promise.all([
        this.prisma.flowBotExecution.groupBy({
          by: ['status'],
          where: base,
          _count: { _all: true },
        }),
        this.prisma.flowBotExecution.findMany({
          where: { ...base, endedAt: { not: null } },
          select: { startedAt: true, endedAt: true },
          // Acotado: la media no necesita leer un millón de filas, y sin tope
          // esta consulta crece con el histórico hasta volverse impagable.
          take: 5000,
          orderBy: { startedAt: 'desc' },
        }),
        this.prisma.flowBotExecutionStep.groupBy({
          by: ['nodeType'],
          where: {
            execution: base,
            status: 'FAILED',
          },
          _count: { _all: true },
          orderBy: { _count: { nodeType: 'desc' } },
          take: 10,
        }),
        this.prisma.flowBotExecutionStep.count({
          where: { execution: base, attempt: { gt: 1 } },
        }),
        this.prisma.$queryRaw<
          Array<{ dia: Date; iniciadas: bigint; completadas: bigint }>
        >`
          SELECT
            date_trunc('day', "startedAt")::date AS dia,
            COUNT(*) AS iniciadas,
            COUNT(*) FILTER (WHERE "status" = 'COMPLETED') AS completadas
          FROM "flowbot_executions"
          WHERE "companyId" = ${companyId}
            AND "startedAt" >= ${desde}
            AND "startedAt" <= ${hasta}
          GROUP BY 1
          ORDER BY 1 ASC
        `,
      ]);

    const cuenta = (estado: string) =>
      porEstado.find((e) => e.status === estado)?._count._all ?? 0;
    const iniciadas = porEstado.reduce((n, e) => n + e._count._all, 0);
    const completadas = cuenta('COMPLETED');
    const entregadas = cuenta('HANDED_OFF');

    const duracionMediaMs =
      duraciones.length > 0
        ? Math.round(
            duraciones.reduce(
              (n, d) => n + (d.endedAt!.getTime() - d.startedAt.getTime()),
              0,
            ) / duraciones.length,
          )
        : null;

    const botsConMasErrores = await this.botsConErrores(
      companyId,
      desde,
      hasta,
    );

    const mensajes = await this.prisma.message.count({
      where: {
        direction: 'OUTBOUND',
        externalKey: { not: null },
        conversation: { companyId },
        createdAt: { gte: desde, lte: hasta },
      },
    });

    return {
      desde: desde.toISOString(),
      hasta: hasta.toISOString(),
      totales: {
        iniciadas,
        completadas,
        fallidas: cuenta('FAILED'),
        canceladas: cuenta('CANCELLED'),
        enEspera: cuenta('WAITING_INPUT') + cuenta('WAITING_TIME'),
        entregadas,
        necesitanAtencion: cuenta('NEEDS_ATTENTION'),
      },
      // `null` y no 0 cuando no hubo ejecuciones: «0 %» sugiere que falla
      // siempre, y no es lo mismo que «todavía no ha corrido».
      tasaFinalizacion: iniciadas > 0 ? completadas / iniciadas : null,
      tasaHandoff: iniciadas > 0 ? entregadas / iniciadas : null,
      duracionMediaMs,
      reintentos,
      mensajesSimulados: mensajes,
      porDia: porDiaCrudo.map((d) => ({
        dia: d.dia.toISOString().slice(0, 10),
        iniciadas: Number(d.iniciadas),
        completadas: Number(d.completadas),
      })),
      nodosConMasErrores: pasosConError.map((p) => ({
        nodeType: p.nodeType,
        errores: p._count._all,
      })),
      botsConMasErrores,
    };
  }

  /**
   * Los bots que más fallan.
   *
   * Dos consultas y no una por bot: primero se agrupa, después se resuelven los
   * nombres de los pocos que salen. Un `include` sobre el `groupBy` no existe
   * en Prisma, y hacerlo en un bucle sería el N+1 clásico.
   */
  private async botsConErrores(companyId: string, desde: Date, hasta: Date) {
    const agrupado = await this.prisma.flowBotExecution.groupBy({
      by: ['flowBotId'],
      where: {
        companyId,
        status: 'FAILED',
        startedAt: { gte: desde, lte: hasta },
      },
      _count: { _all: true },
      orderBy: { _count: { flowBotId: 'desc' } },
      take: 10,
    });
    if (agrupado.length === 0) return [];

    const bots = await this.prisma.flowBot.findMany({
      where: { companyId, id: { in: agrupado.map((a) => a.flowBotId) } },
      select: { id: true, name: true },
    });

    return agrupado.map((a) => ({
      botId: a.flowBotId,
      nombre: bots.find((b) => b.id === a.flowBotId)?.name ?? '(borrado)',
      errores: a._count._all,
    }));
  }
}
