import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  normalizePhone,
  phoneLookupVariants,
} from '../../common/phone/e164.util';

@Injectable()
export class ContactsService {
  constructor(private prisma: PrismaService) {}

  async findAll(
    companyId: string,
    filters: {
      search?: string;
      limit?: string;
      offset?: string;
      includeArchived?: boolean;
    } = {},
  ) {
    const pagination = this.parsePagination(filters.limit, filters.offset);

    return this.prisma.contact.findMany({
      where: {
        companyId,
        // Un contacto ABSORBIDO por una fusion no es un contacto: es un alias
        // que solo existe para que sus enlaces antiguos sigan resolviendo. No
        // sale en activos y tampoco en papelera, porque no esta archivado sino
        // fusionado, y ofrecerlo para acciones nuevas seria volver a partir en
        // dos a la persona que se acaba de unificar.
        mergedIntoId: null,
        // Los archivados NO salen salvo que se pidan. Verlos mezclados con los
        // activos hace dudar de cuales siguen vivos, que es justo lo que
        // archivar pretende resolver.
        ...(filters.includeArchived ? {} : { archivedAt: null }),
        ...(filters.search && {
          OR: [
            { name: { contains: filters.search, mode: 'insensitive' } },
            { phone: { contains: filters.search, mode: 'insensitive' } },
            { email: { contains: filters.search, mode: 'insensitive' } },
            // Compatibilidad: buscar sin "+" debe encontrar al contacto ya
            // normalizado, y al revés, mientras convivan ambas formas.
            ...phoneLookupVariants(filters.search).map((v) => ({
              phone: { contains: v, mode: 'insensitive' as const },
            })),
          ],
        }),
      },
      orderBy: { createdAt: 'desc' },
      ...pagination,
    });
  }

  async findById(id: string, companyId: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id, companyId },
    });
    if (!contact) throw new NotFoundException('Contacto no encontrado');
    return contact;
  }

  // Normaliza a E.164 antes de escribir y reutiliza el contacto existente si
  // el mismo número ya está guardado en otra forma. Sin esto, "573001112233"
  // (lo que entrega Meta) y "+573001112233" (lo que teclea un asesor) son dos
  // contactos distintos para el índice único (phone, companyId).
  //
  // Un número no normalizable se guarda tal cual en vez de rechazarse: perder
  // el contacto sería peor que guardarlo en un formato imperfecto, y el
  // backfill puede revisarlo después.
  async create(
    companyId: string,
    data: {
      phone: string;
      name?: string;
      email?: string;
      tags?: string[];
    },
  ) {
    const { e164 } = normalizePhone(data.phone);
    const phone = e164 ?? data.phone;

    const existente = await this.prisma.contact.findFirst({
      where: {
        companyId,
        phone: { in: phoneLookupVariants(data.phone) },
      },
    });

    if (existente) {
      // Aprovecha para migrar la fila a la forma canónica y completar el
      // nombre si el contacto se creó sin él (caso típico del webhook).
      const cambios: { phone?: string; name?: string } = {};
      if (e164 && existente.phone !== e164) cambios.phone = e164;
      if (!existente.name && data.name) cambios.name = data.name;

      if (Object.keys(cambios).length === 0) return existente;

      return this.prisma.contact.update({
        where: { id: existente.id },
        data: cambios,
      });
    }

    return this.prisma.contact.create({
      data: { ...data, phone, companyId },
    });
  }

  async update(
    id: string,
    companyId: string,
    data: {
      name?: string;
      email?: string;
      tags?: string[];
    },
  ) {
    const actual = await this.findById(id, companyId);

    // Devolverle nombre o correo a un contacto anonimizado deshace en un clic
    // lo que se hizo para atender una supresion de datos. Se bloquea.
    if (actual.anonymizedAt) {
      throw new BadRequestException(
        'Este contacto fue anonimizado; sus datos personales no se pueden volver a rellenar.',
      );
    }

    // `updateMany` con companyId en el filtro y no `update` con el id suelto:
    // entre el `findById` de arriba y la escritura hay una ventana, estrecha
    // pero real, en la que el id podria dejar de pertenecer a esta empresa.
    const actualizados = await this.prisma.contact.updateMany({
      where: { id, companyId },
      data,
    });
    if (actualizados.count === 0) {
      throw new NotFoundException('Contacto no encontrado');
    }
    return this.findById(id, companyId);
  }

  /**
   * "Eliminar" un contacto lo ARCHIVA. No lo borra.
   *
   * Borrarlo de verdad se llevaria por delante sus conversaciones, sus
   * mensajes y sus oportunidades —o dejaria filas huerfanas—, y esa
   * informacion es del negocio: la conversacion en la que se acordo un precio
   * no deja de existir porque alguien limpie la lista de contactos. Ademas
   * casi nunca es lo que se quiere: se pulsa "eliminar" para dejar de verlo,
   * no para destruir el historial.
   *
   * El borrado real existe y tiene su camino: la solicitud de eliminacion de
   * datos, que es deliberadamente mas lenta y deja constancia.
   *
   * Si la persona vuelve a escribir, `CompanyLeadSettings.reactivateArchived`
   * decide si se reactiva sola: el motor ya aplica esa politica en la entrada
   * de mensajes.
   */
  async remove(id: string, companyId: string, reason?: string) {
    await this.findById(id, companyId);

    // `archivedAt: null` en el filtro: archivar dos veces no puede pisar la
    // fecha original ni el motivo por el que se archivo la primera vez.
    const actualizados = await this.prisma.contact.updateMany({
      where: { id, companyId, archivedAt: null },
      data: {
        archivedAt: new Date(),
        archivedReason: reason?.trim() || null,
      },
    });

    return {
      archivado: actualizados.count > 0,
      yaEstaba: actualizados.count === 0,
    };
  }

  /** Devuelve un contacto archivado a las listas de trabajo. */
  async restore(id: string, companyId: string) {
    const actual = await this.findById(id, companyId);

    // Un contacto anonimizado ya no tiene nombre, telefono ni correo: sacarlo
    // a la lista de trabajo solo pondria una fila llamada «Contacto
    // anonimizado» que nadie puede usar para nada.
    if (actual.anonymizedAt) {
      throw new BadRequestException(
        'Un contacto anonimizado no se puede restaurar: ya no conserva datos de contacto.',
      );
    }

    const actualizados = await this.prisma.contact.updateMany({
      where: { id, companyId, archivedAt: { not: null } },
      data: { archivedAt: null, archivedReason: null },
    });

    return {
      restaurado: actualizados.count > 0,
      yaEstaba: actualizados.count === 0,
    };
  }

  async block(id: string, companyId: string) {
    await this.findById(id, companyId);
    const actualizados = await this.prisma.contact.updateMany({
      where: { id, companyId },
      data: { isBlocked: true },
    });
    if (actualizados.count === 0) {
      throw new NotFoundException('Contacto no encontrado');
    }
    return this.findById(id, companyId);
  }

  private parsePagination(limit?: string, offset?: string) {
    const pagination: { take?: number; skip?: number } = {};

    if (limit !== undefined) {
      const take = Number(limit);
      if (!Number.isInteger(take) || take < 1 || take > 100) {
        throw new BadRequestException('limit debe ser un entero entre 1 y 100');
      }
      pagination.take = take;
    }

    if (offset !== undefined) {
      const skip = Number(offset);
      if (!Number.isInteger(skip) || skip < 0) {
        throw new BadRequestException(
          'offset debe ser un entero mayor o igual a 0',
        );
      }
      pagination.skip = skip;
    }

    return pagination;
  }
}
