import { Logger } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { PuertoCrm } from '../flowbot.ports';
import { normalizePhone } from '../../../../common/phone/e164.util';
import { CustomFieldsService } from '../../../custom-fields/custom-fields.service';
import { HandoffService } from '../../../conversations/handoff.service';

/**
 * Adaptador REAL de CRM.
 *
 * EL `companyId` SE FIJA EN EL CONSTRUCTOR, no llega por parámetro en cada
 * llamada. Un nodo no puede pedir datos de otra empresa porque no tiene forma
 * de indicar cuál: el aislamiento deja de depender de que cada método se
 * acuerde de filtrar.
 *
 * Toda escritura sobre una entidad existente va con `updateMany` filtrando por
 * empresa en vez de `update` por id. `update` con un id ajeno escribiría en la
 * fila de otra empresa; `updateMany` simplemente no encuentra nada.
 */
export class CrmAdapter implements PuertoCrm {
  private readonly logger = new Logger(CrmAdapter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly companyId: string,
    /**
     * Los campos personalizados y el handoff se delegan en sus servicios en
     * vez de reimplementarse aqui. Dos caminos de escritura es como acaban
     * divergiendo las reglas hasta que un bot puede guardar lo que un
     * formulario rechaza, o dejar una conversacion pausada sin registro.
     */
    private readonly campos: CustomFieldsService,
    private readonly handoff: HandoffService,
    /** Que ejecucion esta produciendo estos efectos, para el historial. */
    private readonly executionId: string | null = null,
  ) {}

  async guardarContacto(input: {
    contactId: string | null;
    nombre?: string;
    email?: string;
    telefono?: string;
    idempotencyKey: string;
  }): Promise<{ contactId: string }> {
    // `normalizePhone` devuelve un OBJETO con la forma canonica en `.e164`.
    // Convertirlo con String() habria escrito "[object Object]" como telefono
    // del contacto — el mismo fallo que ya costo dos correcciones en este
    // repositorio. `.e164` es null cuando el numero no se pudo normalizar.
    const telefono = input.telefono
      ? normalizePhone(input.telefono).e164
      : null;

    if (input.contactId) {
      // Solo se escribe lo que llega. Un nodo que actualiza el correo no debe
      // borrar el nombre que ya había por no haberlo enviado.
      await this.prisma.contact.updateMany({
        where: { id: input.contactId, companyId: this.companyId },
        data: {
          ...(input.nombre ? { name: input.nombre } : {}),
          ...(input.email ? { email: input.email } : {}),
          ...(telefono ? { phone: telefono } : {}),
        },
      });
      return { contactId: input.contactId };
    }

    // Sin id, se busca por teléfono antes de crear: dos contactos con el mismo
    // número en una empresa son un duplicado que después nadie fusiona.
    if (telefono) {
      const existente = await this.prisma.contact.findFirst({
        where: { companyId: this.companyId, phone: telefono },
        select: { id: true },
      });
      if (existente) {
        await this.prisma.contact.updateMany({
          where: { id: existente.id, companyId: this.companyId },
          data: {
            ...(input.nombre ? { name: input.nombre } : {}),
            ...(input.email ? { email: input.email } : {}),
          },
        });
        return { contactId: existente.id };
      }
    }

    const creado = await this.prisma.contact.create({
      data: {
        companyId: this.companyId,
        name: input.nombre ?? 'Contacto',
        phone: telefono ?? '',
        ...(input.email ? { email: input.email } : {}),
      },
      select: { id: true },
    });
    return { contactId: creado.id };
  }

  async etiquetar(input: {
    contactId: string;
    etiqueta: string;
    accion: 'add' | 'remove';
  }): Promise<void> {
    const contacto = await this.prisma.contact.findFirst({
      where: { id: input.contactId, companyId: this.companyId },
      select: { tags: true },
    });
    if (!contacto) return;

    const actuales = new Set(contacto.tags ?? []);
    if (input.accion === 'add') actuales.add(input.etiqueta);
    else actuales.delete(input.etiqueta);

    await this.prisma.contact.updateMany({
      where: { id: input.contactId, companyId: this.companyId },
      data: { tags: [...actuales] },
    });
  }

  /**
   * Campo personalizado, con almacenamiento REAL.
   *
   * Antes esto guardaba `campo:valor` como etiqueta porque `Contact` no tenia
   * donde ponerlo. Ya lo tiene, y el nodo no ha cambiado: es exactamente para
   * lo que sirve el puerto.
   *
   * Escribe por el MISMO servicio que la API, asi que un bot no puede guardar
   * un valor que un formulario rechazaria. Y NO crea la definicion sobre la
   * marcha: un campo que aparece porque un bot lo menciono llena el CRM de
   * columnas fantasma con erratas por nombre.
   */
  async campoPersonalizado(input: {
    contactId: string;
    campo: string;
    valor: string;
  }): Promise<void> {
    const r = await this.campos.establecerPorClave({
      companyId: this.companyId,
      entity: 'CONTACT',
      key: input.campo,
      valor: input.valor,
      destino: { contactId: input.contactId },
      origen: { source: 'FLOWBOT', executionId: this.executionId },
    });

    if (!r.ok) {
      // NO se traga en silencio. El motor clasifica: un campo inexistente o
      // un valor invalido son fallos de CONFIGURACION del flujo, no de red, y
      // reintentarlos mil veces no los va a arreglar.
      throw new ErrorDeConfiguracion(r.motivo);
    }
  }

  /**
   * Campo personalizado de la OPORTUNIDAD.
   *
   * Mismo camino, otra entidad. Existen los dos porque un dato del negocio
   * —"presupuesto aprobado"— pertenece a la oportunidad y no a la persona:
   * guardarlo en el contacto lo arrastraria a la siguiente venta, donde ya no
   * es cierto.
   */
  async campoOportunidad(input: {
    leadId: string;
    campo: string;
    valor: string;
  }): Promise<void> {
    const r = await this.campos.establecerPorClave({
      companyId: this.companyId,
      entity: 'LEAD',
      key: input.campo,
      valor: input.valor,
      destino: { leadId: input.leadId },
      origen: { source: 'FLOWBOT', executionId: this.executionId },
    });
    if (!r.ok) throw new ErrorDeConfiguracion(r.motivo);
  }

  /**
   * Archiva un contacto SIN borrar nada.
   *
   * Conserva conversaciones, oportunidades e historial: son datos del negocio
   * y de la persona. Lo que cambia es que deja de aparecer en las listas de
   * trabajo y que los bots no arrancan solos con el.
   *
   * Distinto de bloquear: archivar es "ya no esta activo", bloquear es una
   * decision sobre la relacion. Confundirlos haria que limpiar la lista
   * pareciera un veto.
   */
  async archivarContacto(input: {
    contactId: string;
    motivo?: string;
  }): Promise<void> {
    await this.prisma.contact.updateMany({
      // `archivedAt: null` en el filtro: archivar dos veces no puede mover la
      // fecha, o se perderia cuando ocurrio de verdad.
      where: {
        id: input.contactId,
        companyId: this.companyId,
        archivedAt: null,
      },
      data: {
        archivedAt: new Date(),
        archivedReason: input.motivo ?? null,
      },
    });
  }

  async crearOportunidad(input: {
    contactId: string | null;
    conversationId: string | null;
    titulo: string;
    pipelineId: string;
    stageId: string;
    valor?: number;
    idempotencyKey: string;
  }): Promise<{ leadId: string }> {
    // El pipeline y la etapa se comprueban contra la empresa ANTES de crear:
    // un id de otra empresa metería la oportunidad en su tablero.
    const etapa = await this.prisma.pipelineStage.findFirst({
      where: {
        id: input.stageId,
        pipelineId: input.pipelineId,
        pipeline: { companyId: this.companyId },
      },
      select: { id: true },
    });
    if (!etapa) {
      throw new Error('EtapaNoValidaError');
    }

    // El esquema exige contacto: una oportunidad sin dueño no se puede
    // trabajar ni volver a contactar. Es mejor fallar de forma clasificada que
    // crear una ficha huerfana que nadie sabra de quien es.
    if (!input.contactId) {
      throw new Error('SinContactoError');
    }

    const lead = await this.prisma.lead.create({
      data: {
        companyId: this.companyId,
        contactId: input.contactId,
        pipelineId: input.pipelineId,
        stageId: input.stageId,
        title: input.titulo,
        ...(input.valor !== undefined ? { value: input.valor } : {}),
      },
      select: { id: true },
    });

    if (input.conversationId) {
      await this.prisma.conversation.updateMany({
        where: { id: input.conversationId, companyId: this.companyId },
        data: { leadId: lead.id },
      });
    }
    return { leadId: lead.id };
  }

  async moverEtapa(input: { leadId: string; stageId: string }): Promise<void> {
    const lead = await this.prisma.lead.findFirst({
      where: { id: input.leadId, companyId: this.companyId },
      select: { id: true, stageId: true, pipelineId: true },
    });
    if (!lead) return;

    const etapa = await this.prisma.pipelineStage.findFirst({
      where: {
        id: input.stageId,
        pipelineId: lead.pipelineId,
        pipeline: { companyId: this.companyId },
      },
      select: { id: true },
    });
    // Mover a una etapa de otro pipeline dejaría la oportunidad en un tablero
    // y la etapa en otro.
    if (!etapa) throw new Error('EtapaNoValidaError');

    await this.prisma.$transaction([
      this.prisma.lead.updateMany({
        where: { id: input.leadId, companyId: this.companyId },
        data: { stageId: input.stageId },
      }),
      // El historial es lo que permite explicar después por qué se movió.
      this.prisma.leadStageHistory.create({
        data: {
          leadId: input.leadId,
          fromStageId: lead.stageId,
          toStageId: input.stageId,
        },
      }),
    ]);
  }

  async valorOportunidad(input: {
    leadId: string;
    valor: number;
  }): Promise<void> {
    await this.prisma.lead.updateMany({
      where: { id: input.leadId, companyId: this.companyId },
      data: { value: input.valor },
    });
  }

  async asignar(input: { leadId: string; userId: string }): Promise<void> {
    // El usuario debe ser de la empresa y estar activo: asignar a alguien de
    // otra empresa haría visible la oportunidad donde no debe.
    const usuario = await this.prisma.user.findFirst({
      where: { id: input.userId, companyId: this.companyId, isActive: true },
      select: { id: true },
    });
    if (!usuario) throw new Error('UsuarioNoValidoError');

    await this.prisma.lead.updateMany({
      where: { id: input.leadId, companyId: this.companyId },
      data: { assignedTo: input.userId },
    });
  }

  async siguienteEnTurno(_input: {
    conversationId: string | null;
  }): Promise<{ userId: string; nombre: string } | null> {
    // Reparto simple y estable: quien tenga menos oportunidades abiertas. No
    // usa azar, para que dos ejecuciones seguidas no le caigan a la misma
    // persona por casualidad.
    const candidatos = await this.prisma.user.findMany({
      where: {
        companyId: this.companyId,
        isActive: true,
        role: { in: ['ADMIN', 'AGENT'] },
      },
      select: {
        id: true,
        name: true,
        _count: { select: { leads: { where: { status: 'OPEN' } } } },
      },
    });
    if (candidatos.length === 0) return null;

    const elegido = candidatos.sort(
      (a, b) => a._count.leads - b._count.leads || (a.id < b.id ? -1 : 1),
    )[0];
    return { userId: elegido.id, nombre: elegido.name };
  }

  async cerrarOportunidad(input: {
    leadId: string;
    resultado: 'ganada' | 'perdida';
    motivo?: string;
  }): Promise<void> {
    await this.prisma.lead.updateMany({
      where: { id: input.leadId, companyId: this.companyId },
      data: {
        status: input.resultado === 'ganada' ? 'WON' : 'LOST',
        ...(input.motivo ? { lostReason: input.motivo } : {}),
      },
    });
  }

  async crearTarea(input: {
    titulo: string;
    conversationId: string | null;
    contactId: string | null;
    leadId: string | null;
    assignedTo?: string;
    venceEn?: Date;
    prioridad?: string;
    idempotencyKey: string;
  }): Promise<{ taskId: string }> {
    // Las relaciones se comprueban: una tarea colgada de una conversación de
    // otra empresa la haría visible desde su bandeja.
    const conversationId = await this.siEsDeLaEmpresa(
      'conversation',
      input.conversationId,
    );
    const contactId = await this.siEsDeLaEmpresa('contact', input.contactId);
    const leadId = await this.siEsDeLaEmpresa('lead', input.leadId);

    const tarea = await this.prisma.task.create({
      data: {
        companyId: this.companyId,
        title: input.titulo,
        conversationId,
        contactId,
        leadId,
        ...(input.assignedTo ? { assignedTo: input.assignedTo } : {}),
        ...(input.venceEn ? { dueDate: input.venceEn } : {}),
        ...(input.prioridad ? { priority: input.prioridad as never } : {}),
      },
      select: { id: true },
    });
    return { taskId: tarea.id };
  }

  async notaInterna(input: {
    conversationId: string;
    texto: string;
    idempotencyKey: string;
  }): Promise<void> {
    const conversacion = await this.prisma.conversation.findFirst({
      where: { id: input.conversationId, companyId: this.companyId },
      select: { id: true },
    });
    if (!conversacion) return;

    await this.prisma.note.create({
      data: {
        companyId: this.companyId,
        conversationId: input.conversationId,
        content: input.texto,
      },
    });
  }

  async cerrarConversacion(input: { conversationId: string }): Promise<void> {
    await this.prisma.conversation.updateMany({
      where: { id: input.conversationId, companyId: this.companyId },
      data: { status: 'RESOLVED' },
    });
  }

  async reabrirConversacion(input: { conversationId: string }): Promise<void> {
    await this.prisma.conversation.updateMany({
      where: { id: input.conversationId, companyId: this.companyId },
      data: { status: 'OPEN' },
    });
  }

  /**
   * Transfiere a una persona.
   *
   * DELEGA EN `HandoffService`, que persiste una fila con quien atiende, por
   * que, desde que ejecucion y desde que nodo. `isPaused` por si solo no
   * responde ninguna de esas preguntas: solo dice "el bot calla", y cuando
   * alguien pregunta por que, no hay respuesta.
   *
   * Es idempotente por conversacion: un reintento del mismo nodo no le roba
   * la conversacion al asesor que ya la tenia.
   */
  async transferir(input: {
    conversationId: string;
    userId?: string;
    motivo?: string;
    nota?: string;
    nodeId?: string;
  }): Promise<void> {
    await this.handoff.abrir({
      companyId: this.companyId,
      conversationId: input.conversationId,
      assignedToUserId: input.userId ?? null,
      reason: input.motivo ?? null,
      note: input.nota ?? null,
      executionId: this.executionId,
      nodeId: input.nodeId ?? null,
    });
  }

  /** Devuelve el id solo si la entidad es de esta empresa; si no, `null`. */
  private async siEsDeLaEmpresa(
    entidad: 'conversation' | 'contact' | 'lead',
    id: string | null,
  ): Promise<string | null> {
    if (!id) return null;
    const donde = { id, companyId: this.companyId };
    const encontrado =
      entidad === 'conversation'
        ? await this.prisma.conversation.findFirst({
            where: donde,
            select: { id: true },
          })
        : entidad === 'contact'
          ? await this.prisma.contact.findFirst({
              where: donde,
              select: { id: true },
            })
          : await this.prisma.lead.findFirst({
              where: donde,
              select: { id: true },
            });
    return encontrado?.id ?? null;
  }
}

/**
 * Un fallo que NO se arregla reintentando: el campo no existe, el valor no
 * pasa la validacion, la etapa es de otra empresa.
 *
 * El interprete lo clasifica como `configuracion` y saca la ejecucion por su
 * rama de error en vez de reintentar cinco veces algo que va a fallar igual
 * las cinco. Sin esta distincion, un flujo mal configurado consume la cola y
 * el cliente espera cinco backoffs para no recibir nada.
 */
export class ErrorDeConfiguracion extends Error {
  /** Lo lee el interprete para NO reintentar. Ver `claseDeclarada`. */
  readonly clase = 'configuracion' as const;

  constructor(motivo: string) {
    super(motivo);
    this.name = 'ErrorDeConfiguracion';
  }
}
