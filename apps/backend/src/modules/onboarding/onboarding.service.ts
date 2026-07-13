import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import * as bcrypt from 'bcryptjs';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import {
  CompanyBrandingService,
  UploadedLogoFile,
} from '../companies/company-branding.service';
import { CreateOnboardingCompanyDto } from './dto/create-onboarding-company.dto';

export interface OnboardingLogoFiles {
  logo?: UploadedLogoFile;
  secondaryLogo?: UploadedLogoFile;
}

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
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private prisma: PrismaService,
    private companyBrandingService: CompanyBrandingService,
    private authService: AuthService,
  ) {}

  // Accepts either a plain JSON body (existing behavior, unchanged) or a
  // multipart request where the JSON payload travels as a stringified
  // "data" field alongside file fields. Both paths run through the same
  // class-validator rules — this is a manual equivalent of the global
  // ValidationPipe, needed because the controller can't type this param as
  // CreateOnboardingCompanyDto directly (that would make Nest validate the
  // raw multipart body shape — {data: "...", logo: [...]} — instead of the
  // JSON payload nested inside it).
  async parsePayload(rawBody: unknown): Promise<CreateOnboardingCompanyDto> {
    const source = this.extractJsonSource(rawBody);
    const instance = plainToInstance(CreateOnboardingCompanyDto, source);
    const errors = await validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (errors.length > 0) {
      throw new BadRequestException(this.flattenValidationErrors(errors));
    }
    return instance;
  }

  private extractJsonSource(rawBody: unknown): Record<string, unknown> {
    if (
      rawBody &&
      typeof rawBody === 'object' &&
      typeof (rawBody as Record<string, unknown>).data === 'string'
    ) {
      try {
        return JSON.parse((rawBody as Record<string, unknown>).data as string);
      } catch {
        throw new BadRequestException('El campo "data" debe ser un JSON válido');
      }
    }
    return (rawBody ?? {}) as Record<string, unknown>;
  }

  private flattenValidationErrors(errors: ValidationError[]): string[] {
    const messages: string[] = [];
    const walk = (list: ValidationError[]) => {
      for (const error of list) {
        if (error.constraints) messages.push(...Object.values(error.constraints));
        if (error.children?.length) walk(error.children);
      }
    };
    walk(errors);
    return messages;
  }

  async createCompany(dto: CreateOnboardingCompanyDto, files?: OnboardingLogoFiles) {
    // Validate any logo files (extension, mimetype, size, magic bytes) as
    // the very first thing — before any database access at all — so a bad
    // file rejects the whole request with zero reads or writes, instead of
    // leaving a company (or even a wasted duplicate-email lookup) behind.
    if (files?.logo) this.companyBrandingService.assertValidLogoFile(files.logo);
    if (files?.secondaryLogo) {
      this.companyBrandingService.assertValidLogoFile(files.secondaryLogo);
    }

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

    let logoUrl = result.company.logoUrl;
    let secondaryLogoUrl = result.company.secondaryLogoUrl;

    if (files?.logo || files?.secondaryLogo) {
      try {
        if (files?.logo) {
          const updated = await this.companyBrandingService.uploadLogo(
            result.company.id,
            files.logo,
            'primary',
          );
          logoUrl = updated.logoUrl;
          secondaryLogoUrl = updated.secondaryLogoUrl;
        }
        if (files?.secondaryLogo) {
          const updated = await this.companyBrandingService.uploadLogo(
            result.company.id,
            files.secondaryLogo,
            'secondary',
          );
          logoUrl = updated.logoUrl;
          secondaryLogoUrl = updated.secondaryLogoUrl;
        }
      } catch (err) {
        // The DB transaction already committed by this point (writing an
        // uploaded file can't be part of the same Postgres transaction) —
        // so a logo failure here is compensated with an explicit cleanup
        // instead of leaving a company with a half-applied logo.
        await this.cleanupFailedCompany(result.company.id, result.pipeline.id);
        throw err;
      }
    }

    // Only mint a session once the company (and any logos) are fully and
    // successfully committed — never before, so a failed request can never
    // hand back a token for a company that doesn't actually exist. Agents
    // never reach this point at all, since only the admin created above is
    // ever passed in here.
    const session = this.authService.issueSession(result.admin);

    return {
      message: 'Empresa creada correctamente',
      company: {
        id: result.company.id,
        name: result.company.name,
        slug: result.company.slug,
        status: result.company.status,
        logoUrl,
        secondaryLogoUrl,
      },
      admin: this.toSafeUser(result.admin),
      agents: result.createdAgents,
      pipeline: { id: result.pipeline.id, name: result.pipeline.name },
      stages: result.stages.map((stage) => ({
        id: stage.id,
        name: stage.name,
        order: stage.order,
      })),
      token: session.token,
      user: session.user,
    };
  }

  private async cleanupFailedCompany(
    companyId: string,
    pipelineId: string,
  ): Promise<void> {
    try {
      await this.prisma.$transaction([
        this.prisma.pipelineStage.deleteMany({ where: { pipelineId } }),
        this.prisma.pipeline.delete({ where: { id: pipelineId } }),
        this.prisma.user.deleteMany({ where: { companyId } }),
        this.prisma.company.delete({ where: { id: companyId } }),
      ]);
    } catch (cleanupError) {
      // Never swallow this — an onboarding company that fails to clean up
      // needs a human to look at it, but the original logo error is still
      // what the client should see (thrown by the caller right after this).
      this.logger.error(
        `No se pudo limpiar la empresa ${companyId} tras un fallo de logo`,
        cleanupError instanceof Error ? cleanupError.stack : cleanupError,
      );
    } finally {
      const uploadsDir = path.join(process.cwd(), 'uploads', 'branding', companyId);
      fs.rmSync(uploadsDir, { recursive: true, force: true });
    }
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
