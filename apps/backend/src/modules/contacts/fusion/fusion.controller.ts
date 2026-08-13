import {
  BadRequestException,
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
import { BusinessTenantGuard } from '../../../common/guards/business-tenant.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { PrismaService } from '../../../prisma/prisma.service';
import { PlatformAuditLogService } from '../../platform/platform-audit-log.service';
import { FusionContactosService } from './fusion.service';
import { DescartarDuplicadoDto, FusionarDto } from './fusion.dto';

/**
 * Fusión de contactos duplicados (mockup 22).
 *
 * RUTAS DE DOS SEGMENTOS A PROPÓSITO. `ContactsController` ya declara
 * `GET /contacts/:id`, que en Nest se resuelve por orden de registro: una ruta
 * de un solo segmento como `/contacts/fusion` acabaría entrando por ahí y
 * respondiendo «contacto no encontrado». Con `/contacts/fusion/...` no hay
 * ambigüedad posible.
 *
 * `BusinessTenantGuard` cubre el requisito de que un SUPER_ADMIN sin empresa
 * activa no pueda operar sobre contactos: sin `companyId` en la sesión, ni
 * llega al método.
 */
@UseGuards(AuthGuard('jwt'), BusinessTenantGuard, RolesGuard)
@Controller('contacts')
export class FusionContactosController {
  constructor(
    private fusion: FusionContactosService,
    private auditoria: PlatformAuditLogService,
    private prisma: PrismaService,
  ) {}

  /** Posibles duplicados de un contacto. Solo propone; no cambia nada. */
  @Get(':id/duplicados')
  duplicados(@Param('id') id: string, @Request() req: any) {
    return this.fusion.candidatos(id, req.user.companyId);
  }

  /**
   * A dónde lleva hoy un id que pudo ser absorbido.
   *
   * Lo consume la pantalla para reescribir un enlace antiguo por el del
   * contacto principal en lugar de enseñar un perfil que ya no se opera.
   */
  @Get(':id/canonico')
  canonico(@Param('id') id: string, @Request() req: any) {
    return this.fusion.resolverCanonico(id, req.user.companyId);
  }

  /** Comparación de dos contactos: es la vista previa, y no escribe nada. */
  @Get('fusion/comparar')
  comparar(
    @Request() req: any,
    @Query('principalId') principalId?: string,
    @Query('duplicadoId') duplicadoId?: string,
  ) {
    if (!principalId?.trim() || !duplicadoId?.trim())
      throw new BadRequestException(
        'Hay que indicar `principalId` y `duplicadoId`',
      );
    return this.fusion.comparar(
      principalId.trim(),
      duplicadoId.trim(),
      req.user.companyId,
    );
  }

  /** Estado de una fusión y cuánto queda de la ventana para deshacerla. */
  @Get('fusion/:mergeId/estado')
  estado(@Param('mergeId') mergeId: string, @Request() req: any) {
    return this.fusion.estado(mergeId, req.user.companyId);
  }

  /**
   * «No son duplicados». No toca ninguno de los dos contactos: solo deja de
   * proponer la pareja.
   */
  @Post('fusion/descartar')
  @Roles('ADMIN', 'MANAGER', 'SUPER_ADMIN')
  async descartar(@Request() req: any, @Body() body: DescartarDuplicadoDto) {
    const r = await this.fusion.descartar(
      body.contactoAId,
      body.contactoBId,
      req.user.companyId,
      req.user.sub,
    );
    if (r.nuevo)
      await this.auditar(req, 'contact.merge.dismiss', body.contactoAId, {
        contactoAId: body.contactoAId,
        contactoBId: body.contactoBId,
      });
    return r;
  }

  /**
   * Ejecuta la fusión.
   *
   * ADMIN y MANAGER. Un AGENT no fusiona: la operación reescribe la identidad
   * de una persona y arrastra su historial entero.
   */
  @Post('fusion/ejecutar')
  @Roles('ADMIN', 'MANAGER', 'SUPER_ADMIN')
  async ejecutar(@Request() req: any, @Body() body: FusionarDto) {
    if (!body.confirmoMismaPersona)
      throw new BadRequestException(
        'Falta confirmar que ambos registros son la misma persona',
      );

    const r = await this.fusion.fusionar({
      companyId: req.user.companyId,
      usuarioId: req.user.sub,
      principalId: body.principalId,
      duplicadoId: body.duplicadoId,
      elecciones: body.elecciones ?? {},
      versiones: body.versiones,
    });

    // AUDITORÍA SIN DATOS PERSONALES. Se guardan ids, qué campos se decidieron
    // y cuánto se movió; nunca el nombre, el teléfono, el correo ni el
    // contenido de nada. Quién y cuándo ya van en las columnas de la fila.
    await this.auditar(req, 'contact.merge', body.principalId, {
      mergeId: r.mergeId,
      principalId: r.principalId,
      duplicadoId: r.duplicadoId,
      camposElegidos: this.camposElegidos(body),
      trasladadas: r.trasladadas,
    });

    return r;
  }

  /** Deshacer, dentro de la ventana y solo si sigue siendo seguro. */
  @Post('fusion/:mergeId/deshacer')
  @Roles('ADMIN', 'MANAGER', 'SUPER_ADMIN')
  async deshacer(@Param('mergeId') mergeId: string, @Request() req: any) {
    const r = await this.fusion.deshacer(
      mergeId,
      req.user.companyId,
      req.user.sub,
    );
    await this.auditar(req, 'contact.merge.undo', r.principalId, {
      mergeId: r.mergeId,
      principalId: r.principalId,
      duplicadoId: r.duplicadoId,
    });
    return r;
  }

  /**
   * Qué campos se decidieron, en CLAVES y LADOS. Nunca los valores: registrar
   * «se eligió laura@…» convertiría la auditoría en una copia de los datos
   * personales que precisamente se estaba reorganizando.
   */
  private camposElegidos(body: FusionarDto) {
    return {
      campos: body.elecciones?.campos ?? {},
      camposPersonalizados: Object.keys(
        body.elecciones?.camposPersonalizados ?? {},
      ),
      conservarAlternativas: body.elecciones?.conservarAlternativas !== false,
    };
  }

  /**
   * El fallo del registro NO tumba la operación ya hecha: reintentar una fusión
   * que ya ocurrió es peor que quedarse sin una línea de auditoría, y la fila
   * de `contact_merges` conserva la trazabilidad de todos modos.
   */
  private async auditar(
    req: any,
    accion: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.auditoria
      .record(this.prisma, {
        actorUserId: req.user.sub,
        actorRole: req.user.role,
        affectedCompanyId: req.user.companyId,
        action: accion,
        entityType: 'Contact',
        entityId,
        metadata: metadata as any,
      })
      .catch(() => undefined);
  }
}
