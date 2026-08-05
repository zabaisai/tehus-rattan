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
  create(@Request() req: any, @Body() body: CreatePipelineDto) {
    return this.pipelineService.create(req.user.companyId, body);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: UpdatePipelineDto,
  ) {
    return this.pipelineService.update(id, req.user.companyId, body);
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
  reordenar(@Request() req: any, @Body() body: ReordenarPipelinesDto) {
    return this.retiro.reordenar(req.user.companyId, body.pipelines);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Post(':id/stages')
  createStage(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: CreateStageDto,
  ) {
    return this.pipelineService.createStage(id, req.user.companyId, body);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Patch(':id/stages/reorder')
  reorderStages(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: ReorderStagesDto,
  ) {
    return this.pipelineService.reorderStages(
      id,
      req.user.companyId,
      body.stages,
    );
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Patch(':id/stages/:stageId')
  updateStage(
    @Param('id') id: string,
    @Param('stageId') stageId: string,
    @Request() req: any,
    @Body() body: UpdateStageDto,
  ) {
    return this.pipelineService.updateStage(
      id,
      stageId,
      req.user.companyId,
      body,
    );
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Delete(':id/stages/:stageId')
  removeStage(
    @Param('id') id: string,
    @Param('stageId') stageId: string,
    @Request() req: any,
  ) {
    return this.pipelineService.removeStage(id, stageId, req.user.companyId);
  }
}
