import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Lo que se perderia —o lo que se conservaria— al retirar un contacto.
 *
 * Se calcula ANTES de tocar nada y se le enseña a quien va a decidir. La
 * alternativa es un «¿seguro?» a ciegas: quien lo pulsa no sabe si detras hay
 * una conversacion de hace dos años en la que se acordo un precio, y cuando lo
 * descubre ya no hay vuelta atras.
 */
export interface ImpactoDeContacto {
  contactId: string;
  nombre: string | null;
  archivado: boolean;
  anonimizado: boolean;
  /** Cada cifra es una cosa que existe hoy y que la eliminacion afectaria. */
  relaciones: {
    conversaciones: number;
    mensajes: number;
    oportunidades: number;
    tareas: number;
    cotizaciones: number;
    notas: number;
    camposPersonalizados: number;
    ejecucionesDePulso: number;
    auditorias: number;
  };
  /** Suma de todo lo anterior EXCEPTO las auditorias. Ver `vacio`. */
  totalRelaciones: number;
  /**
   * Un contacto vacio es el que no tiene ninguna historia comercial. Las
   * auditorias NO cuentan: son el registro de lo que se hizo con el contacto
   * —incluido crearlo—, no historia del negocio, y si contaran ningun contacto
   * seria nunca eliminable, que es tanto como no tener eliminacion.
   */
  vacio: boolean;
  /** Que va a pasar si se confirma: `borrado` o `anonimizado`. */
  accionPropuesta: 'borrado' | 'anonimizado';
  /** Lo que se conserva pase lo que pase. */
  seConservan: string[];
}

/** Frase exacta que hay que escribir para una eliminacion definitiva. */
export const CONFIRMACION_REQUERIDA = 'ELIMINAR DEFINITIVAMENTE';

@Injectable()
export class ContactsEliminacionService {
  constructor(private prisma: PrismaService) {}

  /**
   * Cuenta el impacto real. Todas las consultas van acotadas por `companyId`
   * —directamente o a traves del contacto, que ya lo esta— para que el impacto
   * que se enseña sea el de ESTA empresa y no el de un id ajeno.
   */
  async impacto(id: string, companyId: string): Promise<ImpactoDeContacto> {
    const contacto = await this.prisma.contact.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        name: true,
        archivedAt: true,
        anonymizedAt: true,
      },
    });
    if (!contacto) throw new NotFoundException('Contacto no encontrado');

    const conversacionIds = (
      await this.prisma.conversation.findMany({
        where: { contactId: id, companyId },
        select: { id: true },
      })
    ).map((c) => c.id);

    const leadIds = (
      await this.prisma.lead.findMany({
        where: { contactId: id, companyId },
        select: { id: true },
      })
    ).map((l) => l.id);

    const [
      mensajes,
      tareas,
      cotizaciones,
      notas,
      camposPersonalizados,
      ejecucionesDePulso,
      auditorias,
    ] = await Promise.all([
      conversacionIds.length
        ? this.prisma.message.count({
            where: { conversationId: { in: conversacionIds } },
          })
        : Promise.resolve(0),
      this.prisma.task.count({ where: { contactId: id, companyId } }),
      leadIds.length
        ? this.prisma.quote.count({
            where: { leadId: { in: leadIds }, companyId },
          })
        : Promise.resolve(0),
      leadIds.length
        ? this.prisma.note.count({
            where: { leadId: { in: leadIds }, companyId },
          })
        : Promise.resolve(0),
      this.prisma.customFieldValue.count({
        where: { contactId: id, companyId },
      }),
      this.prisma.flowBotExecution.count({
        where: { contactId: id, companyId },
      }),
      this.prisma.auditLog.count({
        where: { entityType: 'Contact', entityId: id },
      }),
    ]);

    const relaciones = {
      conversaciones: conversacionIds.length,
      mensajes,
      oportunidades: leadIds.length,
      tareas,
      cotizaciones,
      notas,
      camposPersonalizados,
      ejecucionesDePulso,
      auditorias,
    };

    const totalRelaciones =
      relaciones.conversaciones +
      relaciones.mensajes +
      relaciones.oportunidades +
      relaciones.tareas +
      relaciones.cotizaciones +
      relaciones.notas +
      relaciones.camposPersonalizados +
      relaciones.ejecucionesDePulso;

    const vacio = totalRelaciones === 0;

    return {
      contactId: contacto.id,
      nombre: contacto.name,
      archivado: contacto.archivedAt !== null,
      anonimizado: contacto.anonymizedAt !== null,
      relaciones,
      totalRelaciones,
      vacio,
      accionPropuesta: vacio ? 'borrado' : 'anonimizado',
      seConservan: vacio
        ? ['El registro de auditoría de esta eliminación.']
        : [
            'Las conversaciones y sus mensajes, tal cual.',
            'Las oportunidades, cotizaciones y su valor comercial.',
            'Las tareas y notas asociadas.',
            'Todas las auditorías.',
          ],
    };
  }

  /**
   * Eliminacion definitiva. Dos caminos, y la diferencia no la elige quien
   * pulsa sino los datos:
   *
   * - Contacto VACIO: se borra de verdad. No hay nada que preservar y dejarlo
   *   archivado para siempre solo ensucia la papelera.
   *
   * - Contacto CON HISTORIA: se anonimiza. Se van los datos personales
   *   —nombre, telefono, correo, etiquetas, campos personalizados— y se queda
   *   todo lo que es del negocio: la conversacion, el precio acordado, la
   *   cotizacion firmada. Borrar eso en cascada seria destruir contabilidad
   *   para atender una peticion sobre datos personales, y son dos cosas
   *   distintas.
   *
   * Nunca hay `deleteMany` en cascada sobre mensajes ni auditorias.
   */
  async eliminarDefinitivo(
    id: string,
    companyId: string,
    opciones: { confirmacion: string; motivo?: string },
  ): Promise<{
    accion: 'borrado' | 'anonimizado';
    impacto: ImpactoDeContacto;
  }> {
    if (opciones.confirmacion?.trim() !== CONFIRMACION_REQUERIDA) {
      throw new BadRequestException(
        `Para eliminar definitivamente hay que escribir exactamente «${CONFIRMACION_REQUERIDA}».`,
      );
    }

    const impacto = await this.impacto(id, companyId);

    if (impacto.anonimizado) {
      throw new ConflictException(
        'Este contacto ya fue anonimizado; no queda ningún dato personal que eliminar.',
      );
    }

    if (impacto.vacio) {
      // El impacto se calculo fuera de transaccion, asi que entre aquel conteo
      // y este borrado pudo entrar un mensaje —es literalmente lo que hace un
      // cliente que escribe— y el contacto ya no estaria vacio. Se vuelve a
      // comprobar DENTRO de la transaccion y se aborta si algo aparecio: mejor
      // pedir que se reintente que llevarse por delante una conversacion que
      // nacio hace un segundo.
      await this.prisma.$transaction(async (tx) => {
        const [conversaciones, oportunidades, tareas, ejecuciones] =
          await Promise.all([
            tx.conversation.count({ where: { contactId: id, companyId } }),
            tx.lead.count({ where: { contactId: id, companyId } }),
            tx.task.count({ where: { contactId: id, companyId } }),
            tx.flowBotExecution.count({ where: { contactId: id, companyId } }),
          ]);

        if (conversaciones + oportunidades + tareas + ejecuciones > 0) {
          throw new ConflictException(
            'El contacto dejó de estar vacío mientras se preparaba la eliminación: ahora tiene historial. Vuelve a consultar el impacto.',
          );
        }

        await tx.customFieldValue.deleteMany({
          where: { contactId: id, companyId },
        });

        const borrados = await tx.contact.deleteMany({
          where: { id, companyId },
        });
        if (borrados.count === 0) {
          throw new ConflictException(
            'El contacto ya no existe. Puede que otra solicitud lo eliminara antes.',
          );
        }
      });

      return { accion: 'borrado', impacto };
    }

    await this.anonimizar(id, companyId, opciones.motivo);
    return { accion: 'anonimizado', impacto };
  }

  /**
   * Quita la PII y deja la historia.
   *
   * El telefono no puede quedar vacio: es parte del indice unico
   * `(phone, companyId)` y ademas es la llave por la que entra un mensaje. Se
   * sustituye por un marcador derivado del id, que es unico por construccion y
   * no dice nada de nadie.
   */
  private async anonimizar(
    id: string,
    companyId: string,
    motivo?: string,
  ): Promise<void> {
    const marcador = `anonimo:${id}`;

    await this.prisma.$transaction(async (tx) => {
      const actualizados = await tx.contact.updateMany({
        where: { id, companyId, anonymizedAt: null },
        data: {
          name: 'Contacto anonimizado',
          phone: marcador,
          email: null,
          tags: [],
          archivedAt: new Date(),
          archivedReason: motivo?.trim() || 'Eliminación definitiva solicitada',
          anonymizedAt: new Date(),
        },
      });

      if (actualizados.count === 0) {
        throw new ConflictException(
          'El contacto ya había sido anonimizado por otra solicitud.',
        );
      }

      // Los valores de campos personalizados SI se borran: son datos que la
      // empresa recogio sobre la persona (cedula, direccion, cumpleaños), no
      // historia comercial.
      await tx.customFieldValue.deleteMany({
        where: { contactId: id, companyId },
      });
    });
  }

  /** Contactos archivados de la empresa, lo que la interfaz llama papelera. */
  async papelera(
    companyId: string,
    opciones: { limit?: number; offset?: number } = {},
  ) {
    const take = this.entero(opciones.limit, 1, 100, 50, 'limit');
    const skip = this.entero(
      opciones.offset,
      0,
      Number.MAX_SAFE_INTEGER,
      0,
      'offset',
    );

    const [items, total] = await Promise.all([
      this.prisma.contact.findMany({
        // `mergedIntoId: null`: un alias de fusion no esta en la papelera. No
        // se archivo, se absorbio, y restaurarlo desde aqui devolveria a la
        // vida un duplicado que alguien acaba de resolver.
        where: { companyId, archivedAt: { not: null }, mergedIntoId: null },
        orderBy: { archivedAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.contact.count({
        where: { companyId, archivedAt: { not: null }, mergedIntoId: null },
      }),
    ]);

    return { items, total };
  }

  private entero(
    valor: number | undefined,
    min: number,
    max: number,
    porDefecto: number,
    nombre: string,
  ): number {
    if (valor === undefined) return porDefecto;
    if (!Number.isInteger(valor) || valor < min || valor > max) {
      throw new BadRequestException(
        `${nombre} debe ser un entero entre ${min} y ${max}`,
      );
    }
    return valor;
  }
}

/** Un contacto anonimizado se reconoce por el marcador de su telefono. */
export function esContactoAnonimizado(phone: string): boolean {
  return phone.startsWith('anonimo:');
}

export type ImpactoPrisma = Prisma.ContactGetPayload<{
  select: { id: true; name: true; archivedAt: true; anonymizedAt: true };
}>;
