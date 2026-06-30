import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

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

    const openValue = openLeads.reduce((sum, l) => sum + (l.value || 0), 0);
    const wonValue = wonLeads.reduce((sum, l) => sum + (l.value || 0), 0);
    const lostValue = lostLeads.reduce((sum, l) => sum + (l.value || 0), 0);
    const closedCount = wonLeads.length + lostLeads.length;
    const conversionRate = closedCount > 0 ? (wonLeads.length / closedCount) * 100 : 0;

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
      totalValue: stage.leads.reduce((sum, l) => sum + (l.value || 0), 0),
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
          wonValue: won.reduce((sum, l) => sum + (l.value || 0), 0),
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
}