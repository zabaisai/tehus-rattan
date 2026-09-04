import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { BusinessTenantGuard } from '../../common/guards/business-tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformAuditLogService } from '../platform/platform-audit-log.service';
import { PipelineService } from './pipeline.service';
import { PipelineRetiroService } from './pipeline-retiro.service';
import { CreatePipelineDto } from './dto/create-pipeline.dto';
import { UpdatePipelineDto } from './dto/update-pipeline.dto';
import { CreateStageDto } from './dto/create-stage.dto';
import { UpdateStageDto } from './dto/update-stage.dto';
import { ReorderStagesDto } from './dto/reorder-stages.dto';
import { TrasladarOportunidadesDto } from './dto/trasladar-oportunidades.dto';
import { ReordenarPipelinesDto } from './dto/reordenar-pipelines.dto';

@UseGuards(AuthGuard('jwt'), BusinessTenantGuard, RolesGuard)
@Controller('pipelines')
export class PipelineController {
  constructor(
    private pipelineService: PipelineService,
    private retiro: PipelineRetiroService,
    private auditoria: PlatformAuditLogService,
    private prisma: PrismaService,
  ) {}

  /**
   * Retirar un embudo mueve o esconde el trabajo de todo un equipo. Sin
   * registro, «¿donde estan mis oportunidades?» no tiene respuesta.
   *
   * El fallo del registro NO tumba la accion: ya esta hecha, y devolver un
   * error haria que se reintentara sobre algo que ya ocurrio.
   */
  private async auditar(
    req: any,
    accion: string,
    entityId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.auditoria
      .record(this.prisma, {
        actorUserId: req.user.sub,
        actorRole: req.user.role,
        affectedCompanyId: req.user.companyId,
        action: accion,
        entityType: 'Pipeline',
        entityId,
        ...(metadata ? { metadata: metadata as any } : {}),
      })
      .catch(() => undefined);
  }

  @Get()
  findAll(
    @Request() req: any,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.pipelineService.findAll(
      req.user.companyId,
      includeArchived === 'true',
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.pipelineService.findById(id, req.user.companyId);
  }

  @Get(':id/kanban')
  getKanban(@Param('id') id: string, @Request() req: any) {
    return this.pipelineService.getKanban(id, req.user.companyId);
  }

  @Get(':id/stages')
  findStages(@Param('id') id: string, @Request() req: any) {
    return this.pipelineService.findStages(id, req.user.companyId);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Post()
  async create(@Request() req: any, @Body() body: CreatePipelineDto) {
    const r = await this.pipelineService.create(req.user.companyId, body);
    await this.auditar(req, 'pipeline.create', r.id, {
      fields: Object.keys(body),
    });
    return r;
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: UpdatePipelineDto,
  ) {
    const r = await this.pipelineService.update(id, req.user.companyId, body);
    // Qué campos se tocaron, no con qué valores: el nombre y el orden están
    // en el propio embudo; marcar predeterminado sí se anota porque cambia a
    // dónde entran las oportunidades nuevas.
    await this.auditar(req, 'pipeline.update', id, {
      fields: Object.keys(body),
      ...(body.isDefault ? { isDefault: true } : {}),
    });
    return r;
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Delete(':id')
  async remove(@Param('id') id: string, @Request() req: any) {
    const r = await this.pipelineService.remove(id, req.user.companyId);
    await this.auditar(req, 'pipeline.delete', id);
    return r;
  }

  /**
   * Que hay dentro del embudo antes de retirarlo. Solo lectura: la interfaz
   * pinta los botones a partir de esto en vez de deducirlo por su cuenta.
   */
  @Get(':id/retiro')
  resumenDeRetiro(@Param('id') id: string, @Request() req: any) {
    return this.retiro.resumen(id, req.user.companyId);
  }

  /** Mueve TODAS las oportunidades del embudo a una etapa de otro. */
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Post(':id/trasladar-oportunidades')
  async trasladar(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: TrasladarOportunidadesDto,
  ) {
    const r = await this.retiro.trasladarOportunidades(id, req.user.companyId, {
      pipelineId: body.pipelineDestinoId,
      stageId: body.etapaDestinoId,
    });
    await this.auditar(req, 'pipeline.leads.move', id, {
      trasladadas: r.trasladadas,
      destino: body.pipelineDestinoId,
      etapaDestino: body.etapaDestinoId,
    });
    return r;
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Post(':id/archivar')
  async archivar(@Param('id') id: string, @Request() req: any) {
    const r = await this.retiro.archivar(id, req.user.companyId);
    if (r.archivado) {
      await this.auditar(req, 'pipeline.archive', id, {
        oportunidades: r.oportunidades,
      });
    }
    return r;
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Post(':id/restaurar')
  async restaurar(@Param('id') id: string, @Request() req: any) {
    const r = await this.retiro.restaurar(id, req.user.companyId);
    if (r.restaurado) await this.auditar(req, 'pipeline.restore', id);
    return r;
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Patch('reordenar/embudos')
  async reordenar(@Request() req: any, @Body() body: ReordenarPipelinesDto) {
    const r = await this.retiro.reordenar(req.user.companyId, body.pipelines);
    await this.auditar(req, 'pipeline.reorder', 'embudos', {
      reordenados: r.reordenados,
    });
    return r;
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Post(':id/stages')
  async createStage(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: CreateStageDto,
  ) {
    const r = await this.pipelineService.createStage(
      id,
      req.user.companyId,
      body,
    );
    await this.auditar(req, 'pipeline.stage.create', id, {
      stageId: r.id,
      type: r.type,
      isInitial: r.isInitial,
    });
    return r;
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Patch(':id/stages/reorder')
  async reorderStages(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: ReorderStagesDto,
  ) {
    const r = await this.pipelineService.reorderStages(
      id,
      req.user.companyId,
      body.stages,
    );
    await this.auditar(req, 'pipeline.stages.reorder', id, {
      etapas: body.stages.length,
    });
    return r;
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Patch(':id/stages/:stageId')
  async updateStage(
    @Param('id') id: string,
    @Param('stageId') stageId: string,
    @Request() req: any,
    @Body() body: UpdateStageDto,
  ) {
    const r = await this.pipelineService.updateStage(
      id,
      stageId,
      req.user.companyId,
      body,
    );
    await this.auditar(req, 'pipeline.stage.update', id, {
      stageId,
      fields: Object.keys(body),
    });
    return r;
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Delete(':id/stages/:stageId')
  async removeStage(
    @Param('id') id: string,
    @Param('stageId') stageId: string,
    @Request() req: any,
  ) {
    const r = await this.pipelineService.removeStage(
      id,
      stageId,
      req.user.companyId,
    );
    await this.auditar(req, 'pipeline.stage.delete', id, { stageId });
    return r;
  }
}
