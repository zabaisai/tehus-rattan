import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CustomFieldEntity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessTenantGuard } from '../../common/guards/business-tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PlatformAuditLogService } from '../platform/platform-audit-log.service';
import { CustomFieldsService } from './custom-fields.service';
import {
  ActualizarCampoDto,
  CrearCampoDto,
  EstablecerValorDto,
} from './dto/custom-field.dto';

/**
 * API de campos personalizados.
 *
 * PERMISOS DELIBERADAMENTE ASIMÉTRICOS:
 *
 *   - DEFINIR campos es de ADMIN. Un campo mal definido —tipo equivocado,
 *     obligatorio por error— afecta a toda la empresa y a todos los bots.
 *   - LEER y ESCRIBIR valores lo puede hacer cualquier asesor: es su trabajo
 *     diario capturar datos del cliente mientras conversa.
 *
 * El `companyId` sale SIEMPRE del token, nunca del cuerpo ni de la ruta. Si
 * viniera del cliente, cambiarlo sería todo lo que haría falta para leer los
 * campos de otra empresa.
 */
@UseGuards(AuthGuard('jwt'), BusinessTenantGuard, RolesGuard)
@Controller('custom-fields')
export class CustomFieldsController {
  constructor(
    private readonly campos: CustomFieldsService,
    private readonly auditoria: PlatformAuditLogService,
    private readonly prisma: PrismaService,
  ) {}

  // ── definiciones ────────────────────────────────────────────

  @Get('definitions')
  listar(
    @Request() req: any,
    @Query('entity') entity?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.campos.listarDefiniciones(
      req.user.companyId,
      this.entidad(entity),
      includeInactive === 'true',
    );
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Post('definitions')
  async crear(@Request() req: any, @Body() body: CrearCampoDto) {
    const creado = await this.campos.crearDefinicion(req.user.companyId, body);

    // Definir un campo SÍ va a `AuditLog`: lo hace una persona con un rol, que
    // es exactamente lo que ese registro modela. Los cambios de VALOR van al
    // historial propio, porque muchas veces los hace un bot.
    await this.auditoria
      .record(this.prisma, {
        actorUserId: req.user.sub,
        actorRole: req.user.role,
        affectedCompanyId: req.user.companyId,
        action: 'custom_field.create',
        entityType: 'CustomFieldDefinition',
        entityId: creado.id,
        metadata: { key: creado.key, type: creado.type, entity: creado.entity },
      })
      .catch(() => undefined);

    return creado;
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Patch('definitions/:id')
  async actualizar(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: ActualizarCampoDto,
  ) {
    const actualizado = await this.campos.actualizarDefinicion(
      req.user.companyId,
      id,
      body,
    );
    await this.auditoria
      .record(this.prisma, {
        actorUserId: req.user.sub,
        actorRole: req.user.role,
        affectedCompanyId: req.user.companyId,
        action: 'custom_field.update',
        entityType: 'CustomFieldDefinition',
        entityId: id,
        // Solo QUÉ se tocó, no los valores: una etiqueta puede llevar datos
        // del negocio y el registro de auditoría se lee en soporte.
        metadata: { camposTocados: Object.keys(body) },
      })
      .catch(() => undefined);
    return actualizado;
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Delete('definitions/:id')
  async desactivar(@Request() req: any, @Param('id') id: string) {
    const r = await this.campos.desactivarDefinicion(req.user.companyId, id);
    await this.auditoria
      .record(this.prisma, {
        actorUserId: req.user.sub,
        actorRole: req.user.role,
        affectedCompanyId: req.user.companyId,
        action: 'custom_field.deactivate',
        entityType: 'CustomFieldDefinition',
        entityId: id,
      })
      .catch(() => undefined);
    return r;
  }

  // ── valores ─────────────────────────────────────────────────

  @Get('values')
  valores(
    @Request() req: any,
    @Query('entity') entity: string,
    @Query('entityId') entityId: string,
  ) {
    if (!entityId) throw new BadRequestException('Falta entityId');
    return this.campos.leerValores(
      req.user.companyId,
      this.entidadObligatoria(entity),
      entityId,
    );
  }

  @Post('values')
  async establecer(@Request() req: any, @Body() body: EstablecerValorDto) {
    const r = await this.campos.establecerPorClave({
      companyId: req.user.companyId,
      entity: body.entity,
      key: body.key,
      valor: body.valor ?? null,
      destino: { contactId: body.contactId, leadId: body.leadId },
      origen: { source: 'USER', actorUserId: req.user.sub },
    });

    // Un campo inexistente o un valor inválido son errores del cliente, no
    // fallos del servidor: se traducen a 400 con el motivo tal cual, que es
    // el texto que la interfaz puede mostrar sin reinterpretarlo.
    if (!r.ok) throw new BadRequestException(r.motivo);
    return r;
  }

  @Get('history')
  historial(
    @Request() req: any,
    @Query('entity') entity?: string,
    @Query('entityId') entityId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.campos.historial(req.user.companyId, {
      entity: this.entidad(entity),
      entityId,
      limite: limit ? Number(limit) : undefined,
    });
  }

  private entidad(valor?: string): CustomFieldEntity | undefined {
    if (!valor) return undefined;
    if (valor === 'CONTACT' || valor === 'LEAD') return valor;
    throw new BadRequestException('entity debe ser CONTACT o LEAD');
  }

  private entidadObligatoria(valor: string): CustomFieldEntity {
    const e = this.entidad(valor);
    if (!e) throw new BadRequestException('Falta entity');
    return e;
  }
}
