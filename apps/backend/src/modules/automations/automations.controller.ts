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
import { AutomationsService } from './automations.service';
import { AutomationRunsService } from './automation-runs.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAutomationDto } from './dto/create-automation.dto';
import { UpdateAutomationDto } from './dto/update-automation.dto';

@UseGuards(AuthGuard('jwt'), BusinessTenantGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@Controller('automations')
export class AutomationsController {
  constructor(
    private automationsService: AutomationsService,
    private runsService: AutomationRunsService,
    private prisma: PrismaService,
  ) {}

  /**
   * Historial de ejecuciones. Antes de `:id` para que la ruta literal gane:
   * si no, `runs` se interpretaria como el id de una automatizacion.
   */
  @Get('runs')
  runs(
    @Request() req: any,
    @Query('automationId') automationId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.runsService.listar(this.prisma, req.user.companyId, {
      automationId,
      status,
      limit: limit ? Number(limit) : undefined,
    });
  }

  /** Versiones publicadas de una automatizacion, la mas reciente primero. */
  @Get(':id/versions')
  async versions(@Param('id') id: string, @Request() req: any) {
    // Acotado por empresa en la propia consulta: pedir las versiones de una
    // automatizacion ajena no debe devolver nada, ni siquiera un 404 que
    // confirme que existe.
    return this.prisma.automationVersion.findMany({
      where: { automationId: id, automation: { companyId: req.user.companyId } },
      orderBy: { version: 'desc' },
      take: 20,
    });
  }

  @Get()
  findAll(@Request() req: any) {
    return this.automationsService.findAll(req.user.companyId);
  }

  @Post()
  create(@Request() req: any, @Body() body: CreateAutomationDto) {
    return this.automationsService.create(req.user.companyId, body, req.user.sub);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: UpdateAutomationDto,
  ) {
    return this.automationsService.update(
      id,
      req.user.companyId,
      body,
      req.user.sub,
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: any) {
    return this.automationsService.remove(id, req.user.companyId);
  }
}
