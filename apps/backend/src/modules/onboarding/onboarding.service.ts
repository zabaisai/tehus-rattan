import { ConflictException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateOnboardingCompanyDto } from './dto/create-onboarding-company.dto';

const COMBINING_DIACRITICS = /[̀-ͯ]/g;

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(COMBINING_DIACRITICS, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface SafeUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

@Injectable()
export class OnboardingService {
  constructor(private prisma: PrismaService) {}

  async createCompany(dto: CreateOnboardingCompanyDto) {
    const adminEmail = dto.admin.email.trim().toLowerCase();
    const agents = dto.agents ?? [];
    const agentEmails = agents.map((agent) => agent.email.trim().toLowerCase());

    const allEmails = [adminEmail, ...agentEmails];
    const uniqueEmails = new Set(allEmails);
    if (uniqueEmails.size !== allEmails.length) {
      throw new ConflictException(
        'Hay emails repetidos dentro de la misma solicitud',
      );
    }

    const existingUsers = await this.prisma.user.findMany({
      where: { email: { in: allEmails } },
      select: { email: true },
    });
    if (existingUsers.length > 0) {
      throw new ConflictException(
        `Los siguientes emails ya están registrados: ${existingUsers
          .map((u) => u.email)
          .join(', ')}`,
      );
    }

    const companyName = dto.company.name.trim();
    const slug = await this.generateUniqueSlug(companyName);

    const adminPasswordHash = await bcrypt.hash(dto.admin.password, 10);
    const agentPasswordHashes = await Promise.all(
      agents.map((agent) => bcrypt.hash(agent.password, 10)),
    );

    const settings = {
      sellsProducts: dto.commercial.sellsProducts,
      sellsServices: dto.commercial.sellsServices,
      usesCatalog: dto.commercial.usesCatalog,
      usesQuotes: dto.commercial.usesQuotes,
      usesTasks: dto.commercial.usesTasks,
      categories: dto.commercial.categories,
    };

    const result = await this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          name: companyName,
          slug,
          businessType: dto.company.businessType?.trim() || undefined,
          city: dto.company.city?.trim() || undefined,
          country: dto.company.country?.trim() || undefined,
          phone: dto.company.phone?.trim() || undefined,
          email: dto.company.email?.trim().toLowerCase() || undefined,
          website: dto.company.website?.trim() || undefined,
          description: dto.company.description?.trim() || undefined,
          logoUrl: dto.branding?.logoUrl?.trim() || undefined,
          secondaryLogoUrl: dto.branding?.secondaryLogoUrl?.trim() || undefined,
          primaryColor: dto.branding?.primaryColor?.trim() || undefined,
          accentColor: dto.branding?.accentColor?.trim() || undefined,
          backgroundColor: dto.branding?.backgroundColor?.trim() || undefined,
          settings,
        },
      });

      const admin = await tx.user.create({
        data: {
          name: dto.admin.name.trim(),
          email: adminEmail,
          password: adminPasswordHash,
          role: 'ADMIN',
          companyId: company.id,
        },
      });

      const createdAgents: SafeUser[] = [];
      for (let i = 0; i < agents.length; i++) {
        const agent = await tx.user.create({
          data: {
            name: agents[i].name.trim(),
            email: agentEmails[i],
            password: agentPasswordHashes[i],
            // Hardcoded regardless of any client-supplied value — onboarding
            // can never mint an ADMIN or SUPER_ADMIN through this array.
            role: 'AGENT',
            companyId: company.id,
          },
        });
        createdAgents.push(this.toSafeUser(agent));
      }

      const pipeline = await tx.pipeline.create({
        data: {
          name: dto.pipeline.name.trim(),
          isDefault: true,
          companyId: company.id,
        },
      });

      const stages: Array<{ id: string; name: string; order: number }> = [];
      for (let i = 0; i < dto.pipeline.stages.length; i++) {
        const stageName = dto.pipeline.stages[i].trim();
        if (!stageName) continue;
        const stage = await tx.pipelineStage.create({
          data: { name: stageName, order: i, pipelineId: pipeline.id },
        });
        stages.push(stage);
      }

      return { company, admin, createdAgents, pipeline, stages };
    });

    return {
      message: 'Empresa creada correctamente',
      company: {
        id: result.company.id,
        name: result.company.name,
        slug: result.company.slug,
        status: result.company.status,
      },
      admin: this.toSafeUser(result.admin),
      agents: result.createdAgents,
      pipeline: { id: result.pipeline.id, name: result.pipeline.name },
      stages: result.stages.map((stage) => ({
        id: stage.id,
        name: stage.name,
        order: stage.order,
      })),
    };
  }

  private toSafeUser(user: {
    id: string;
    name: string;
    email: string;
    role: string;
  }): SafeUser {
    return { id: user.id, name: user.name, email: user.email, role: user.role };
  }

  private async generateUniqueSlug(companyName: string): Promise<string> {
    const base = slugify(companyName) || 'empresa';
    let candidate = base;
    let suffix = 2;

    // A handful of sequential lookups is fine here — onboarding is a rare,
    // invite-gated action, not a high-traffic path.
    while (await this.prisma.company.findUnique({ where: { slug: candidate } })) {
      candidate = `${base}-${suffix}`;
      suffix++;
    }

    return candidate;
  }
}
