import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CompanyStatus, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePlatformCompanyDto } from './dto/create-platform-company.dto';
import { PlatformAuditLogService } from './platform-audit-log.service';

interface ListCompaniesFilters {
  search?: string;
  status?: string;
}

export interface AuditActor {
  actorUserId: string;
  actorRole: Role;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const VALID_STATUSES = Object.values(CompanyStatus);

@Injectable()
export class PlatformCompaniesService {
  constructor(
    private prisma: PrismaService,
    private auditLogService: PlatformAuditLogService,
  ) {}

  async listCompanies(filters: ListCompaniesFilters = {}) {
    const where: {
      name?: { contains: string; mode: 'insensitive' };
      status?: CompanyStatus;
    } = {};

    const search = filters.search?.trim();
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    if (filters.status !== undefined) {
      where.status = this.parseStatus(filters.status);
    }

    const companies = await this.prisma.company.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        phone: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        users: { select: { isActive: true } },
        _count: {
          select: { contacts: true, leads: true, conversations: true },
        },
        whatsappIntegration: { select: { status: true } },
      },
    });

    return companies.map((company) => this.toListItem(company));
  }

  async getCompanyDetail(id: string) {
    const trimmedId = this.requireNonBlank(id, 'id no puede estar vacio');

    const company = await this.prisma.company.findUnique({
      where: { id: trimmedId },
      select: {
        id: true,
        name: true,
        phone: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        users: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            isActive: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        _count: {
          select: {
            contacts: true,
            leads: true,
            conversations: true,
            tasks: true,
            products: true,
          },
        },
        whatsappIntegration: {
          select: {
            status: true,
            phoneNumberId: true,
            displayPhoneNumber: true,
          },
        },
      },
    });

    if (!company) {
      throw new NotFoundException('Empresa no encontrada');
    }

    return {
      id: company.id,
      name: company.name,
      phone: company.phone,
      status: company.status,
      createdAt: company.createdAt,
      updatedAt: company.updatedAt,
      users: {
        total: company.users.length,
        items: company.users,
      },
      counts: {
        contacts: company._count.contacts,
        leads: company._count.leads,
        conversations: company._count.conversations,
        tasks: company._count.tasks,
        products: company._count.products,
      },
      whatsapp: {
        connected: company.whatsappIntegration?.status === 'CONNECTED',
        status: company.whatsappIntegration?.status ?? null,
        phoneNumberId: company.whatsappIntegration?.phoneNumberId ?? null,
        displayPhoneNumber:
          company.whatsappIntegration?.displayPhoneNumber ?? null,
      },
    };
  }

  async createCompany(dto: CreatePlatformCompanyDto, actor: AuditActor) {
    const companyName = this.requireNonBlank(
      dto.companyName,
      'companyName no puede estar vacio',
    );
    const adminName = this.requireNonBlank(
      dto.adminName,
      'adminName no puede estar vacio',
    );
    const adminEmail = this.requireNonBlank(
      dto.adminEmail,
      'adminEmail no puede estar vacio',
    ).toLowerCase();
    const companyPhone = dto.companyPhone?.trim() || undefined;

    const existingUser = await this.prisma.user.findUnique({
      where: { email: adminEmail },
      select: { id: true },
    });
    if (existingUser) {
      throw new ConflictException(
        'El email del administrador ya está registrado',
      );
    }

    if (companyPhone) {
      const existingCompany = await this.prisma.company.findUnique({
        where: { phone: companyPhone },
        select: { id: true },
      });
      if (existingCompany) {
        throw new ConflictException(
          'El teléfono de la empresa ya está registrado',
        );
      }
    }

    const passwordHash = await bcrypt.hash(dto.adminPassword, 10);

    const company = await this.prisma.$transaction(async (tx) => {
      const created = await tx.company.create({
        data: {
          name: companyName,
          phone: companyPhone,
          status: 'ACTIVE',
          users: {
            create: {
              name: adminName,
              email: adminEmail,
              password: passwordHash,
              role: 'ADMIN',
            },
          },
        },
        select: {
          id: true,
          name: true,
          phone: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          users: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              isActive: true,
              createdAt: true,
            },
          },
        },
      });

      // If this write fails, the transaction rolls back the Company/User
      // creation too — a sensitive platform action must never go unlogged.
      await this.auditLogService.record(tx, {
        actorUserId: actor.actorUserId,
        actorRole: actor.actorRole,
        affectedCompanyId: created.id,
        action: 'CREATE_COMPANY',
        entityType: 'Company',
        entityId: created.id,
        metadata: {
          companyName: created.name,
          companyPhone: created.phone,
          adminEmail: created.users[0].email,
          adminUserId: created.users[0].id,
          companyId: created.id,
        },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return created;
    });

    return {
      id: company.id,
      name: company.name,
      phone: company.phone,
      status: company.status,
      createdAt: company.createdAt,
      updatedAt: company.updatedAt,
      admin: company.users[0],
    };
  }

  async updateCompanyStatus(
    id: string,
    status: CompanyStatus,
    actor: AuditActor,
    reason?: string,
  ) {
    const trimmedId = this.requireNonBlank(id, 'id no puede estar vacio');

    const company = await this.prisma.company.findUnique({
      where: { id: trimmedId },
      select: { id: true, name: true, status: true },
    });
    if (!company) {
      throw new NotFoundException('Empresa no encontrada');
    }

    if (company.status === 'DELETED' && status !== 'DELETED') {
      throw new BadRequestException(
        'Una empresa marcada como DELETED no puede reactivarse',
      );
    }

    const fromStatus = company.status;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.company.update({
        where: { id: trimmedId },
        data: { status },
        select: {
          id: true,
          name: true,
          phone: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      // If this write fails, the transaction rolls back the status change
      // too — a sensitive platform action must never go unlogged.
      await this.auditLogService.record(tx, {
        actorUserId: actor.actorUserId,
        actorRole: actor.actorRole,
        affectedCompanyId: trimmedId,
        action: 'UPDATE_COMPANY_STATUS',
        entityType: 'Company',
        entityId: trimmedId,
        reason: reason?.trim() || null,
        metadata: {
          fromStatus,
          toStatus: status,
          companyName: updated.name,
          companyId: trimmedId,
        },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return updated;
    });
  }

  private parseStatus(value: string): CompanyStatus {
    if (!VALID_STATUSES.includes(value as CompanyStatus)) {
      throw new BadRequestException(
        'status debe ser ACTIVE, SUSPENDED o DELETED',
      );
    }
    return value as CompanyStatus;
  }

  private requireNonBlank(
    value: string | undefined,
    message: string,
  ): string {
    if (!value?.trim()) {
      throw new BadRequestException(message);
    }
    return value.trim();
  }

  private toListItem(company: {
    id: string;
    name: string;
    phone: string | null;
    status: CompanyStatus;
    createdAt: Date;
    updatedAt: Date;
    users: { isActive: boolean }[];
    _count: { contacts: number; leads: number; conversations: number };
    whatsappIntegration: { status: string } | null;
  }) {
    return {
      id: company.id,
      name: company.name,
      phone: company.phone,
      status: company.status,
      createdAt: company.createdAt,
      updatedAt: company.updatedAt,
      totalUsers: company.users.length,
      activeUsers: company.users.filter((u) => u.isActive).length,
      totalContacts: company._count.contacts,
      totalLeads: company._count.leads,
      totalConversations: company._count.conversations,
      whatsappConnected: company.whatsappIntegration?.status === 'CONNECTED',
    };
  }
}
