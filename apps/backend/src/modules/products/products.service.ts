import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async findAll(
    companyId: string,
    filters: { category?: string; search?: string },
  ) {
    return this.prisma.product.findMany({
      where: {
        companyId,
        isActive: true,
        ...(filters.category && { category: filters.category }),
        ...(filters.search && {
          OR: [
            { name: { contains: filters.search, mode: 'insensitive' } },
            { code: { contains: filters.search, mode: 'insensitive' } },
            { sku: { contains: filters.search, mode: 'insensitive' } },
          ],
        }),
      },
      orderBy: { name: 'asc' },
    });
  }

  async findById(id: string, companyId: string) {
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
    },
  ) {
    return this.prisma.product.create({
      data: { ...data, companyId },
    });
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
    },
  ) {
    await this.findById(id, companyId);
    return this.prisma.product.update({ where: { id }, data });
  }

  async remove(id: string, companyId: string) {
    await this.findById(id, companyId);
    // Eliminación lógica, no física — preserva el historial de cotizaciones que lo referencien
    return this.prisma.product.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
