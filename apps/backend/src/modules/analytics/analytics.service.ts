import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { suma, aNumeroParaMostrar } from '../../common/dinero/dinero';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  async getOverview(companyId: string) {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [leadsThisMonth, openLeads, wonLeads, lostLeads] = await Promise.all([
      this.prisma.lead.count({
        where: { companyId, createdAt: { gte: startOfMonth } },
      }),
      this.prisma.lead.findMany({
        where: { companyId, status: 'OPEN' },
        select: { value: true },
      }),
      this.prisma.lead.findMany({
        where: { companyId, status: 'WON' },
        select: { value: true },
      }),
      this.prisma.lead.findMany({
        where: { companyId, status: 'LOST' },
        select: { value: true },
      }),
    ]);

    // Se suma en Decimal y se convierte al final. Sumar en `number` acumula
    // el error de la coma flotante y el panel acaba enseñando un total que no
    // es la suma de las oportunidades que lo componen.
    const openValue = aNumeroParaMostrar(
      suma(...openLeads.map((l) => l.value)),
    );
    const wonValue = aNumeroParaMostrar(suma(...wonLeads.map((l) => l.value)));
    const lostValue = aNumeroParaMostrar(
      suma(...lostLeads.map((l) => l.value)),
    );
    const closedCount = wonLeads.length + lostLeads.length;
    const conversionRate =
      closedCount > 0 ? (wonLeads.length / closedCount) * 100 : 0;

    return {
      leadsThisMonth,
      openValue,
      wonValue,
      lostValue,
      wonCount: wonLeads.length,
      lostCount: lostLeads.length,
      conversionRate: Math.round(conversionRate * 10) / 10,
    };
  }

  async getLeadsByStage(companyId: string, pipelineId?: string) {
    let targetPipelineId = pipelineId;

    if (!targetPipelineId) {
      const defaultPipeline = await this.prisma.pipeline.findFirst({
        where: { companyId, isDefault: true },
      });
      targetPipelineId = defaultPipeline?.id;
    }

    if (!targetPipelineId) return [];

    const stages = await this.prisma.pipelineStage.findMany({
      where: { pipelineId: targetPipelineId },
      orderBy: { order: 'asc' },
      include: {
        leads: {
          where: { companyId, status: 'OPEN' },
          select: { value: true },
        },
      },
    });

    return stages.map((stage) => ({
      stageId: stage.id,
      stageName: stage.name,
      count: stage.leads.length,
      totalValue: aNumeroParaMostrar(suma(...stage.leads.map((l) => l.value))),
    }));
  }

  async getAgentPerformance(companyId: string) {
    const agents = await this.prisma.user.findMany({
      where: { companyId, isActive: true },
      select: { id: true, name: true },
    });

    const results = await Promise.all(
      agents.map(async (agent) => {
        const [assigned, won, lost] = await Promise.all([
          this.prisma.lead.count({
            where: { companyId, assignedTo: agent.id, status: 'OPEN' },
          }),
          this.prisma.lead.findMany({
            where: { companyId, assignedTo: agent.id, status: 'WON' },
            select: { value: true },
          }),
          this.prisma.lead.count({
            where: { companyId, assignedTo: agent.id, status: 'LOST' },
          }),
        ]);

        return {
          agentId: agent.id,
          agentName: agent.name,
          openLeads: assigned,
          wonCount: won.length,
          wonValue: aNumeroParaMostrar(suma(...won.map((l) => l.value))),
          lostCount: lost,
        };
      }),
    );

    return results.sort((a, b) => b.wonValue - a.wonValue);
  }

  async getLostReasons(companyId: string) {
    const lostLeads = await this.prisma.lead.findMany({
      where: { companyId, status: 'LOST' },
      select: { lostReason: true },
    });

    const counts = new Map<string, number>();
    for (const lead of lostLeads) {
      const reason = lead.lostReason || 'Sin especificar';
      counts.set(reason, (counts.get(reason) || 0) + 1);
    }

    return Array.from(counts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);
  }

  async getOverdueTasksCount(companyId: string) {
    return this.prisma.task.count({
      where: {
        companyId,
        dueDate: { lt: new Date() },
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
    });
  }

  async getPendingConversationsCount(companyId: string) {
    return this.prisma.conversation.count({
      where: { companyId, status: { in: ['OPEN', 'PENDING'] } },
    });
  }

  /**
   * Serie diaria de oportunidades abiertas y ganadas.
   *
   * POR QUÉ EXISTE. El resto de `analytics` devuelve fotos fijas: cuántas hay
   * ahora, cuánto suman ahora. Ninguna dice si la semana va mejor o peor que
   * la anterior, que es justo lo que pide una pantalla de inicio. Sin esto,
   * cualquier flecha de tendencia de la interfaz sería inventada.
   *
   * DE DÓNDE SALE CADA FECHA, Y POR QUÉ NO DE `updatedAt`:
   *
   *   · **Abierta** usa `lead.createdAt`. Es exacto: la oportunidad nació ese
   *     día y ese campo no vuelve a moverse.
   *   · **Ganada** usa el ÚLTIMO cambio de etapa registrado en
   *     `LeadStageHistory`. Es la única marca de tiempo del modelo que
   *     corresponde a un hecho comercial. `updatedAt` habría sido más cómodo y
   *     habría estado mal: cambia al corregir un teléfono, así que una venta
   *     de marzo se dibujaría en la columna de hoy.
   *   · Una oportunidad ganada **sin** historial de etapa no se coloca en
   *     ningún día: se cuenta aparte en `wonWithoutDate`. Repartirla o
   *     empujarla al último día sería fabricar un dato.
   *
   * La ventana previa del mismo tamaño se devuelve entera para que la
   * comparación se calcule con los mismos criterios, y no con dos consultas
   * que podrían divergir.
   */
  async getSalesTrend(companyId: string, days?: number) {
    const dias = Math.min(90, Math.max(7, Math.trunc(Number(days)) || 30));

    const finExclusivo = comienzoDelDia(new Date());
    finExclusivo.setDate(finExclusivo.getDate() + 1);
    const inicio = new Date(finExclusivo);
    inicio.setDate(inicio.getDate() - dias);
    const inicioPrevio = new Date(inicio);
    inicioPrevio.setDate(inicioPrevio.getDate() - dias);

    const [creadas, ganadas] = await Promise.all([
      // `companyId` va DENTRO de la consulta, nunca filtrado después en
      // memoria: es la regla de aislamiento de todo el repositorio.
      this.prisma.lead.findMany({
        where: {
          companyId,
          createdAt: { gte: inicioPrevio, lt: finExclusivo },
        },
        select: { createdAt: true, value: true },
      }),
      this.prisma.lead.findMany({
        where: { companyId, status: 'WON' },
        select: {
          value: true,
          stageHistory: {
            orderBy: { changedAt: 'desc' },
            take: 1,
            select: { changedAt: true },
          },
        },
      }),
    ]);

    const puntos = new Map<string, PuntoTendencia>();
    for (let i = 0; i < dias; i++) {
      const dia = new Date(inicio);
      dia.setDate(dia.getDate() + i);
      puntos.set(claveDeDia(dia), {
        date: claveDeDia(dia),
        openedCount: 0,
        openedValue: 0,
        wonCount: 0,
        wonValue: 0,
      });
    }

    const acumuladoActual = nuevoAcumulado();
    const acumuladoPrevio = nuevoAcumulado();
    let wonWithoutDate = 0;

    for (const lead of creadas) {
      const enVentanaActual = lead.createdAt >= inicio;
      const destino = enVentanaActual ? acumuladoActual : acumuladoPrevio;
      destino.openedCount += 1;
      destino.openedValue.push(lead.value);
      if (enVentanaActual) {
        const punto = puntos.get(claveDeDia(lead.createdAt));
        if (punto) {
          punto.openedCount += 1;
          punto.openedValue = aNumeroParaMostrar(
            suma(punto.openedValue, lead.value ?? 0),
          );
        }
      }
    }

    for (const lead of ganadas) {
      const cerrada = lead.stageHistory[0]?.changedAt;
      if (!cerrada) {
        wonWithoutDate += 1;
        continue;
      }
      if (cerrada >= finExclusivo || cerrada < inicioPrevio) continue;
      const enVentanaActual = cerrada >= inicio;
      const destino = enVentanaActual ? acumuladoActual : acumuladoPrevio;
      destino.wonCount += 1;
      destino.wonValue.push(lead.value);
      if (enVentanaActual) {
        const punto = puntos.get(claveDeDia(cerrada));
        if (punto) {
          punto.wonCount += 1;
          punto.wonValue = aNumeroParaMostrar(
            suma(punto.wonValue, lead.value ?? 0),
          );
        }
      }
    }

    return {
      days: dias,
      from: claveDeDia(inicio),
      to: claveDeDia(new Date(finExclusivo.getTime() - 1)),
      points: Array.from(puntos.values()),
      totals: cerrarAcumulado(acumuladoActual),
      previous: cerrarAcumulado(acumuladoPrevio),
      wonWithoutDate,
    };
  }

  /**
   * Actividad reciente de LA EMPRESA, leída de la auditoría.
   *
   * POR QUÉ NO SE REUSAN LAS NOTIFICACIONES. El inicio enseñaba aquí
   * `notifications`, que es la bandeja PERSONAL de cada usuario: una empresa
   * puede llevar semanas trabajando y tener el panel vacío porque nadie ha
   * generado un aviso dirigido a quien mira. La auditoría sí registra lo que
   * pasó en la empresa, y es lo que el mockup pide en ese hueco.
   *
   * QUÉ NO SALE DE AQUÍ, Y ES DELIBERADO: `metadata` (lleva valores antiguos y
   * nuevos de lo que se cambió), `reason` (texto libre escrito por una
   * persona), `entityId`, `ipAddress` y `userAgent`. Un panel de inicio
   * necesita saber QUÉ ocurrió y QUIÉN lo hizo; el detalle vive en la pantalla
   * de auditoría, que tiene sus propios permisos.
   */
  async getRecentActivity(companyId: string, limit?: number) {
    const limite = Math.min(20, Math.max(1, Math.trunc(Number(limit)) || 8));

    const filas = await this.prisma.auditLog.findMany({
      where: { affectedCompanyId: companyId },
      orderBy: { createdAt: 'desc' },
      take: limite,
      select: {
        id: true,
        action: true,
        entityType: true,
        createdAt: true,
        actor: { select: { name: true } },
      },
    });

    return filas.map((f) => ({
      id: f.id,
      action: f.action,
      entityType: f.entityType,
      createdAt: f.createdAt,
      // El actor puede haber sido dado de baja: la clave foránea es `SetNull`
      // y la auditoría sobrevive a propósito. `null` se traduce en pantalla.
      actorName: f.actor?.name ?? null,
    }));
  }
}

export interface PuntoTendencia {
  date: string;
  openedCount: number;
  openedValue: number;
  wonCount: number;
  wonValue: number;
}

interface Acumulado {
  openedCount: number;
  openedValue: (Prisma.Decimal | null)[];
  wonCount: number;
  wonValue: (Prisma.Decimal | null)[];
}

function nuevoAcumulado(): Acumulado {
  return { openedCount: 0, openedValue: [], wonCount: 0, wonValue: [] };
}

function cerrarAcumulado(a: Acumulado) {
  return {
    openedCount: a.openedCount,
    openedValue: aNumeroParaMostrar(suma(...a.openedValue.map((v) => v ?? 0))),
    wonCount: a.wonCount,
    wonValue: aNumeroParaMostrar(suma(...a.wonValue.map((v) => v ?? 0))),
  };
}

function comienzoDelDia(fecha: Date): Date {
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * `YYYY-MM-DD` en la hora LOCAL del servidor, no en UTC.
 *
 * `toISOString()` habría sido más corto y habría movido de día todo lo
 * ocurrido después de las 19:00 en Bogotá: una venta del lunes por la noche
 * aparecería el martes.
 */
function claveDeDia(fecha: Date): string {
  const d = comienzoDelDia(fecha);
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}
