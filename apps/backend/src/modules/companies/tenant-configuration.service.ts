import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformAuditLogService } from '../platform/platform-audit-log.service';
import {
  buildCompanySettingsV2,
  normalizeCategories,
  parseCompanySettings,
  toPublicSettings,
  type CommercialFlags,
  type NormalizedCompanySettings,
} from './company-settings';
import {
  buildTenantConfiguration,
  normalizeRegionalPatch,
  type CompanyConfigurationRow,
  type NormalizedRegionalPatch,
  type RegionalPatchInput,
  type TenantConfigurationV1,
  type TenantPipeline,
} from './tenant-configuration';
import { UpdateCompanySettingsDto } from './dto/update-company-settings.dto';
import {
  moduleDependencyViolation,
  resolveEffectiveCapabilities,
  resolveEffectiveCommercial,
  type TenantCapabilities,
} from './tenant-capabilities';

export const TENANT_CONFIGURATION_AUDIT_ACTION = 'company.configuration.update';

/**
 * Vida de la caché de capacidades por empresa. Corta a propósito: el guard
 * de módulo consulta en cada petición y con esto una ráfaga de peticiones
 * cuesta una lectura; la escritura invalida en el acto dentro del proceso.
 */
export const CAPABILITIES_CACHE_TTL_MS = 5_000;

/** Forma interna del parche, común a los dos endpoints. */
export interface TenantConfigurationPatch {
  regional?: RegionalPatchInput;
  commercial?: { sellsProducts?: boolean; sellsServices?: boolean };
  modules?: { catalog?: boolean; quotes?: boolean; tasks?: boolean };
  catalog?: { categories: string[] };
}

export interface ConfigurationActor {
  userId: string;
  role: Role;
}

type Tx = Prisma.TransactionClient;
type Reader = Pick<PrismaService, 'company' | 'pipeline'>;

const COMPANY_SELECT = {
  country: true,
  timezone: true,
  currency: true,
  locale: true,
  businessType: true,
  settings: true,
} as const;

/**
 * MOTOR ÚNICO de configuración por empresa.
 *
 * Lee componiendo columnas + JSON + pipeline relacional, y escribe SIEMPRE
 * dentro de una transacción que bloquea la fila de la empresa
 * (`SELECT … FOR UPDATE`): la actualización de settings era leer-fusionar-
 * escribir sin transacción, y dos PATCH simultáneos —uno de región, otro de
 * categorías— perdían el primero. Con el bloqueo, el segundo espera y fusiona
 * sobre lo que el primero dejó.
 *
 * `GET` nunca escribe: una empresa con settings v1 (o sin settings) sigue así
 * hasta que un administrador edita algo de esa sección. Cambiar solo la
 * región tampoco reescribe el JSON.
 */
@Injectable()
export class TenantConfigurationService {
  private readonly capabilitiesCache = new Map<
    string,
    { expiresAt: number; value: TenantCapabilities }
  >();

  constructor(
    private prisma: PrismaService,
    private auditLog: PlatformAuditLogService,
  ) {}

  /**
   * Capacidades efectivas de UNA empresa, para guards y validaciones del
   * dominio (tipo de catálogo permitido, búsqueda). Lee solo `settings` y
   * cachea por `companyId` durante `CAPABILITIES_CACHE_TTL_MS`; la caché está
   * aislada por clave y no puede servir la configuración de otra empresa.
   * Una empresa inexistente responde 404 (sin cachear).
   */
  async resolveCapabilities(
    companyId: string,
    now = Date.now(),
  ): Promise<TenantCapabilities> {
    const hit = this.capabilitiesCache.get(companyId);
    if (hit && hit.expiresAt > now) return hit.value;
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { settings: true },
    });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    const value = resolveEffectiveCapabilities(
      parseCompanySettings(company.settings),
    );
    this.capabilitiesCache.set(companyId, {
      expiresAt: now + CAPABILITIES_CACHE_TTL_MS,
      value,
    });
    return value;
  }

  /** Olvida la caché de una empresa (tras escribir su configuración). */
  invalidateCapabilities(companyId: string): void {
    this.capabilitiesCache.delete(companyId);
  }

  async get(companyId: string): Promise<TenantConfigurationV1> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: COMPANY_SELECT,
    });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    const pipeline = await this.findPipeline(this.prisma, companyId);
    return buildTenantConfiguration({
      company,
      settings: parseCompanySettings(company.settings),
      pipeline,
    });
  }

  /** Vista histórica de `GET /companies/me/settings`. Solo lectura. */
  async getLegacySettings(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { settings: true },
    });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    return toPublicSettings(parseCompanySettings(company.settings));
  }

  async update(
    companyId: string,
    patch: TenantConfigurationPatch,
    actor: ConfigurationActor,
  ): Promise<TenantConfigurationV1> {
    const result = await this.apply(companyId, patch, actor);
    return result.configuration;
  }

  /**
   * `PATCH /companies/me/settings` (histórico) traducido al parche común:
   * mismas reglas, misma transacción, misma auditoría. Devuelve la vista que
   * ese endpoint siempre devolvió.
   */
  async updateLegacySettings(
    companyId: string,
    dto: UpdateCompanySettingsDto,
    actor: ConfigurationActor,
  ) {
    const patch: TenantConfigurationPatch = {};
    if (dto.commercial) {
      const c = dto.commercial;
      if (c.sellsProducts !== undefined || c.sellsServices !== undefined) {
        patch.commercial = {
          ...(c.sellsProducts !== undefined && {
            sellsProducts: c.sellsProducts,
          }),
          ...(c.sellsServices !== undefined && {
            sellsServices: c.sellsServices,
          }),
        };
      }
      if (
        c.usesCatalog !== undefined ||
        c.usesQuotes !== undefined ||
        c.usesTasks !== undefined
      ) {
        patch.modules = {
          ...(c.usesCatalog !== undefined && { catalog: c.usesCatalog }),
          ...(c.usesQuotes !== undefined && { quotes: c.usesQuotes }),
          ...(c.usesTasks !== undefined && { tasks: c.usesTasks }),
        };
      }
    }
    if (dto.catalog?.categories !== undefined) {
      patch.catalog = { categories: dto.catalog.categories };
    }
    const result = await this.apply(companyId, patch, actor);
    return toPublicSettings(result.settings);
  }

  // ── núcleo ─────────────────────────────────────────────────────────────

  private async apply(
    companyId: string,
    patch: TenantConfigurationPatch,
    actor: ConfigurationActor,
  ): Promise<{
    configuration: TenantConfigurationV1;
    settings: NormalizedCompanySettings;
  }> {
    try {
      return await this.applyInTransaction(companyId, patch, actor);
    } finally {
      // Haya ido bien o mal, la siguiente lectura vuelve a la base.
      this.invalidateCapabilities(companyId);
    }
  }

  private async applyInTransaction(
    companyId: string,
    patch: TenantConfigurationPatch,
    actor: ConfigurationActor,
  ): Promise<{
    configuration: TenantConfigurationV1;
    settings: NormalizedCompanySettings;
  }> {
    // Todo lo que se pueda rechazar sin mirar la base se rechaza AQUÍ, antes
    // de abrir la transacción y tomar el bloqueo.
    const regional = normalizeRegionalPatch(patch.regional);
    const categories =
      patch.catalog?.categories !== undefined
        ? normalizeCategories(patch.catalog.categories, { strict: true })
        : undefined;
    const commercialPatch = definedOnly(patch.commercial ?? {});
    const modulesPatch = definedOnly(patch.modules ?? {});

    const sections = sectionsOf({
      regional,
      commercial: commercialPatch,
      modules: modulesPatch,
      categories,
    });

    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "companies" WHERE "id" = ${companyId} FOR UPDATE
      `;
      if (locked.length === 0) {
        throw new NotFoundException('Empresa no encontrada');
      }
      const company = await tx.company.findUnique({
        where: { id: companyId },
        select: COMPANY_SELECT,
      });
      if (!company) throw new NotFoundException('Empresa no encontrada');

      const current = parseCompanySettings(company.settings);

      if (sections.length === 0) {
        // Nada que escribir: ni auditoría ni conversión v1 → v2.
        return {
          configuration: buildTenantConfiguration({
            company,
            settings: current,
            pipeline: await this.findPipeline(tx, companyId),
          }),
          settings: current,
        };
      }

      const data: Prisma.CompanyUpdateInput = {};
      let nextSettings = current;

      if (sections.includes('regional')) {
        if (regional.country !== undefined) data.country = regional.country;
        if (regional.timezone !== undefined) data.timezone = regional.timezone;
        if (regional.currency !== undefined) data.currency = regional.currency;
        if (regional.locale !== undefined) data.locale = regional.locale;
      }

      const touchesSettings =
        sections.includes('commercial') ||
        sections.includes('modules') ||
        sections.includes('catalog');

      if (touchesSettings) {
        // Se fusiona sobre las banderas EFECTIVAS, no sobre las normalizadas:
        // en una empresa legacy (sin bandera guardada) el default normalizado
        // es `false`, y desactivar un módulo habría apagado en silencio los
        // otros dos al escribir el JSON v2 completo.
        const commercial: CommercialFlags = {
          ...resolveEffectiveCommercial(current),
          ...commercialPatch,
          ...(modulesPatch.catalog !== undefined && {
            usesCatalog: modulesPatch.catalog,
          }),
          ...(modulesPatch.quotes !== undefined && {
            usesQuotes: modulesPatch.quotes,
          }),
          ...(modulesPatch.tasks !== undefined && {
            usesTasks: modulesPatch.tasks,
          }),
        };
        // Una lectura legacy con ambas banderas en falso funciona; una EDICIÓN
        // explícita del modelo comercial no puede dejarlas así.
        if (
          sections.includes('commercial') &&
          !commercial.sellsProducts &&
          !commercial.sellsServices
        ) {
          throw new BadRequestException(
            'La empresa debe vender productos, servicios o ambos: activa al menos uno',
          );
        }
        // Dependencias duras entre módulos, sobre el conjunto ya fusionado.
        const violation = moduleDependencyViolation({
          catalog: commercial.usesCatalog,
          quotes: commercial.usesQuotes,
          tasks: commercial.usesTasks,
        });
        if (violation) throw new BadRequestException(violation);
        const built = buildCompanySettingsV2({
          commercial,
          categories: categories ?? current.catalog.categories,
          vertical: current.vertical,
          pipelineDefaults: current.pipelineDefaults,
          extra: current.extra,
        });
        data.settings = built as unknown as Prisma.InputJsonValue;
        nextSettings = parseCompanySettings(built);
      }

      const updated = await tx.company.update({
        where: { id: companyId },
        data,
        select: COMPANY_SELECT,
      });

      await this.auditLog.record(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        affectedCompanyId: companyId,
        action: TENANT_CONFIGURATION_AUDIT_ACTION,
        entityType: 'Company',
        entityId: companyId,
        // Qué se tocó, no con qué valores: la auditoría dice quién y qué
        // sección; los valores están en la propia empresa.
        metadata: {
          contractVersion: 1,
          sections,
          fields: fieldsOf({
            regional,
            commercial: commercialPatch,
            modules: modulesPatch,
            categories,
          }),
          storageVersion: {
            before: current.storedVersion,
            after: nextSettings.storedVersion,
          },
        },
      });

      return {
        configuration: buildTenantConfiguration({
          company: updated,
          settings: nextSettings,
          pipeline: await this.findPipeline(tx, companyId),
        }),
        settings: nextSettings,
      };
    });
  }

  /**
   * Pipeline efectivo de la empresa, SIEMPRE filtrado por `companyId`:
   * el marcado `isDefault` no archivado; si una empresa legacy no tiene uno,
   * el primero no archivado por `order`, `createdAt`, `id` (determinista);
   * si no hay ninguno, `null`. Nunca escribe ni marca nada.
   */
  private async findPipeline(
    reader: Reader | Tx,
    companyId: string,
  ): Promise<TenantPipeline | null> {
    const row = await reader.pipeline.findFirst({
      where: { companyId, isArchived: false },
      orderBy: [
        { isDefault: 'desc' },
        { order: 'asc' },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
      select: {
        id: true,
        name: true,
        stages: {
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            name: true,
            type: true,
            isInitial: true,
            order: true,
          },
        },
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      stages: row.stages.map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        isInitial: s.isInitial,
        order: s.order,
      })),
    };
  }
}

// ── utilidades ───────────────────────────────────────────────────────────

function definedOnly<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

type Section = 'regional' | 'commercial' | 'modules' | 'catalog';

function sectionsOf(input: {
  regional: NormalizedRegionalPatch;
  commercial: object;
  modules: object;
  categories: string[] | undefined;
}): Section[] {
  const out: Section[] = [];
  if (Object.keys(input.regional).length > 0) out.push('regional');
  if (Object.keys(input.commercial).length > 0) out.push('commercial');
  if (Object.keys(input.modules).length > 0) out.push('modules');
  if (input.categories !== undefined) out.push('catalog');
  return out;
}

function fieldsOf(input: {
  regional: NormalizedRegionalPatch;
  commercial: object;
  modules: object;
  categories: string[] | undefined;
}): string[] {
  return [
    ...Object.keys(input.regional).map((k) => `regional.${k}`),
    ...Object.keys(input.commercial).map((k) => `commercial.${k}`),
    ...Object.keys(input.modules).map((k) => `modules.${k}`),
    ...(input.categories !== undefined ? ['catalog.categories'] : []),
  ];
}

export type { CompanyConfigurationRow };
