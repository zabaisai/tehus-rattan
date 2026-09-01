import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FlowBotStatus, FlowBotTriggerType } from '@prisma/client';
import { BusinessTenantGuard } from '../../../common/guards/business-tenant.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { FlowBotSupportGuard } from './flowbot-support.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { PlatformAuditLogService } from '../../platform/platform-audit-log.service';
import { FlowBotAdminService } from './flowbot.admin.service';
import { FlowBotTriggersService } from './flowbot.triggers.service';
import { FlowBotExecutionsService } from './flowbot.executions.service';
import { FlowBotMetricsService } from './flowbot.metrics.service';
import { FlowBotSimulatorService } from './flowbot.simulator.service';
import { FlowBotEffectsFactory } from '../engine/flowbot.effects.factory';
import { FlowBotKillSwitchService } from '../engine/flowbot.kill-switch.service';
import { GuardarrailesWhatsApp } from '../engine/adapters/flowbot.whatsapp.guardarrailes';
import { construirCatalogo } from './flowbot.contracts';
import {
  CrearBotDto,
  CrearDisparadorDto,
  EntradaSimulacionBodyDto,
  GuardarBorradorDto,
  OperacionEjecucionDto,
  OrdenarDisparadoresDto,
  PublicarDto,
  RenombrarBotDto,
  ActualizarDisparadorDto,
  ForzarHandoffDto,
  ImportarPulsoDto,
  ReiniciarBreakerDto,
  KillSwitchDto,
  UsarPlantillaDto,
  CambiarEstadoDto,
  ValidarGrafoDto,
} from './dto/flowbot.dto';

/**
 * API administrativa de FlowBot.
 *
 * PERMISOS, Y POR QUÉ SON ASÍ:
 *
 *   ADMIN    control completo, incluidas credenciales y configuración.
 *   MANAGER  diseña, simula y publica bots; ve todas las ejecuciones e
 *            interviene en handoff. NO toca credenciales ni integraciones:
 *            quien diseña flujos no necesita las claves de WhatsApp, y dárselas
 *            es ampliar el radio de un incidente sin ganar nada.
 *   AGENT    consulta y opera SOBRE LO SUYO. No crea ni publica bots.
 *
 * El `companyId` sale SIEMPRE de `req.user`, nunca del cuerpo ni de la query.
 * Si viniera del cliente, cambiarlo sería todo lo que haría falta para
 * administrar los bots de otra empresa.
 */
// EL ORDEN IMPORTA, y no es el obvio. `FlowBotSupportGuard` va DESPUES de la
// autenticacion —necesita el `req.user` resuelto para saber si es plataforma—
// pero ANTES de `BusinessTenantGuard`: un `SUPER_ADMIN` de plataforma llega sin
// `companyId`, asi que el guarda de empresa lo rechazaria antes de que nadie
// mirara si tiene sesion de soporte, y el 403 diria «necesitas una empresa» en
// vez de «necesitas una sesion de soporte». Puesto aqui, la sesion FIJA la
// empresa y `BusinessTenantGuard` la comprueba como la de cualquier otro: sigue
// sin existir una ruta que no pase por el filtro de empresa.
@UseGuards(
  AuthGuard('jwt'),
  FlowBotSupportGuard,
  BusinessTenantGuard,
  RolesGuard,
)
@Controller('flowbots')
export class FlowBotController {
  constructor(
    private readonly admin: FlowBotAdminService,
    private readonly triggers: FlowBotTriggersService,
    private readonly ejecuciones: FlowBotExecutionsService,
    private readonly metricas: FlowBotMetricsService,
    private readonly simulador: FlowBotSimulatorService,
    private readonly auditoria: PlatformAuditLogService,
    private readonly prisma: PrismaService,
    private readonly efectos: FlowBotEffectsFactory,
    private readonly killSwitch: FlowBotKillSwitchService,
    private readonly guardarrailes: GuardarrailesWhatsApp,
  ) {}

  // ── estado operativo ────────────────────────────────────────

  /**
   * En qué modo está el envío de WhatsApp y si los bots están parados.
   *
   * LO VE CUALQUIERA CON ACCESO, incluido un AGENT: saber si los mensajes
   * están saliendo de verdad no es un dato sensible, y esconderlo produce el
   * peor malentendido posible —alguien probando un bot en modo de prueba y
   * creyendo que su cliente ya recibió la respuesta—.
   *
   * NO devuelve las listas de permitidos ni ninguna credencial: solo el modo
   * y el estado. Quién está en la lista de pruebas es configuración de
   * despliegue, no información de producto.
   */
  @Get('operational-status')
  async estadoOperativo(@Request() req: any) {
    const [kill, contadorDisponible] = await Promise.all([
      this.killSwitch.estado(),
      this.guardarrailes.contadorDisponible(),
    ]);
    const modo = this.efectos.modoConfigurado();

    // UN AGENT VE EL MODO Y NADA MÁS. Saber si los mensajes salen de verdad le
    // afecta a su conversación; los límites, el estado de cada número y la
    // cola son configuración de plataforma y en su pantalla solo serían ruido.
    const esAgente = req.user.role === 'AGENT';

    const base = {
      modo,
      // Texto ya redactado: la pantalla lo enseña tal cual y así dice lo mismo
      // en todos los sitios donde aparezca.
      etiqueta:
        modo === 'real'
          ? 'FlowBot está enviando mensajes reales'
          : modo === 'dry-run'
            ? 'Modo de prueba: FlowBot no está enviando mensajes reales'
            : 'FlowBot no está conectado a WhatsApp: no sale ningún mensaje',
      enviaDeVerdad: modo === 'real' && !kill.activo && contadorDisponible,
      killSwitch: kill,
    };

    if (esAgente) return base;

    // Estado por número: solo los de ESTA empresa. El `companyId` sale del
    // token, así que un administrador no puede pedir el de otra.
    const numeros = await this.prisma.whatsAppIntegration.findMany({
      where: { companyId: req.user.companyId },
      orderBy: [{ isPrimary: 'desc' }, { order: 'asc' }, { id: 'asc' }],
      // NUNCA el token, ni siquiera cifrado: esta respuesta va al navegador.
      select: {
        id: true,
        phoneNumberId: true,
        displayPhoneNumber: true,
        label: true,
        status: true,
      },
    });

    const breakers = await Promise.all(
      numeros.map(async (n) => ({
        integrationId: n.id,
        // El número visible se enseña porque es de la propia empresa y es lo
        // único que permite saber de cuál se habla.
        etiqueta: n.label || n.displayPhoneNumber || n.phoneNumberId,
        estadoIntegracion: n.status,
        breaker: await this.guardarrailes.fotoBreaker(n.id),
      })),
    );

    const necesitanAtencion = await this.prisma.flowBotExecution.count({
      where: { companyId: req.user.companyId, status: 'NEEDS_ATTENTION' },
    });

    return {
      ...base,
      contador: {
        disponible: contadorDisponible,
        // Los límites configurados, SIN destinatarios ni identificadores: son
        // números de configuración, no datos de nadie.
        limites: this.guardarrailes.limitesConfigurados(),
      },
      numeros: breakers,
      ejecucionesEnAtencion: necesitanAtencion,
    };
  }

  /**
   * Levanta el breaker de un número.
   *
   * NO SALTA NINGÚN OTRO GUARDARRAÍL. Cerrar el breaker solo dice «vuelve a
   * intentarlo»: el interruptor de emergencia, las listas de permitidos y el
   * contador de frecuencia siguen exactamente donde estaban. Quien lo pulse
   * esperando desbloquear un envío que el kill switch impide, no lo consigue.
   */
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Post('integrations/:integrationId/reset-breaker')
  async reiniciarBreaker(
    @Request() req: any,
    @Param('integrationId') integrationId: string,
    @Body() body: ReiniciarBreakerDto,
  ) {
    if (!body?.motivo?.trim()) {
      throw new BadRequestException(
        'Para reiniciar hay que escribir por qué: es lo que se lee después',
      );
    }

    // Acotado por empresa: sin esto, un identificador de otra empresa serviría
    // para tocar su número.
    const numero = await this.prisma.whatsAppIntegration.findFirst({
      where: { id: integrationId, companyId: req.user.companyId },
      select: { id: true },
    });
    if (!numero) throw new NotFoundException('Número no encontrado');

    await this.guardarrailes.reiniciarBreaker(numero.id);
    await this.auditar(
      req,
      'flowbot.breaker.reset',
      numero.id,
      { integrationId: numero.id },
      body.motivo,
    );

    return {
      reiniciado: true,
      breaker: await this.guardarrailes.fotoBreaker(numero.id),
    };
  }

  /**
   * Enciende o apaga el interruptor de emergencia.
   *
   * SOLO PLATAFORMA. Para la mensajería de TODAS las empresas, así que no es
   * una decisión que pueda tomar el administrador de una sola. Un SUPER_ADMIN
   * de plataforma llega aquí por sesión de soporte, como a todo lo demás.
   */
  @Roles('SUPER_ADMIN')
  @Post('kill-switch')
  async cambiarKillSwitch(@Request() req: any, @Body() body: KillSwitchDto) {
    if (typeof body?.activo !== 'boolean') {
      throw new BadRequestException(
        'Falta indicar si se activa o se desactiva',
      );
    }
    // Activar sin motivo deja la pregunta «¿por qué están parados los bots?»
    // sin respuesta justo cuando más urge.
    if (body.activo && !body.motivo?.trim()) {
      throw new BadRequestException(
        'Para parar los envíos hay que escribir por qué',
      );
    }

    return this.killSwitch.cambiar({
      activo: body.activo,
      motivo: body.motivo,
      actorUserId: req.user.sub,
      actorRole: req.user.role,
    });
  }

  // ── catálogo ────────────────────────────────────────────────

  /**
   * El catálogo de nodos.
   *
   * Lo puede leer cualquiera con acceso: es la definición del producto, no
   * datos de la empresa. Y es la razón por la que el editor no mantiene su
   * propia lista.
   */
  @Get('catalog')
  catalogo() {
    return construirCatalogo();
  }

  /** Las plantillas oficiales. Ninguna se publica sola. */
  @Get('templates')
  plantillas() {
    return this.admin.listarPlantillas();
  }

  @Roles('ADMIN', 'MANAGER', 'SUPER_ADMIN')
  @Post('templates/:clave/use')
  async usarPlantilla(
    @Request() req: any,
    @Param('clave') clave: string,
    @Body() body: UsarPlantillaDto,
  ) {
    const bot = await this.admin.crearDesdePlantilla(
      req.user.companyId,
      req.user.sub,
      clave,
      body?.nombre,
    );
    await this.auditar(req, 'flowbot.template.use', bot.id, {
      plantilla: clave,
    });
    return bot;
  }

  // ── bots ────────────────────────────────────────────────────

  @Get()
  listar(
    @Request() req: any,
    @Query('q') q?: string,
    @Query('estado') estado?: string,
    @Query('incluirArchivados') incluirArchivados?: string,
    @Query('plantillas') plantillas?: string,
  ) {
    return this.admin.listar(req.user.companyId, {
      busqueda: q,
      estado: this.estado(estado),
      incluirArchivados: incluirArchivados === 'true',
      soloPlantillas: plantillas === 'true',
    });
  }

  @Get(':id')
  detalle(@Request() req: any, @Param('id') id: string) {
    return this.admin.detalle(req.user.companyId, id);
  }

  @Roles('ADMIN', 'MANAGER', 'SUPER_ADMIN')
  @Post()
  async crear(@Request() req: any, @Body() body: CrearBotDto) {
    const bot = await this.admin.crear(req.user.companyId, req.user.sub, {
      nombre: body.nombre,
      descripcion: body.descripcion,
      graph: body.graph,
    });
    await this.auditar(req, 'flowbot.create', bot.id, { nombre: bot.name });
    return bot;
  }

  @Roles('ADMIN', 'MANAGER', 'SUPER_ADMIN')
  @Post(':id/duplicate')
  async duplicar(@Request() req: any, @Param('id') id: string) {
    const bot = await this.admin.duplicar(req.user.companyId, req.user.sub, id);
    await this.auditar(req, 'flowbot.duplicate', bot.id, { origen: id });
    return bot;
  }

  /**
   * Exporta el bot a `.taktoflow.json`.
   *
   * Solo lectura, pero restringido a quien puede editar: el archivo describe
   * como trabaja la empresa por dentro.
   */
  @Roles('ADMIN', 'MANAGER', 'SUPER_ADMIN')
  @Get(':id/export')
  async exportar(@Request() req: any, @Param('id') id: string) {
    const sobre = await this.admin.exportar(req.user.companyId, id);
    await this.auditar(req, 'flowbot.export', id, {
      nodos: sobre.grafo.nodes.length,
      requisitos: sobre.requisitos.length,
    });
    return sobre;
  }

  /**
   * Analiza un archivo SIN importarlo. Es la vista previa.
   *
   * Existe aparte para que nadie tenga que crear un bot solo para descubrir
   * que el archivo no servia.
   */
  @Roles('ADMIN', 'MANAGER', 'SUPER_ADMIN')
  @Post('import/preview')
  analizar(@Body() body: ImportarPulsoDto) {
    const r = this.admin.analizarImportacion(body.contenido);
    return {
      metadatos: r.sobre.metadatos,
      nodos: r.sobre.grafo.nodes.length,
      conexiones: r.sobre.grafo.edges.length,
      requisitos: r.sobre.requisitos,
      nodosDesconocidos: r.nodosDesconocidos,
      avisos: r.avisos,
      checksumCoincide: r.checksumCoincide,
    };
  }

  /** Importa. SIEMPRE como borrador y SIEMPRE inactivo. */
  @Roles('ADMIN', 'MANAGER', 'SUPER_ADMIN')
  @Post('import')
  async importar(@Request() req: any, @Body() body: ImportarPulsoDto) {
    const r = await this.admin.importar(
      req.user.companyId,
      req.user.sub,
      body.contenido,
      body.nombre,
    );
    await this.auditar(req, 'flowbot.import', r.bot.id, {
      requisitos: r.requisitos.length,
      nodosDesconocidos: r.nodosDesconocidos.length,
      checksumCoincide: r.checksumCoincide,
    });
    return r;
  }

  @Roles('ADMIN', 'MANAGER', 'SUPER_ADMIN')
  @Patch(':id')
  renombrar(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: RenombrarBotDto,
  ) {
    return this.admin.renombrar(
      req.user.companyId,
      req.user.sub,
      id,
      body.nombre,
      body.descripcion,
    );
  }

  /**
   * Activar, pausar, archivar o restaurar.
   *
   * ARCHIVAR ES DE ADMIN, activar y pausar también de MANAGER: retirar un bot
   * del producto tiene más consecuencias que apagarlo un rato.
   */
  @Roles('ADMIN', 'MANAGER', 'SUPER_ADMIN')
  @Post(':id/status')
  async cambiarEstado(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: CambiarEstadoDto,
  ) {
    const estado = this.estado(body?.estado);
    if (!estado) throw new BadRequestException('Estado no válido');

    if (
      (estado === 'ARCHIVED' || estado === 'DRAFT') &&
      req.user.role === 'MANAGER'
    ) {
      throw new ForbiddenException(
        'Archivar o devolver a borrador requiere permisos de administrador',
      );
    }

    const r = await this.admin.cambiarEstado(
      req.user.companyId,
      req.user.sub,
      id,
      estado,
    );
    await this.auditar(req, `flowbot.status.${estado.toLowerCase()}`, id);
    return r;
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Delete(':id')
  async eliminar(@Request() req: any, @Param('id') id: string) {
    const r = await this.admin.eliminar(req.user.companyId, id);
    await this.auditar(req, 'flowbot.delete', id);
    return r;
  }

  // ── borrador ────────────────────────────────────────────────

  @Get(':id/draft')
  borrador(@Request() req: any, @Param('id') id: string) {
    return this.admin.obtenerBorrador(req.user.companyId, id);
  }

  @Roles('ADMIN', 'MANAGER', 'SUPER_ADMIN')
  @Post(':id/draft')
  guardarBorrador(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: GuardarBorradorDto,
  ) {
    return this.admin.guardarBorrador(
      req.user.companyId,
      req.user.sub,
      id,
      body.graph,
      body.revision,
    );
  }

  /**
   * Valida un grafo cualquiera.
   *
   * Acepta el grafo en el cuerpo para que el editor valide lo que tiene en
   * pantalla sin guardarlo: exigir guardar antes de ver los errores obliga a
   * pisar el trabajo de otro para descubrir que el tuyo está mal.
   */
  @Post('validate')
  validar(@Request() req: any, @Body() body: ValidarGrafoDto) {
    return this.admin.validar(req.user.companyId, body?.graph);
  }

  @Roles('ADMIN', 'MANAGER', 'SUPER_ADMIN')
  @Post(':id/publish')
  async publicar(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: PublicarDto,
  ) {
    const r = await this.admin.publicar(
      req.user.companyId,
      req.user.sub,
      id,
      body?.nota,
    );
    await this.auditar(req, 'flowbot.publish', id, { version: r.version });
    return r;
  }

  // ── versiones ───────────────────────────────────────────────

  @Get(':id/versions')
  versiones(@Request() req: any, @Param('id') id: string) {
    return this.admin.listarVersiones(req.user.companyId, id);
  }

  @Get(':id/versions/:versionId')
  version(
    @Request() req: any,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ) {
    return this.admin.obtenerVersion(req.user.companyId, id, versionId);
  }

  @Get(':id/versions/:desde/diff/:hasta')
  comparar(
    @Request() req: any,
    @Param('id') id: string,
    @Param('desde') desde: string,
    @Param('hasta') hasta: string,
  ) {
    return this.admin.compararVersiones(req.user.companyId, id, desde, hasta);
  }

  @Roles('ADMIN', 'MANAGER', 'SUPER_ADMIN')
  @Post(':id/versions/:versionId/restore')
  async restaurar(
    @Request() req: any,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ) {
    const r = await this.admin.restaurarVersion(
      req.user.companyId,
      req.user.sub,
      id,
      versionId,
    );
    await this.auditar(req, 'flowbot.version.restore', id, {
      version: r.restaurada,
    });
    return r;
  }

  // ── disparadores ────────────────────────────────────────────

  @Get(':id/triggers')
  listarDisparadores(@Request() req: any, @Param('id') id: string) {
    return this.triggers.listar(req.user.companyId, id);
  }

  @Roles('ADMIN', 'MANAGER', 'SUPER_ADMIN')
  @Post(':id/triggers')
  crearDisparador(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: CrearDisparadorDto,
  ) {
    return this.triggers.crear(req.user.companyId, id, {
      tipo: body.tipo as FlowBotTriggerType,
      activo: body.activo,
      prioridad: body.prioridad,
      exclusivo: body.exclusivo,
      filtros: body.filtros,
      whatsappIntegrationId: body.whatsappIntegrationId,
      scheduleSpec: body.scheduleSpec,
    });
  }

  @Roles('ADMIN', 'MANAGER', 'SUPER_ADMIN')
  @Patch(':id/triggers/:triggerId')
  actualizarDisparador(
    @Request() req: any,
    @Param('id') id: string,
    @Param('triggerId') triggerId: string,
    @Body() body: ActualizarDisparadorDto,
  ) {
    return this.triggers.actualizar(req.user.companyId, id, triggerId, body);
  }

  @Roles('ADMIN', 'MANAGER', 'SUPER_ADMIN')
  @Delete(':id/triggers/:triggerId')
  eliminarDisparador(
    @Request() req: any,
    @Param('id') id: string,
    @Param('triggerId') triggerId: string,
  ) {
    return this.triggers.eliminar(req.user.companyId, id, triggerId);
  }

  @Roles('ADMIN', 'MANAGER', 'SUPER_ADMIN')
  @Post(':id/triggers/order')
  ordenarDisparadores(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: OrdenarDisparadoresDto,
  ) {
    return this.triggers.ordenar(req.user.companyId, id, body.orden);
  }

  // ── simulador ───────────────────────────────────────────────

  /**
   * Simula un flujo SIN efectos reales.
   *
   * Lo puede usar cualquiera que pueda ver el bot, incluido AGENT: entender
   * qué va a contestar el bot es parte de atender bien, y la simulación no
   * escribe nada.
   */
  @Post('simulate')
  simular(@Request() req: any, @Body() body: EntradaSimulacionBodyDto) {
    return this.simulador.simular(req.user.companyId, body);
  }

  // ── ejecuciones ─────────────────────────────────────────────

  /**
   * Lista ejecuciones.
   *
   * UN AGENTE SOLO VE LAS SUYAS. El filtro no es opcional para él: se impone
   * aquí, no se confía en que el cliente lo mande. Ver las conversaciones de
   * los demás no es parte de su trabajo.
   */
  @Get('executions/list')
  listarEjecuciones(
    @Request() req: any,
    @Query('botId') botId?: string,
    @Query('versionId') versionId?: string,
    @Query('estado') estado?: string,
    @Query('contactId') contactId?: string,
    @Query('conversationId') conversationId?: string,
    @Query('leadId') leadId?: string,
    @Query('assignedTo') assignedTo?: string,
    @Query('whatsappIntegrationId') whatsappIntegrationId?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('conHandoff') conHandoff?: string,
    @Query('conError') conError?: string,
    @Query('correlationId') correlationId?: string,
    @Query('cursor') cursor?: string,
    @Query('limite') limite?: string,
  ) {
    const esAgente = req.user.role === 'AGENT';

    return this.ejecuciones.listar(
      req.user.companyId,
      {
        botId,
        versionId,
        estado,
        contactId,
        conversationId,
        leadId,
        assignedTo: esAgente ? req.user.sub : assignedTo,
        whatsappIntegrationId,
        desde: this.fecha(desde),
        hasta: this.fecha(hasta),
        conHandoff: conHandoff === 'true',
        conError: conError === 'true',
        correlationId,
      },
      { cursor, limite: limite ? Number(limite) : undefined },
    );
  }

  @Get('executions/:executionId')
  async detalleEjecucion(
    @Request() req: any,
    @Param('executionId') executionId: string,
  ) {
    await this.exigirAccesoAEjecucion(req, executionId);
    return this.ejecuciones.detalle(req.user.companyId, executionId);
  }

  @Roles('ADMIN', 'MANAGER', 'SUPER_ADMIN')
  @Post('executions/:executionId/cancel')
  async cancelar(
    @Request() req: any,
    @Param('executionId') executionId: string,
    @Body() body: OperacionEjecucionDto,
  ) {
    if (!body?.motivo?.trim()) {
      // El motivo es obligatorio: una cancelación sin explicación es
      // indistinguible de un fallo cuando alguien la mire dentro de un mes.
      throw new BadRequestException('Indica el motivo de la cancelación');
    }
    const r = await this.ejecuciones.cancelar(
      req.user.companyId,
      req.user.sub,
      executionId,
      body.motivo,
    );
    await this.auditar(req, 'flowbot.execution.cancel', executionId, {
      motivo: body.motivo,
    });
    return r;
  }

  @Roles('ADMIN', 'MANAGER', 'SUPER_ADMIN')
  @Post('executions/:executionId/pause')
  async pausar(@Request() req: any, @Param('executionId') executionId: string) {
    const r = await this.ejecuciones.pausar(
      req.user.companyId,
      req.user.sub,
      executionId,
    );
    await this.auditar(req, 'flowbot.execution.pause', executionId);
    return r;
  }

  /**
   * Reanuda. Un AGENT puede hacerlo SOLO sobre una conversación suya.
   *
   * Es la excepción deliberada a «AGENT no opera»: quien está atendiendo una
   * conversación es quien sabe cuándo devolvérsela al bot, y obligarle a pedir
   * permiso a un administrador para eso convierte una acción de treinta
   * segundos en un ticket.
   */
  @Post('executions/:executionId/resume')
  async reanudar(
    @Request() req: any,
    @Param('executionId') executionId: string,
  ) {
    await this.exigirAccesoAEjecucion(req, executionId);
    const r = await this.ejecuciones.reanudar(
      req.user.companyId,
      req.user.sub,
      executionId,
    );
    await this.auditar(req, 'flowbot.execution.resume', executionId);
    return r;
  }

  @Roles('ADMIN', 'MANAGER', 'SUPER_ADMIN')
  @Post('executions/:executionId/retry')
  async reintentar(
    @Request() req: any,
    @Param('executionId') executionId: string,
  ) {
    const r = await this.ejecuciones.reintentar(
      req.user.companyId,
      req.user.sub,
      executionId,
    );
    await this.auditar(req, 'flowbot.execution.retry', executionId, {
      resultado: r.estado,
    });
    return r;
  }

  @Post('executions/:executionId/handoff')
  async forzarHandoff(
    @Request() req: any,
    @Param('executionId') executionId: string,
    @Body() body: ForzarHandoffDto,
  ) {
    await this.exigirAccesoAEjecucion(req, executionId);
    const r = await this.ejecuciones.forzarHandoff(
      req.user.companyId,
      req.user.sub,
      executionId,
      {
        asignarA: body?.asignarA,
        motivo: body?.motivo,
        nota: body?.nota,
      },
    );
    await this.auditar(req, 'flowbot.execution.handoff', executionId);
    return r;
  }

  // ── métricas ────────────────────────────────────────────────

  @Get('metrics/summary')
  metricasResumen(
    @Request() req: any,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('botId') botId?: string,
  ) {
    return this.metricas.resumen(req.user.companyId, {
      desde: this.fecha(desde),
      hasta: this.fecha(hasta),
      botId,
    });
  }

  // ── ayudas ──────────────────────────────────────────────────

  /**
   * Un AGENT solo entra a ejecuciones de conversaciones que tiene asignadas.
   *
   * Se comprueba con una consulta acotada, no con una lista en memoria: el
   * `companyId` y el `assignedTo` van dentro del `where`, así que una
   * ejecución de otra empresa ni siquiera se encuentra.
   */
  private async exigirAccesoAEjecucion(
    req: any,
    executionId: string,
  ): Promise<void> {
    if (req.user.role !== 'AGENT') return;

    const suya = await this.prisma.flowBotExecution.findFirst({
      where: {
        id: executionId,
        companyId: req.user.companyId,
        conversation: { assignedTo: req.user.sub },
      },
      select: { id: true },
    });
    if (!suya) {
      throw new ForbiddenException(
        'Solo puedes ver ejecuciones de conversaciones que tienes asignadas',
      );
    }
  }

  private estado(valor?: string): FlowBotStatus | undefined {
    if (!valor) return undefined;
    const validos: FlowBotStatus[] = ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'];
    return validos.includes(valor as FlowBotStatus)
      ? (valor as FlowBotStatus)
      : undefined;
  }

  private fecha(valor?: string): Date | undefined {
    if (!valor) return undefined;
    const d = new Date(valor);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }

  /**
   * Auditoría best-effort: nunca hace fallar la operación que registra.
   *
   * CUANDO ACTÚA PLATAFORMA SE DICE. `affectedCompanyId` es la empresa
   * soportada y el motivo de la sesión viaja en los metadatos: un registro que
   * dijera solo "ADMIN de la empresa X publicó" escondería que fue soporte
   * quien lo hizo, y esa es justo la pregunta que se hace después.
   */
  private async auditar(
    req: any,
    accion: string,
    entityId: string,
    metadata?: Record<string, unknown>,
    motivo?: string,
  ): Promise<void> {
    const soporte = req.user.soporte;

    await this.auditoria
      .record(this.prisma, {
        actorUserId: req.user.sub,
        actorRole: req.user.role,
        affectedCompanyId: req.user.companyId,
        action: accion,
        entityType: 'FlowBot',
        entityId,
        // El motivo escrito por quien actúa gana sobre el de la sesión de
        // soporte: es más específico de ESTA acción.
        ...(motivo?.trim()
          ? { reason: motivo.trim() }
          : soporte
            ? { reason: soporte.motivo }
            : {}),
        metadata: {
          ...(metadata ?? {}),
          ...(soporte
            ? {
                viaSoporte: true,
                supportSessionId: soporte.sessionId,
                empresaSoportada: soporte.empresa,
              }
            : {}),
        },
      })
      .catch(() => undefined);
  }
}
