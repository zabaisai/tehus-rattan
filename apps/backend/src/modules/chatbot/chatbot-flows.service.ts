import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { validarFlujo, type FlujoChatbot } from './chatbot.nodes';

/**
 * Gestión de flujos: borrador, publicación y versiones.
 *
 * EDITAR Y PUBLICAR SON DOS ACCIONES DISTINTAS. El borrador se guarda cuantas
 * veces haga falta sin validar nada, porque a media edición un flujo está
 * incompleto por definición y bloquear el guardado obligaría a construirlo en
 * el orden exacto que el validador espera. La validación ocurre al publicar,
 * que es cuando el flujo va a atender a clientes de verdad.
 */
@Injectable()
export class ChatbotFlowsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(companyId: string) {
    return this.prisma.chatbotFlow.findMany({
      where: { companyId },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { sessions: true } },
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
          select: { version: true, publishedAt: true },
        },
      },
    });
  }

  async findById(id: string, companyId: string) {
    const flujo = await this.prisma.chatbotFlow.findFirst({
      where: { id, companyId },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 10,
          select: {
            id: true,
            version: true,
            publishedAt: true,
            publishedBy: true,
          },
        },
      },
    });
    if (!flujo) throw new NotFoundException('Flujo no encontrado');
    return flujo;
  }

  async create(
    companyId: string,
    data: { name: string; draftNodes?: FlujoChatbot; triggerKeywords?: string[] },
  ) {
    return this.prisma.chatbotFlow.create({
      data: {
        companyId,
        name: data.name,
        // Un flujo nuevo nace con un nodo de bienvenida en vez de vacío: la
        // pantalla en blanco es donde la gente abandona.
        draftNodes: (data.draftNodes ??
          this.flujoDeEjemplo()) as unknown as Prisma.InputJsonValue,
        triggerKeywords: data.triggerKeywords ?? [],
      },
    });
  }

  async updateDraft(
    id: string,
    companyId: string,
    data: {
      name?: string;
      draftNodes?: FlujoChatbot;
      triggerKeywords?: string[];
      isActive?: boolean;
    },
  ) {
    await this.findById(id, companyId);

    return this.prisma.chatbotFlow.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.draftNodes !== undefined
          ? { draftNodes: data.draftNodes as unknown as Prisma.InputJsonValue }
          : {}),
        ...(data.triggerKeywords !== undefined
          ? { triggerKeywords: data.triggerKeywords }
          : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        // Tocar el borrador NO cambia lo que atiende: sigue publicada la
        // versión anterior hasta que alguien publique a propósito.
        status: 'DRAFT',
      },
    });
  }

  /**
   * Publica el borrador como una nueva versión inmutable.
   *
   * Aquí sí se valida: a partir de este momento el flujo habla con clientes.
   */
  async publish(id: string, companyId: string, userId?: string) {
    const flujo = await this.findById(id, companyId);
    const definicion = flujo.draftNodes as unknown as FlujoChatbot;

    const problemas = validarFlujo(definicion);
    if (problemas.length) {
      throw new BadRequestException({
        message: 'El flujo tiene problemas que impiden publicarlo',
        problemas,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const siguiente = (flujo.publishedVersion ?? 0) + 1;

      await tx.chatbotFlowVersion.create({
        data: {
          flowId: id,
          version: siguiente,
          nodes: definicion as unknown as Prisma.InputJsonValue,
          publishedBy: userId ?? null,
        },
      });

      return tx.chatbotFlow.update({
        where: { id },
        data: {
          publishedVersion: siguiente,
          status: 'PUBLISHED',
          // Publicar no activa por sí solo: activar es una decisión aparte,
          // y unirlas haría que revisar un flujo lo pusiera a atender.
        },
      });
    });
  }

  /** Comprueba el borrador sin publicarlo, para el aviso en pantalla. */
  validarBorrador(definicion: FlujoChatbot) {
    return validarFlujo(definicion);
  }

  async remove(id: string, companyId: string) {
    await this.findById(id, companyId);

    const activas = await this.prisma.chatbotSession.count({
      where: { flowId: id, status: 'ACTIVE' },
    });
    if (activas > 0) {
      // Borrarlo dejaría a esas personas a mitad de una conversación sin que
      // nadie lo sepa. Desactivarlo es lo que se quiere casi siempre.
      throw new BadRequestException(
        `No se puede eliminar: ${activas} conversacion(es) lo están usando ahora mismo. Desactívalo y vuelve a intentarlo cuando terminen.`,
      );
    }

    return this.prisma.chatbotFlow.delete({ where: { id } });
  }

  async sessions(companyId: string, filtros: { status?: string; limit?: number } = {}) {
    return this.prisma.chatbotSession.findMany({
      where: {
        companyId,
        ...(filtros.status ? { status: filtros.status as never } : {}),
      },
      orderBy: { lastInteractionAt: 'desc' },
      take: Math.min(filtros.limit ?? 50, 200),
      select: {
        id: true,
        status: true,
        currentNode: true,
        steps: true,
        startedAt: true,
        lastInteractionAt: true,
        endedAt: true,
        conversationId: true,
        flow: { select: { id: true, name: true } },
        flowVersion: { select: { version: true } },
      },
    });
  }

  private flujoDeEjemplo(): FlujoChatbot {
    return {
      start: 'bienvenida',
      nodes: [
        {
          id: 'bienvenida',
          type: 'menu',
          text: '¡Hola! ¿En qué te puedo ayudar?',
          options: [
            { label: 'Quiero información de un producto', next: 'info' },
            { label: 'Hablar con un asesor', next: 'asesor' },
          ],
        },
        {
          id: 'info',
          type: 'question',
          text: '¿Qué producto te interesa?',
          saveAs: 'producto',
          next: 'asesor',
        },
        {
          id: 'asesor',
          type: 'handoff',
          text: 'Ya te paso con una persona del equipo.',
        },
      ],
    };
  }
}
