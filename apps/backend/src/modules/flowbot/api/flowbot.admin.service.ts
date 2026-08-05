import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FlowBotStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { compilar, grafoInicial } from '../graph/flowbot.compiler';
import { randomUUID } from 'crypto';
import { GrafoFlow } from '../graph/flowbot.graph';
import { variablesDe } from '../graph/flowbot.variables';
import {
  analizarImportacion,
  construirSobre,
} from '../graph/flowbot.intercambio';
import { sePuedePublicar, validarGrafo } from '../graph/flowbot.validator';
import { FlowBotReferenciasService } from '../graph/flowbot.referencias.service';
import { PLANTILLAS, plantillaPorClave } from './flowbot.templates';
import {
  BotDetalleDto,
  BotResumenDto,
  ComparacionVersionesDto,
  ResultadoValidacionDto,
  VersionDetalleDto,
  VersionResumenDto,
  aProblemaDto,
  tieneEjecutor,
} from './flowbot.contracts';

/**
 * Administración de bots: CRUD, borradores y versiones.
 *
 * DOS REGLAS QUE ATRAVIESAN TODO EL SERVICIO:
 *
 * 1. UNA VERSIÓN PUBLICADA NUNCA SE MODIFICA. Editar un bot publicado toca
 *    solo el borrador. Una ejecución que empezó con la versión 3 termina con
 *    la versión 3 aunque se publique la 4 mientras corre: si no, un cliente a
 *    mitad de conversación se encontraría con un flujo distinto del que
 *    empezó, y las variables que ya guardó podrían no significar nada.
 *
 * 2. EL `companyId` SALE DEL TOKEN Y VA DENTRO DEL `where`. Nunca se acepta
 *    del cuerpo ni de la query, y nunca se trae una fila para comprobar
 *    después de quién es: simplemente no se encuentra.
 */
@Injectable()
export class FlowBotAdminService {
  private readonly logger = new Logger(FlowBotAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly referencias: FlowBotReferenciasService,
  ) {}

  // ── listado y búsqueda ──────────────────────────────────────

  async listar(
    companyId: string,
    filtros: {
      busqueda?: string;
      estado?: FlowBotStatus;
      incluirArchivados?: boolean;
      soloPlantillas?: boolean;
    } = {},
  ): Promise<BotResumenDto[]> {
    const bots = await this.prisma.flowBot.findMany({
      where: {
        companyId,
        isTemplate: filtros.soloPlantillas ?? false,
        ...(filtros.estado ? { status: filtros.estado } : {}),
        ...(filtros.incluirArchivados || filtros.estado
          ? {}
          : { status: { not: 'ARCHIVED' } }),
        ...(filtros.busqueda
          ? {
              OR: [
                { name: { contains: filtros.busqueda, mode: 'insensitive' } },
                {
                  description: {
                    contains: filtros.busqueda,
                    mode: 'insensitive',
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ updatedAt: 'desc' }],
      include: {
        publishedVersion: { select: { version: true } },
        triggers: {
          select: {
            id: true,
            type: true,
            enabled: true,
            priority: true,
            exclusive: true,
          },
          orderBy: { priority: 'desc' },
        },
        updatedBy: { select: { name: true } },
      },
    });

    // Las métricas se resuelven en DOS consultas agregadas para todos los
    // bots, no en una por bot: con veinte bots, el N+1 serían cuarenta y una
    // consultas para pintar una lista.
    const ids = bots.map((b) => b.id);
    const [porEstado, ultimas] = await Promise.all([
      this.prisma.flowBotExecution.groupBy({
        by: ['flowBotId', 'status'],
        where: { companyId, flowBotId: { in: ids } },
        _count: { _all: true },
      }),
      this.prisma.flowBotExecution.groupBy({
        by: ['flowBotId'],
        where: { companyId, flowBotId: { in: ids } },
        _max: { startedAt: true },
      }),
    ]);

    return bots.map((b) => {
      const suyas = porEstado.filter((e) => e.flowBotId === b.id);
      const cuenta = (estado: string) =>
        suyas.find((e) => e.status === estado)?._count._all ?? 0;
      const total = suyas.reduce((n, e) => n + e._count._all, 0);
      const completadas = cuenta('COMPLETED');
      const ultima = ultimas.find((u) => u.flowBotId === b.id)?._max.startedAt;

      return {
        id: b.id,
        nombre: b.name,
        descripcion: b.description,
        estado: b.status,
        esPlantilla: b.isTemplate,
        versionPublicada: b.publishedVersion?.version ?? null,
        publishedVersionId: b.publishedVersionId,
        draftRevision: b.draftRevision,
        disparadores: b.triggers.map((t) => ({
          id: t.id,
          tipo: t.type,
          activo: t.enabled,
          prioridad: t.priority,
          exclusivo: t.exclusive,
        })),
        metricas: {
          ejecucionesTotales: total,
          ultimaEjecucionEn: ultima?.toISOString() ?? null,
          // `null` y no 0 cuando no hay ejecuciones: «0 %» sugiere que falla
          // siempre, y no es lo mismo que «todavía no ha corrido».
          tasaFinalizacion: total > 0 ? completadas / total : null,
          handoffs: cuenta('HANDED_OFF'),
          errores: cuenta('FAILED'),
          necesitanAtencion: cuenta('NEEDS_ATTENTION'),
        },
        creadoEn: b.createdAt.toISOString(),
        actualizadoEn: b.updatedAt.toISOString(),
        actualizadoPor: b.updatedBy?.name ?? null,
      };
    });
  }

  async detalle(companyId: string, botId: string): Promise<BotDetalleDto> {
    const [resumen] = await this.listarPorIds(companyId, [botId]);
    if (!resumen) throw new NotFoundException('Bot no encontrado');

    const bot = await this.prisma.flowBot.findFirst({
      where: { id: botId, companyId },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          include: {
            publishedBy: { select: { name: true } },
            _count: { select: { executions: true } },
          },
        },
      },
    });
    if (!bot) throw new NotFoundException('Bot no encontrado');

    return {
      ...resumen,
      draftGraph: bot.draftGraph,
      versiones: bot.versions.map((v) =>
        this.aVersionResumen(v, bot.publishedVersionId),
      ),
    };
  }

  private async listarPorIds(companyId: string, ids: string[]) {
    const todos = await this.listar(companyId, { incluirArchivados: true });
    const plantillas = await this.listar(companyId, {
      incluirArchivados: true,
      soloPlantillas: true,
    });
    return [...todos, ...plantillas].filter((b) => ids.includes(b.id));
  }

  // ── crear, duplicar, renombrar ──────────────────────────────

  async crear(
    companyId: string,
    userId: string,
    entrada: { nombre: string; descripcion?: string; graph?: unknown },
  ) {
    if (!entrada.nombre?.trim()) {
      throw new BadRequestException('El nombre no puede estar vacío');
    }

    // Nace DRAFT y sin versión publicada. Un bot que naciera activo empezaría
    // a contestar a clientes antes de que nadie lo hubiera mirado.
    return this.prisma.flowBot.create({
      data: {
        companyId,
        name: entrada.nombre.trim(),
        description: entrada.descripcion?.trim() || null,
        status: 'DRAFT',
        // Sin grafo, uno inicial con su disparador: un lienzo en blanco sin
        // punto de partida obliga a adivinar por dónde se empieza.
        draftGraph: entrada.graph ?? grafoInicial(),
        createdById: userId,
        updatedById: userId,
      },
    });
  }

  /**
   * Exporta un bot a `.taktoflow.json`.
   *
   * Sale el BORRADOR, no la version publicada: exportar es para llevarse el
   * trabajo, y el trabajo esta en el borrador. El sobre va saneado —sin
   * secretos y sin identificadores de esta empresa— porque un archivo que la
   * gente se manda por correo no puede llevar un token dentro.
   */
  async exportar(companyId: string, botId: string) {
    const bot = await this.prisma.flowBot.findFirst({
      where: { id: botId, companyId },
      select: { name: true, description: true, draftGraph: true },
    });
    if (!bot) throw new NotFoundException('Bot no encontrado');

    const grafo = bot.draftGraph as unknown as GrafoFlow;
    return construirSobre({
      nombre: bot.name,
      descripcion: bot.description,
      grafo,
      variables: [...variablesDe(grafo.nodes.map((n) => n.config ?? {}))],
      ahora: new Date(),
      version: String(process.env.APP_RELEASE ?? 'desconocida'),
    });
  }

  /**
   * Analiza un archivo entrante SIN escribir nada. Alimenta la vista previa.
   *
   * Existe aparte de `importar` para que nadie tenga que crear un bot solo
   * para descubrir que el archivo no servia.
   */
  analizarImportacion(crudo: string) {
    // Ids nuevos y sin relacion con los del origen: conservar los del archivo
    // invita a colisiones con bots que ya existen aqui.
    return analizarImportacion(
      crudo,
      (semilla) => `${semilla}_${randomUUID().slice(0, 8)}`,
    );
  }

  /**
   * Importa un Pulso. SIEMPRE como borrador y SIEMPRE inactivo.
   *
   * Un bot importado que se publicara o se activara solo empezaria a contestar
   * a clientes reales con un flujo que nadie de esta empresa ha revisado.
   * Tampoco se le copian disparadores: se conectan despues, a mano, igual que
   * las credenciales que el archivo no trae.
   */
  async importar(
    companyId: string,
    userId: string,
    crudo: string,
    nombreElegido?: string,
  ) {
    const analisis = this.analizarImportacion(crudo);

    const bot = await this.prisma.flowBot.create({
      data: {
        companyId,
        name: (nombreElegido?.trim() || analisis.sobre.metadatos.nombre).slice(
          0,
          120,
        ),
        description: analisis.sobre.metadatos.descripcion,
        // DRAFT y sin `publishedVersionId`: no hay atajo para saltarse la
        // revision de quien lo importa.
        status: 'DRAFT',
        draftGraph: analisis.sobre.grafo as unknown as Prisma.InputJsonValue,
        createdById: userId,
        updatedById: userId,
      },
      select: { id: true, name: true, status: true },
    });

    return {
      bot,
      requisitos: analisis.sobre.requisitos,
      nodosDesconocidos: analisis.nodosDesconocidos,
      avisos: analisis.avisos,
      checksumCoincide: analisis.checksumCoincide,
    };
  }

  /**
   * Duplica un bot.
   *
   * Copia el BORRADOR, no la versión publicada, y el duplicado nace DRAFT sin
   * disparadores. Copiar los disparadores haría que dos bots respondieran al
   * mismo mensaje en cuanto se activara el nuevo, que es el fallo más visible
   * de todos.
   */
  async duplicar(companyId: string, userId: string, botId: string) {
    const origen = await this.prisma.flowBot.findFirst({
      where: { id: botId, companyId },
    });
    if (!origen) throw new NotFoundException('Bot no encontrado');

    return this.prisma.flowBot.create({
      data: {
        companyId,
        name: `${origen.name} (copia)`,
        description: origen.description,
        status: 'DRAFT',
        draftGraph: origen.draftGraph as Prisma.InputJsonValue,
        clonedFromId: origen.id,
        createdById: userId,
        updatedById: userId,
      },
    });
  }

  async renombrar(
    companyId: string,
    userId: string,
    botId: string,
    nombre: string,
    descripcion?: string,
  ) {
    if (!nombre?.trim()) {
      throw new BadRequestException('El nombre no puede estar vacío');
    }
    const { count } = await this.prisma.flowBot.updateMany({
      where: { id: botId, companyId },
      data: {
        name: nombre.trim(),
        ...(descripcion !== undefined
          ? { description: descripcion.trim() || null }
          : {}),
        updatedById: userId,
      },
    });
    if (count === 0) throw new NotFoundException('Bot no encontrado');
    return { renombrado: true };
  }

  /**
   * Crea un bot A PARTIR DE UNA PLANTILLA.
   *
   * Nace DRAFT, como cualquier otro, y con los campos que la plantilla declara
   * pendientes todavia vacios: el validador los rechazara al publicar y quien
   * la eligio los vera en el editor. Rellenarlos por el con valores de ejemplo
   * seria como acaba alguien mandandole a su cliente el catalogo de otro.
   */
  async crearDesdePlantilla(
    companyId: string,
    userId: string,
    clave: string,
    nombre?: string,
  ) {
    const plantilla = plantillaPorClave(clave);
    if (!plantilla) throw new NotFoundException('Plantilla no encontrada');

    const bot = await this.prisma.flowBot.create({
      data: {
        companyId,
        name: nombre?.trim() || plantilla.nombre,
        description: plantilla.descripcion,
        status: 'DRAFT',
        draftGraph: plantilla.graph as unknown as Prisma.InputJsonValue,
        templateKey: plantilla.clave,
        createdById: userId,
        updatedById: userId,
      },
    });

    return {
      ...bot,
      // Se devuelve lo que falta para que la interfaz lo pida de entrada en
      // vez de dejar que el usuario lo descubra error a error al publicar.
      camposPorCompletar: plantilla.camposPorCompletar,
      requiere: plantilla.requiere,
    };
  }

  /** El catalogo de plantillas. Son datos, no filas: no se siembran. */
  listarPlantillas() {
    return PLANTILLAS.map((p) => ({
      clave: p.clave,
      nombre: p.nombre,
      descripcion: p.descripcion,
      objetivo: p.objetivo,
      categoria: p.categoria,
      requiere: p.requiere,
      camposPorCompletar: p.camposPorCompletar,
      nodos: p.graph.nodes.length,
    }));
  }

  // ── estados ─────────────────────────────────────────────────

  /**
   * Cambia el estado del bot.
   *
   * ACTIVAR EXIGE VERSIÓN PUBLICADA. Un bot activo sin versión no puede
   * arrancar nada —el selector solo mira los que la tienen— así que activarlo
   * sería mentirle a quien pulsa el botón.
   *
   * NINGÚN CAMBIO DE ESTADO TOCA LAS EJECUCIONES EN CURSO. Archivar o pausar
   * impide que empiecen nuevas; las que ya están corriendo terminan su
   * conversación. Cortarlas dejaría al cliente a media pregunta.
   */
  async cambiarEstado(
    companyId: string,
    userId: string,
    botId: string,
    estado: FlowBotStatus,
  ) {
    const bot = await this.prisma.flowBot.findFirst({
      where: { id: botId, companyId },
      select: { publishedVersionId: true, status: true },
    });
    if (!bot) throw new NotFoundException('Bot no encontrado');

    if (estado === 'ACTIVE' && !bot.publishedVersionId) {
      throw new BadRequestException(
        'No se puede activar un bot sin versión publicada. Publica primero.',
      );
    }

    await this.prisma.flowBot.updateMany({
      where: { id: botId, companyId },
      data: { status: estado, updatedById: userId },
    });

    this.logger.log(
      `Bot ${botId} pasó de ${bot.status} a ${estado} [empresa=${companyId}]`,
    );
    return { estado };
  }

  /**
   * Borra un bot. SOLO si nunca se publicó y no tiene ejecuciones.
   *
   * Con versiones o ejecuciones, borrar destruiría el historial de
   * conversaciones que ya ocurrieron: para eso está archivar. Es la misma
   * regla que impide borrar un pipeline con oportunidades.
   */
  async eliminar(companyId: string, botId: string) {
    const bot = await this.prisma.flowBot.findFirst({
      where: { id: botId, companyId },
      select: {
        publishedVersionId: true,
        _count: { select: { versions: true, executions: true } },
      },
    });
    if (!bot) throw new NotFoundException('Bot no encontrado');

    if (bot.publishedVersionId || bot._count.versions > 0) {
      throw new BadRequestException(
        'Este bot tiene versiones publicadas. Archívalo en vez de borrarlo.',
      );
    }
    if (bot._count.executions > 0) {
      throw new BadRequestException(
        'Este bot tiene ejecuciones. Archívalo para conservar el historial.',
      );
    }

    await this.prisma.flowBot.deleteMany({ where: { id: botId, companyId } });
    return { eliminado: true };
  }

  // ── borrador con concurrencia optimista ─────────────────────

  async obtenerBorrador(companyId: string, botId: string) {
    const bot = await this.prisma.flowBot.findFirst({
      where: { id: botId, companyId },
      select: {
        id: true,
        draftGraph: true,
        draftRevision: true,
        updatedAt: true,
        updatedBy: { select: { name: true } },
      },
    });
    if (!bot) throw new NotFoundException('Bot no encontrado');

    return {
      botId: bot.id,
      graph: bot.draftGraph,
      revision: bot.draftRevision,
      actualizadoEn: bot.updatedAt.toISOString(),
      actualizadoPor: bot.updatedBy?.name ?? null,
    };
  }

  /**
   * Guarda el borrador con control optimista.
   *
   * EL CLIENTE MANDA LA REVISIÓN QUE EDITÓ. Si otro administrador guardó en
   * medio, la que llega ya no coincide y se responde 409 CON EL ESTADO ACTUAL:
   * sin él, la interfaz solo puede decir «alguien te pisó» y obligar a
   * recargar perdiendo el trabajo. Con él puede enseñar las dos versiones.
   *
   * La comprobación va DENTRO del `updateMany`, no en un `findFirst` previo:
   * entre leer y escribir hay un hueco por el que se cuela el otro guardado, y
   * es exactamente la carrera que este mecanismo existe para cerrar.
   */
  async guardarBorrador(
    companyId: string,
    userId: string,
    botId: string,
    graph: unknown,
    revisionEsperada: number,
  ) {
    const { count } = await this.prisma.flowBot.updateMany({
      where: { id: botId, companyId, draftRevision: revisionEsperada },
      data: {
        draftGraph: graph as Prisma.InputJsonValue,
        draftRevision: { increment: 1 },
        updatedById: userId,
      },
    });

    if (count === 0) {
      const actual = await this.prisma.flowBot.findFirst({
        where: { id: botId, companyId },
        select: {
          draftRevision: true,
          draftGraph: true,
          updatedAt: true,
          updatedBy: { select: { name: true } },
        },
      });
      if (!actual) throw new NotFoundException('Bot no encontrado');

      throw new ConflictException({
        codigo: 'borrador.conflicto',
        mensaje:
          'Otra persona guardó cambios mientras editabas. Compara y decide qué conservar.',
        revisionEnviada: revisionEsperada,
        revisionActual: actual.draftRevision,
        actualizadoPor: actual.updatedBy?.name ?? null,
        actualizadoEn: actual.updatedAt.toISOString(),
        // El grafo actual va en la respuesta para que la interfaz pueda
        // mostrar la diferencia sin una segunda petición y sin perder lo que
        // el usuario tenía escrito.
        graphActual: actual.draftGraph,
      });
    }

    const bot = await this.prisma.flowBot.findFirst({
      where: { id: botId, companyId },
      select: { draftRevision: true, updatedAt: true },
    });
    return {
      guardado: true,
      revision: bot!.draftRevision,
      actualizadoEn: bot!.updatedAt.toISOString(),
    };
  }

  // ── validación y compilación ────────────────────────────────

  /**
   * Valida un grafo contra las referencias REALES de la empresa.
   *
   * Acepta el grafo por parámetro para que el editor pueda validar lo que
   * tiene en pantalla sin haberlo guardado: exigir guardar antes de ver los
   * errores obliga a pisar el trabajo de otro para descubrir que el tuyo está
   * mal.
   */
  async validar(
    companyId: string,
    graph: unknown,
  ): Promise<ResultadoValidacionDto> {
    const referencias = await this.referencias.paraEmpresa(companyId);
    const problemas = validarGrafo(graph as GrafoFlow, referencias);

    // Un nodo sin ejecutor se rechaza AQUÍ además de en el catálogo: el
    // catálogo dice qué se puede dibujar, esto dice qué se puede publicar, y
    // un grafo puede llegar por importación sin pasar por el editor.
    const sinEjecutor = this.nodosSinEjecutor(graph);
    for (const nodeId of sinEjecutor.ids) {
      problemas.push({
        severidad: 'error',
        codigo: 'nodo.sin_ejecutor',
        mensaje:
          'Este paso todavía no se puede ejecutar. Sustitúyelo o quítalo antes de publicar.',
        nodeId,
      });
    }

    const puedePublicar = sePuedePublicar(problemas);
    const compilacion = puedePublicar
      ? compilar(graph as GrafoFlow)
      : { ok: false, hash: undefined };

    return {
      ok: problemas.filter((p) => p.severidad === 'error').length === 0,
      sePuedePublicar: puedePublicar && compilacion.ok,
      problemas: problemas.map(aProblemaDto),
      ...(compilacion.ok && compilacion.hash
        ? { compiledHash: compilacion.hash }
        : {}),
    };
  }

  private nodosSinEjecutor(graph: unknown): { ids: string[] } {
    const nodos = (graph as GrafoFlow | undefined)?.nodes;
    if (!Array.isArray(nodos)) return { ids: [] };
    return {
      ids: nodos
        .filter((n) => n?.type && !tieneEjecutor(n.type))
        .map((n) => n.id),
    };
  }

  // ── publicación ─────────────────────────────────────────────

  /**
   * Publica el borrador como una versión NUEVA e inmutable.
   *
   * TODO EN UNA TRANSACCIÓN: crear la versión, apuntarla como publicada y
   * subir el contador. Separarlo dejaría, al morir en medio, una versión
   * huérfana que nadie ejecuta o —peor— un bot apuntando a una versión que no
   * terminó de escribirse.
   *
   * NO se cambia el estado del bot: publicar y activar son decisiones
   * distintas. Alguien puede querer tener la versión lista y encenderla el
   * lunes.
   */
  async publicar(
    companyId: string,
    userId: string,
    botId: string,
    nota?: string,
  ) {
    const bot = await this.prisma.flowBot.findFirst({
      where: { id: botId, companyId },
      select: { id: true, draftGraph: true, lastVersionNumber: true },
    });
    if (!bot) throw new NotFoundException('Bot no encontrado');

    const validacion = await this.validar(companyId, bot.draftGraph);
    if (!validacion.sePuedePublicar) {
      throw new BadRequestException({
        codigo: 'publicacion.invalida',
        mensaje: 'El flujo tiene errores que impiden publicarlo.',
        problemas: validacion.problemas,
      });
    }

    const compilacion = compilar(bot.draftGraph as unknown as GrafoFlow);
    if (!compilacion.ok || !compilacion.compilado || !compilacion.hash) {
      throw new BadRequestException({
        codigo: 'publicacion.no_compila',
        mensaje: 'El flujo no se pudo compilar.',
        problemas: compilacion.problemas?.map(aProblemaDto) ?? [],
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const siguiente = bot.lastVersionNumber + 1;

      const version = await tx.flowBotVersion.create({
        data: {
          flowBotId: botId,
          version: siguiente,
          // El grafo se congela TAL COMO ESTÁ. Guardar una referencia al
          // borrador haría que editarlo cambiara la versión publicada, que es
          // exactamente lo que la inmutabilidad impide.
          graph: bot.draftGraph as Prisma.InputJsonValue,
          compiled: compilacion.compilado as unknown as Prisma.InputJsonValue,
          compiledHash: compilacion.hash!,
          publishNote: nota?.trim() || null,
          publishedById: userId,
        },
      });

      await tx.flowBot.update({
        where: { id: botId },
        data: {
          publishedVersionId: version.id,
          lastVersionNumber: siguiente,
          updatedById: userId,
        },
      });

      return {
        versionId: version.id,
        version: siguiente,
        compiledHash: version.compiledHash,
      };
    });
  }

  // ── versiones ───────────────────────────────────────────────

  async listarVersiones(
    companyId: string,
    botId: string,
  ): Promise<VersionResumenDto[]> {
    const bot = await this.prisma.flowBot.findFirst({
      where: { id: botId, companyId },
      select: { publishedVersionId: true },
    });
    if (!bot) throw new NotFoundException('Bot no encontrado');

    const versiones = await this.prisma.flowBotVersion.findMany({
      // Acotado por empresa a través del bot: un `botId` de otra empresa no
      // devuelve nada porque el `findFirst` de arriba ya falló.
      where: { flowBotId: botId, flowBot: { companyId } },
      orderBy: { version: 'desc' },
      include: {
        publishedBy: { select: { name: true } },
        _count: { select: { executions: true } },
      },
    });
    return versiones.map((v) =>
      this.aVersionResumen(v, bot.publishedVersionId),
    );
  }

  async obtenerVersion(
    companyId: string,
    botId: string,
    versionId: string,
  ): Promise<VersionDetalleDto> {
    const v = await this.prisma.flowBotVersion.findFirst({
      where: { id: versionId, flowBotId: botId, flowBot: { companyId } },
      include: {
        publishedBy: { select: { name: true } },
        _count: { select: { executions: true } },
        flowBot: { select: { publishedVersionId: true } },
      },
    });
    if (!v) throw new NotFoundException('Versión no encontrada');

    return {
      ...this.aVersionResumen(v, v.flowBot.publishedVersionId),
      graph: v.graph,
    };
  }

  /**
   * Compara dos versiones POR NODO Y CONEXIÓN.
   *
   * Un diff de JSON crudo marcaría como cambio el reordenamiento de una clave
   * y no diría nada útil a quien quiere saber qué pasos cambiaron.
   */
  async compararVersiones(
    companyId: string,
    botId: string,
    desdeId: string,
    hastaId: string,
  ): Promise<ComparacionVersionesDto> {
    const [a, b] = await Promise.all([
      this.obtenerVersion(companyId, botId, desdeId),
      this.obtenerVersion(companyId, botId, hastaId),
    ]);

    const grafoA = a.graph as GrafoFlow;
    const grafoB = b.graph as GrafoFlow;
    const nodosA = indexar(grafoA.nodes);
    const nodosB = indexar(grafoB.nodes);
    const aristasA = new Set((grafoA.edges ?? []).map(claveArista));
    const aristasB = new Set((grafoB.edges ?? []).map(claveArista));

    const modificados: Array<{ id: string; campos: string[] }> = [];
    for (const [id, nodo] of nodosB) {
      const previo = nodosA.get(id);
      if (!previo) continue;
      const campos = camposDistintos(previo, nodo);
      if (campos.length > 0) modificados.push({ id, campos });
    }

    const agregados = [...nodosB.keys()].filter((id) => !nodosA.has(id));
    const eliminados = [...nodosA.keys()].filter((id) => !nodosB.has(id));
    const aristasNuevas = [...aristasB].filter((k) => !aristasA.has(k));
    const aristasIdas = [...aristasA].filter((k) => !aristasB.has(k));

    return {
      desde: { id: a.id, version: a.version },
      hasta: { id: b.id, version: b.version },
      nodos: { agregados, eliminados, modificados },
      conexiones: { agregadas: aristasNuevas, eliminadas: aristasIdas },
      identicos:
        agregados.length === 0 &&
        eliminados.length === 0 &&
        modificados.length === 0 &&
        aristasNuevas.length === 0 &&
        aristasIdas.length === 0,
    };
  }

  /**
   * Restaura una versión COMO BORRADOR NUEVO.
   *
   * NO toca la versión histórica ni la publicada: copia su grafo al borrador y
   * sube la revisión. Quien restaure tiene que publicar otra vez, que es lo
   * que deja constancia de que hubo una vuelta atrás deliberada.
   */
  async restaurarVersion(
    companyId: string,
    userId: string,
    botId: string,
    versionId: string,
  ) {
    const version = await this.prisma.flowBotVersion.findFirst({
      where: { id: versionId, flowBotId: botId, flowBot: { companyId } },
      select: { graph: true, version: true },
    });
    if (!version) throw new NotFoundException('Versión no encontrada');

    const bot = await this.prisma.flowBot.update({
      where: { id: botId },
      data: {
        draftGraph: version.graph as Prisma.InputJsonValue,
        draftRevision: { increment: 1 },
        updatedById: userId,
      },
      select: { draftRevision: true },
    });

    this.logger.log(
      `Versión ${version.version} restaurada como borrador [bot=${botId}]`,
    );
    return { restaurada: version.version, revision: bot.draftRevision };
  }

  private aVersionResumen(
    v: {
      id: string;
      version: number;
      compiledHash: string;
      publishNote: string | null;
      publishedAt: Date;
      publishedBy?: { name: string } | null;
      _count?: { executions: number };
    },
    publishedVersionId: string | null,
  ): VersionResumenDto {
    return {
      id: v.id,
      version: v.version,
      compiledHash: v.compiledHash,
      publishNote: v.publishNote,
      publishedAt: v.publishedAt.toISOString(),
      publishedBy: v.publishedBy?.name ?? null,
      esActual: v.id === publishedVersionId,
      ejecuciones: v._count?.executions ?? 0,
    };
  }
}

// ── utilidades de comparación ───────────────────────────────────

function indexar(
  nodos: GrafoFlow['nodes'] | undefined,
): Map<string, Record<string, unknown>> {
  const mapa = new Map<string, Record<string, unknown>>();
  for (const n of nodos ?? []) {
    if (n?.id) mapa.set(n.id, n as unknown as Record<string, unknown>);
  }
  return mapa;
}

function claveArista(e: {
  from: string;
  fromPort: string;
  to: string;
}): string {
  return `${e.from}|${e.fromPort}|${e.to}`;
}

/**
 * Qué campos cambiaron entre dos nodos.
 *
 * `position` se ignora a propósito: mover un nodo en el lienzo no es un cambio
 * del flujo, y marcarlo como tal llenaría el diff de ruido que esconde lo que
 * de verdad cambió.
 */
function camposDistintos(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): string[] {
  const claves = new Set([...Object.keys(a), ...Object.keys(b)]);
  claves.delete('position');
  const distintos: string[] = [];
  for (const k of claves) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) distintos.push(k);
  }
  return distintos;
}
