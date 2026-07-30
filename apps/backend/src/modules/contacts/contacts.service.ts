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
    filters: { search?: string; limit?: string; offset?: string } = {},
  ) {
    const pagination = this.parsePagination(filters.limit, filters.offset);

    return this.prisma.contact.findMany({
      where: {
        companyId,
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
    await this.findById(id, companyId);
    return this.prisma.contact.update({
      where: { id },
      data,
    });
  }

  async remove(id: string, companyId: string) {
    await this.findById(id, companyId);
    return this.prisma.contact.delete({ where: { id } });
  }

  async block(id: string, companyId: string) {
    await this.findById(id, companyId);
    return this.prisma.contact.update({
      where: { id },
      data: { isBlocked: true },
    });
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
