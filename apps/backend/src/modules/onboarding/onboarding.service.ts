import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import * as bcrypt from 'bcryptjs';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { PlatformAuditLogService } from '../platform/platform-audit-log.service';
import {
  CompanyBrandingService,
  UploadedLogoFile,
} from '../companies/company-branding.service';
import { Prisma } from '@prisma/client';
import {
  CreateOnboardingCompanyDto,
  OnboardingCommercialDto,
  OnboardingPipelineDto,
} from './dto/create-onboarding-company.dto';
import {
  hashInvitationCode,
  normalizeInvitationCode,
} from '../invitation-codes/invitation-code.util';
import {
  buildCompanySettingsV2,
  normalizeCategories,
  validateTypedStages,
  type TypedStageInput,
  type VerticalInfo,
} from '../companies/company-settings';
import {
  findBusinessType,
  findIndustry,
  ONBOARDING_TEMPLATES_VERSION,
} from './templates/onboarding-templates';
import { SessionsService } from '../sessions/sessions.service';
import { SessionRequestContext } from '../sessions/utils/request-context.util';

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
    private auditLogService: PlatformAuditLogService,
    private sessionsService: SessionsService,
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
        throw new BadRequestException(
          'El campo "data" debe ser un JSON válido',
        );
      }
    }
    return (rawBody ?? {}) as Record<string, unknown>;
  }

  private flattenValidationErrors(errors: ValidationError[]): string[] {
    const messages: string[] = [];
    const walk = (list: ValidationError[]) => {
      for (const error of list) {
        if (error.constraints)
          messages.push(...Object.values(error.constraints));
        if (error.children?.length) walk(error.children);
      }
    };
    walk(errors);
    return messages;
  }

  async createCompany(
    dto: CreateOnboardingCompanyDto,
    files: OnboardingLogoFiles | undefined,
    inviteCode: unknown,
    context: SessionRequestContext,
  ) {
    // Validate any logo files (extension, mimetype, size, magic bytes) as
    // the very first thing — before any database access at all — so a bad
    // file rejects the whole request with zero reads or writes, instead of
    // leaving a company (or even a wasted duplicate-email lookup) behind.
    if (files?.logo)
      this.companyBrandingService.assertValidLogoFile(files.logo);
    if (files?.secondaryLogo) {
      this.companyBrandingService.assertValidLogoFile(files.secondaryLogo);
    }

    if (typeof inviteCode !== 'string' || !inviteCode.trim()) {
      throw new BadRequestException('El código de invitación es requerido');
    }
    const codeHash = hashInvitationCode(normalizeInvitationCode(inviteCode));

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

    // ── Vertical y plantilla (Fase 1). Todo lo que llega del asistente son
    // SUGERENCIAS ya editadas por el usuario: aquí se valida el resultado
    // final contra los mismos límites e invariantes que usan las plantillas.
    const vertical = this.resolveVertical(dto.commercial);
    const stages = this.resolveStages(dto.pipeline);
    const commercial = {
      sellsProducts: dto.commercial.sellsProducts,
      sellsServices: dto.commercial.sellsServices,
      usesCatalog: dto.commercial.usesCatalog,
      usesQuotes: dto.commercial.usesQuotes,
      usesTasks: dto.commercial.usesTasks,
    };
    // Sin catálogo no hay categorías que guardar, se hayan enviado o no: el
    // paso de categorías no aplica y no debe dejar rastro.
    const settings = buildCompanySettingsV2({
      commercial,
      categories: commercial.usesCatalog
        ? normalizeCategories(dto.commercial.categories, { strict: true })
        : [],
      vertical,
      pipelineDefaults: {
        templateKey:
          dto.pipeline.templateKey?.trim() ||
          vertical?.businessType ||
          'custom',
        stagesTyped: Boolean(dto.pipeline.typedStages),
      },
    });
    // Tipo de negocio visible: lo que escribió el usuario o, si eligió una
    // plantilla y no escribió nada, el nombre de esa plantilla.
    const businessTypeLabel =
      dto.company.businessType?.trim() ||
      (vertical
        ? findBusinessType(vertical.industry, vertical.businessType)?.name
        : undefined);

    const result = await this.prisma.$transaction(async (tx) => {
      const invitation = await tx.invitationCode.findUnique({
        where: { codeHash },
      });

      if (!invitation) {
        this.logger.warn(
          'Intento de onboarding con código de invitación inválido',
        );
        throw new BadRequestException('Código de invitación inválido');
      }
      if (invitation.status === 'REVOKED') {
        this.logger.warn(
          `Intento de onboarding con código revocado (invitationId=${invitation.id})`,
        );
        throw new BadRequestException('Código de invitación revocado');
      }
      if (invitation.status === 'USED') {
        this.logger.warn(
          `Intento de onboarding con código ya utilizado (invitationId=${invitation.id})`,
        );
        throw new BadRequestException('Código de invitación ya utilizado');
      }
      const isExpired =
        invitation.status === 'EXPIRED' ||
        (invitation.expiresAt !== null &&
          invitation.expiresAt.getTime() <= Date.now());
      if (isExpired) {
        this.logger.warn(
          `Intento de onboarding con código vencido (invitationId=${invitation.id})`,
        );
        throw new BadRequestException('Código de invitación vencido');
      }

      // Atomic conditional claim: if a concurrent request already consumed,
      // revoked, or the code expired in the instant between the read above
      // and here, `count` comes back 0 and this whole transaction rolls
      // back — at most one of two simultaneous requests with the same code
      // can ever get past this point.
      const claim = await tx.invitationCode.updateMany({
        where: {
          id: invitation.id,
          status: 'ACTIVE',
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        data: { status: 'USED', usedAt: new Date() },
      });
      if (claim.count === 0) {
        this.logger.warn(
          `Código de invitación perdió la carrera de uso concurrente (invitationId=${invitation.id})`,
        );
        throw new BadRequestException('Código de invitación ya utilizado');
      }

      const company = await tx.company.create({
        data: {
          name: companyName,
          slug,
          businessType: businessTypeLabel || undefined,
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
          settings: settings as unknown as Prisma.InputJsonValue,
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

      // Part of this same transaction on purpose — see recordLoginSuccess's
      // `writer` param — so a failure anywhere later in onboarding (an
      // agent create, a pipeline stage, the invitation claim) rolls this
      // back too. There must never be a UserSession/LoginEvent "successful
      // login" row for a company that doesn't end up existing.
      const { sessionId, refreshToken } =
        await this.sessionsService.recordLoginSuccess(
          {
            user: {
              id: admin.id,
              email: admin.email,
              name: admin.name,
              role: admin.role,
              companyId: admin.companyId,
            },
            context,
          },
          tx,
        );

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

      // Etapas con tipo explícito y una sola etapa inicial (la primera OPEN),
      // para que la entrada automática de leads, las métricas y las
      // automatizaciones por cambio de etapa funcionen desde el primer día.
      const createdStages: Array<{
        id: string;
        name: string;
        order: number;
        type: string;
        isInitial: boolean;
      }> = [];
      let initialAssigned = false;
      for (let i = 0; i < stages.length; i++) {
        const isInitial = !initialAssigned && stages[i].type === 'OPEN';
        if (isInitial) initialAssigned = true;
        const stage = await tx.pipelineStage.create({
          data: {
            name: stages[i].name,
            order: i,
            type: stages[i].type,
            isInitial,
            pipelineId: pipeline.id,
          },
        });
        createdStages.push({ ...stage, type: stages[i].type, isInitial });
      }

      await tx.invitationCode.update({
        where: { id: invitation.id },
        data: { companyId: company.id, usedByUserId: admin.id },
      });

      // If this write fails, the transaction rolls back the invitation
      // consumption (and the company/admin) too — using a code must never
      // go unlogged.
      await this.auditLogService.record(tx, {
        actorUserId: admin.id,
        actorRole: 'ADMIN',
        affectedCompanyId: company.id,
        action: 'USE_INVITATION_CODE',
        entityType: 'InvitationCode',
        entityId: invitation.id,
        metadata: {
          invitationId: invitation.id,
          codePreview: invitation.codePreview,
          companyId: company.id,
          companyName: company.name,
        },
      });

      return {
        company,
        admin,
        createdAgents,
        pipeline,
        stages: createdStages,
        invitationId: invitation.id,
        sessionId,
        refreshToken,
      };
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
        await this.cleanupFailedCompany(
          result.company.id,
          result.pipeline.id,
          result.invitationId,
        );
        throw err;
      }
    }

    // Only mint a session once the company (and any logos) are fully and
    // successfully committed — never before, so a failed request can never
    // hand back a token for a company that doesn't actually exist. Agents
    // never reach this point at all, since only the admin created above is
    // ever passed in here. sessionId embeds the UserSession created inside
    // the transaction above, so this access token is immediately subject
    // to the same sid-based revocation as one from a real /auth/login.
    const session = this.authService.issueSession(
      result.admin,
      result.sessionId,
    );

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
        type: stage.type,
        isInitial: stage.isInitial,
      })),
      token: session.token,
      user: session.user,
      refreshToken: result.refreshToken,
    };
  }

  private async cleanupFailedCompany(
    companyId: string,
    pipelineId: string,
    invitationId: string,
  ): Promise<void> {
    try {
      await this.prisma.$transaction([
        this.prisma.pipelineStage.deleteMany({ where: { pipelineId } }),
        this.prisma.pipeline.delete({ where: { id: pipelineId } }),
        this.prisma.user.deleteMany({ where: { companyId } }),
        this.prisma.company.delete({ where: { id: companyId } }),
        // The onboarding attempt failed overall (logo upload, in this case)
        // — the invitation must not stay burned for a company that was
        // just deleted. Give it back its ACTIVE state so the same code can
        // be retried.
        this.prisma.invitationCode.update({
          where: { id: invitationId },
          data: {
            status: 'ACTIVE',
            usedAt: null,
            usedByUserId: null,
            companyId: null,
          },
        }),
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
      const uploadsDir = path.join(
        process.cwd(),
        'uploads',
        'branding',
        companyId,
      );
      fs.rmSync(uploadsDir, { recursive: true, force: true });
    }
  }

  // Valida la vertical elegida contra las plantillas versionadas. Ausente
  // (cliente antiguo) → sin vertical. Presente → industria y tipo deben
  // existir; el modelo comercial es el del usuario (editable) o el de la
  // plantilla.
  private resolveVertical(
    commercial: OnboardingCommercialDto,
  ): VerticalInfo | null {
    const { industry, businessType, businessModel } = commercial;
    if (!industry && !businessType && !businessModel) return null;
    if (!industry || !businessType) {
      throw new BadRequestException(
        'industry y businessType deben enviarse juntos',
      );
    }
    if (!findIndustry(industry)) {
      throw new BadRequestException('industry no es una industria conocida');
    }
    const template = findBusinessType(industry, businessType);
    if (!template) {
      throw new BadRequestException(
        'businessType no pertenece a la industria elegida',
      );
    }
    return {
      industry,
      businessType,
      businessModel: businessModel ?? template.businessModel,
      templateVersion: ONBOARDING_TEMPLATES_VERSION,
    };
  }

  // Etapas finales del pipeline. Con `typedStages` se exigen las invariantes
  // (≥1 OPEN, 1 WON, 1 LOST, sin duplicados). Con la forma anterior (solo
  // nombres) se conserva el comportamiento previo: todas OPEN.
  private resolveStages(pipeline: OnboardingPipelineDto): TypedStageInput[] {
    if (pipeline.typedStages && pipeline.typedStages.length > 0) {
      return validateTypedStages(
        pipeline.typedStages.map((s) => ({ name: s.name, type: s.type })),
      );
    }
    const names = (pipeline.stages ?? []).map((s) => s.trim()).filter(Boolean);
    if (names.length === 0) {
      throw new BadRequestException(
        'El pipeline debe tener al menos una etapa',
      );
    }
    return names.map((name) => ({ name, type: 'OPEN' as const }));
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
    while (
      await this.prisma.company.findUnique({ where: { slug: candidate } })
    ) {
      candidate = `${base}-${suffix}`;
      suffix++;
    }

    return candidate;
  }
}
