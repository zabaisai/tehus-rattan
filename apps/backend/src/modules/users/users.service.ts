import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  // Returns the FULL row including `password` — this is the login path
  // (AuthService.validateUser needs the hash for bcrypt.compare). Never surface
  // this result in an HTTP response; every controller-facing read below uses an
  // explicit `select` that omits `password`.
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
    // Explicit select: the created row carries the bcrypt hash and must never
    // reach the HTTP response (POST /users returned it before this fix).
    return this.prisma.user.create({
      data: { ...data, password: hashed },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        companyId: true,
        createdAt: true,
      },
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

  async deactivate(id: string, companyId: string) {
    const user = await this.prisma.user.findFirst({ where: { id, companyId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return this.prisma.user.update({
      where: { id },
      data: { isActive: false },
      select: { id: true, email: true, isActive: true },
    });
  }
}
