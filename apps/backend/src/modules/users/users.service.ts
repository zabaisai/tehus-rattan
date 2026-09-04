import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        companyId: true,
        createdAt: true,
        // La interfaz necesita saber si esta en la empresa de demostracion
        // para decirlo en pantalla. Viaja aqui —en el arranque de sesion— y no
        // en un endpoint aparte, porque preguntarlo por separado significaria
        // que hay un instante en el que la pantalla no lo sabe todavia.
        company: { select: { isDemo: true } },
      },
    });
  }

  async findAllByCompany(companyId: string) {
    return this.prisma.user.findMany({
      where: { companyId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });
  }

  async create(data: {
    email: string;
    password: string;
    name: string;
    companyId: string;
    role?: any;
  }) {
    const hashed = await bcrypt.hash(data.password, 10);
    return this.prisma.user.create({
      data: { ...data, password: hashed },
    });
  }

  async update(
    id: string,
    companyId: string,
    data: { name?: string; role?: any; isActive?: boolean },
  ) {
    const user = await this.prisma.user.findFirst({ where: { id, companyId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
      },
    });
  }

  /**
   * Desactiva la cuenta y, en la misma transacción, cierra sus sesiones y
   * retira la confianza de sus dispositivos (Fase 4.5).
   *
   * Antes bastaba con `isActive: false` porque cada petición revalida la
   * sesión; ahora además hay que impedir que un dispositivo recordado siga
   * evitando el segundo factor si la cuenta se reactiva.
   */
  async deactivate(id: string, companyId: string) {
    const user = await this.prisma.user.findFirst({ where: { id, companyId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return this.prisma.$transaction(async (tx) => {
      const actualizado = await tx.user.update({
        where: { id },
        data: { isActive: false },
        select: { id: true, email: true, isActive: true },
      });
      await tx.userSession.updateMany({
        where: { userId: id, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
      await tx.trustedDevice.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return actualizado;
    });
  }
}
