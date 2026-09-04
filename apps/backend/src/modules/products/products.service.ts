import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  type CatalogItemType,
  effectiveItemType,
  parseItemTypeFilter,
} from './catalog-item-type';

/** Fila de Prisma con el tipo efectivo: nunca sale `itemType: null`. */
function toResponse<T extends { itemType: CatalogItemType | null }>(row: T) {
  return { ...row, itemType: effectiveItemType(row.itemType) };
}

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async findAll(
    companyId: string,
    filters: {
      category?: string;
      search?: string;
      itemType?: string;
      limit?: string;
      offset?: string;
    },
  ) {
    const pagination = this.parsePagination(filters.limit, filters.offset);
    const itemTypeFilter = parseItemTypeFilter(filters.itemType);

    const rows = await this.prisma.product.findMany({
      where: {
        companyId,
        isActive: true,
        ...(filters.category && { category: filters.category }),
        ...(itemTypeFilter ?? {}),
        ...(filters.search && {
          OR: [
            { name: { contains: filters.search, mode: 'insensitive' } },
            { code: { contains: filters.search, mode: 'insensitive' } },
            { sku: { contains: filters.search, mode: 'insensitive' } },
          ],
        }),
      },
      orderBy: { name: 'asc' },
      ...pagination,
    });
    return rows.map(toResponse);
  }

  async findById(id: string, companyId: string) {
    return toResponse(await this.findRow(id, companyId));
  }

  // Siempre por empresa: un id de otro tenant es un 404 genérico, nunca 403.
  private async findRow(id: string, companyId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, companyId },
    });
    if (!product) throw new NotFoundException('Producto no encontrado');
    return product;
  }

  async create(
    companyId: string,
    data: {
      name: string;
      code?: string;
      description?: string;
      price: number;
      category?: string;
      sku?: string;
      stock?: number;
      imageUrl?: string;
      itemType?: CatalogItemType;
    },
  ) {
    // Un cliente antiguo que omite `itemType` crea un PRODUCT (explícito aquí
    // además del default de la columna, para que la fila nueva nunca sea NULL).
    const created = await this.prisma.product.create({
      data: { ...data, itemType: data.itemType ?? 'PRODUCT', companyId },
    });
    return toResponse(created);
  }

  async update(
    id: string,
    companyId: string,
    data: {
      name?: string;
      code?: string;
      description?: string;
      price?: number;
      category?: string;
      sku?: string;
      stock?: number;
      imageUrl?: string;
      isActive?: boolean;
      itemType?: CatalogItemType;
    },
  ) {
    await this.findRow(id, companyId);
    const updated = await this.prisma.product.update({ where: { id }, data });
    return toResponse(updated);
  }

  async remove(id: string, companyId: string) {
    await this.findRow(id, companyId);
    // Soft delete preserves historical references.
    const removed = await this.prisma.product.update({
      where: { id },
      data: { isActive: false },
    });
    return toResponse(removed);
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
