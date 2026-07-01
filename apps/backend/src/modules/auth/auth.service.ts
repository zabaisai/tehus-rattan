import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private prisma: PrismaService,
  ) {}

  async register(data: {
    companyName: string;
    name: string;
    email: string;
    password: string;
  }) {
    const exists = await this.usersService.findByEmail(data.email);
    if (exists) throw new ConflictException('El email ya está registrado');

    const company = await this.prisma.company.create({
      data: { name: data.companyName },
    });

    const user = await this.usersService.create({
      email: data.email,
      password: data.password,
      name: data.name,
      companyId: company.id,
      role: 'ADMIN',
    });

    const token = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      companyId: user.companyId,
    });

    return { token, user: { id: user.id, email: user.email, name: user.name } };
  }

  async login(email: string, password: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user) throw new UnauthorizedException('Credenciales inválidas');

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) throw new UnauthorizedException('Credenciales inválidas');

    if (!user.isActive)
      throw new UnauthorizedException('Credenciales inválidas');

    const token = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      companyId: user.companyId,
    });

    return { token, user: { id: user.id, email: user.email, name: user.name } };
  }

  async me(userId: string) {
    return this.usersService.findById(userId);
  }
}
