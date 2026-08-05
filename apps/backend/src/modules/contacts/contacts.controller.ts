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
import { BusinessTenantGuard } from '../../common/guards/business-tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformAuditLogService } from '../platform/platform-audit-log.service';
import { ContactsService } from './contacts.service';
import { ContactsEliminacionService } from './contacts-eliminacion.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { EliminarContactoDto } from './dto/eliminar-contacto.dto';

@UseGuards(AuthGuard('jwt'), BusinessTenantGuard, RolesGuard)
@Controller('contacts')
export class ContactsController {
  constructor(
    private contactsService: ContactsService,
    private eliminacion: ContactsEliminacionService,
    private auditoria: PlatformAuditLogService,
    private prisma: PrismaService,
  ) {}

  @Get()
  findAll(
    @Request() req: any,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.contactsService.findAll(req.user.companyId, {
      search,
      limit,
      offset,
      includeArchived: includeArchived === 'true',
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.contactsService.findById(id, req.user.companyId);
  }

  @Post()
  create(@Request() req: any, @Body() body: CreateContactDto) {
    return this.contactsService.create(req.user.companyId, body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: UpdateContactDto,
  ) {
    return this.contactsService.update(id, req.user.companyId, body);
  }

  /**
   * ARCHIVA el contacto. No lo borra.
   *
   * Se mantiene en `DELETE` porque es lo que ya llama la interfaz y porque
   * para quien lo usa el gesto es el mismo; lo que cambia es que deja de
   * destruir el historial. El borrado real va por la solicitud de eliminacion
   * de datos, que es mas lenta a proposito.
   */
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body?: { motivo?: string },
  ) {
    const r = await this.contactsService.remove(
      id,
      req.user.companyId,
      body?.motivo,
    );
    if (r.archivado)
      await this.auditar(req, 'contact.archive', id, body?.motivo);
    return r;
  }

  @Post(':id/restore')
  async restore(@Param('id') id: string, @Request() req: any) {
    const r = await this.contactsService.restore(id, req.user.companyId);
    if (r.restaurado) await this.auditar(req, 'contact.restore', id);
    return r;
  }

  @Post(':id/block')
  block(@Param('id') id: string, @Request() req: any) {
    return this.contactsService.block(id, req.user.companyId);
  }

  /** Los contactos archivados: lo que la interfaz llama papelera. */
  @Get('papelera/listado')
  papelera(
    @Request() req: any,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.eliminacion.papelera(req.user.companyId, {
      limit: limit === undefined ? undefined : Number(limit),
      offset: offset === undefined ? undefined : Number(offset),
    });
  }

  /**
   * Que se llevaria por delante una eliminacion definitiva. Se consulta ANTES
   * de confirmar y es de solo lectura: no cambia nada.
   */
  @Get(':id/impacto')
  impacto(@Param('id') id: string, @Request() req: any) {
    return this.eliminacion.impacto(id, req.user.companyId);
  }

  /**
   * Eliminacion DEFINITIVA. Solo ADMIN: no es una limpieza de escritorio.
   *
   * Exige escribir una frase exacta —no un «aceptar»— porque el gesto no tiene
   * vuelta atras y un dialogo de confirmacion se pulsa sin leerlo.
   */
  @Delete(':id/definitivo')
  @Roles('ADMIN', 'SUPER_ADMIN')
  async eliminarDefinitivo(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: EliminarContactoDto,
  ) {
    const r = await this.eliminacion.eliminarDefinitivo(id, req.user.companyId, {
      confirmacion: body.confirmacion,
      motivo: body.motivo,
    });

    // La auditoria guarda el IMPACTO, no solo el hecho. Sin las cifras, dentro
    // de un año «se elimino este contacto» no dice si se fueron dos mensajes o
    // dos años de conversacion.
    await this.auditar(
      req,
      r.accion === 'borrado'
        ? 'contact.delete.hard'
        : 'contact.delete.anonymize',
      id,
      body.motivo,
      {
        accion: r.accion,
        relaciones: r.impacto.relaciones,
        totalRelaciones: r.impacto.totalRelaciones,
      },
    );

    return r;
  }

  /**
   * Archivar y restaurar quedan registrados.
   *
   * Sin registro, «este contacto desaparecio de la lista» no tiene respuesta:
   * ni quien lo hizo ni cuando ni por que, y la conclusion natural es que el
   * producto perdio datos.
   *
   * El fallo del registro NO tumba la accion: el contacto ya esta archivado y
   * devolver un error haria que se reintentara sobre algo ya hecho.
   */
  private async auditar(
    req: any,
    accion: string,
    entityId: string,
    motivo?: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.auditoria
      .record(this.prisma, {
        actorUserId: req.user.sub,
        actorRole: req.user.role,
        affectedCompanyId: req.user.companyId,
        action: accion,
        entityType: 'Contact',
        entityId,
        ...(motivo?.trim() ? { reason: motivo.trim() } : {}),
        ...(metadata ? { metadata: metadata as any } : {}),
      })
      .catch(() => undefined);
  }
}
