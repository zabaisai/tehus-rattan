import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TaskSuggestionStatus } from '@prisma/client';
import { BusinessTenantGuard } from '../../common/guards/business-tenant.guard';
import { RequiresTenantCapability } from '../../common/decorators/requires-tenant-capability.decorator';
import { TenantCapabilityGuard } from '../companies/tenant-capability.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformAuditLogService } from '../platform/platform-audit-log.service';
import { TaskSuggestionsService } from './task-suggestions.service';
import {
  AprobarSugerenciaDto,
  RechazarSugerenciaDto,
} from './dto/decidir-sugerencia.dto';

/**
 * Propuestas de tarea.
 *
 * NO hay endpoint para crearlas a mano desde el navegador: nacen de una regla,
 * de Pulso o de una automatizacion. Lo que se expone aqui es DECIDIRLAS, que
 * es lo que hace una persona.
 */
@UseGuards(
  AuthGuard('jwt'),
  BusinessTenantGuard,
  RolesGuard,
  TenantCapabilityGuard,
)
@RequiresTenantCapability('tasks')
@Controller('task-suggestions')
export class TaskSuggestionsController {
  constructor(
    private sugerencias: TaskSuggestionsService,
    private auditoria: PlatformAuditLogService,
    private prisma: PrismaService,
  ) {}

  @Get()
  listar(
    @Request() req: any,
    @Query('estado') estado?: TaskSuggestionStatus,
    @Query('contactId') contactId?: string,
    @Query('conversationId') conversationId?: string,
    @Query('leadId') leadId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.sugerencias.listar(req.user.companyId, {
      estado,
      contactId,
      conversationId,
      leadId,
      limit: limit ? Number(limit) : undefined,
    });
  }

  /**
   * Aprobar es lo UNICO que crea una tarea real.
   *
   * Cualquier asesor puede decidir sobre las propuestas de su empresa: es su
   * lista de trabajo. Restringirlo a quien administra convertiria la funcion
   * en un cuello de botella y nadie la usaria.
   */
  @Post(':id/aprobar')
  async aprobar(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: AprobarSugerenciaDto,
  ) {
    const r = await this.sugerencias.aprobar(
      id,
      req.user.companyId,
      req.user.sub,
      {
        title: body.title,
        description: body.description,
        priority: body.priority,
        dueAt: body.dueAt ? new Date(body.dueAt) : undefined,
        assignedTo: body.assignedTo,
        note: body.note,
      },
    );

    if (!r.yaEstaba) {
      await this.auditar(req, 'task.suggestion.approve', id, {
        taskId: r.tarea?.id,
      });
    }
    return r;
  }

  @Post(':id/rechazar')
  async rechazar(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: RechazarSugerenciaDto,
  ) {
    const r = await this.sugerencias.rechazar(
      id,
      req.user.companyId,
      req.user.sub,
      body.note,
    );
    await this.auditar(req, 'task.suggestion.reject', id, {
      motivo: body.note ?? null,
    });
    return r;
  }

  /**
   * Aprobar y rechazar quedan registrados.
   *
   * Sin esto, «¿quien decidio que esta tarea existiera?» no tiene respuesta, y
   * la propuesta viene de un bot: es justo el caso en el que hace falta saber
   * que hubo una persona detras.
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
        entityType: 'TaskSuggestion',
        entityId,
        ...(metadata ? { metadata: metadata as any } : {}),
      })
      .catch(() => undefined);
  }
}
