import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  assertParsableSettings,
  buildCompanySettingsV2,
  normalizeCategories,
  parseCompanySettings,
  toPublicSettings,
} from './company-settings';
import { UpdateCompanySettingsDto } from './dto/update-company-settings.dto';

@Injectable()
export class CompaniesService {
  constructor(private prisma: PrismaService) {}

  async findById(id: string) {
    return this.prisma.company.findUnique({ where: { id } });
  }

  async update(
    id: string,
    data: {
      name?: string;
      phone?: string;
      businessType?: string;
      city?: string;
      country?: string;
      email?: string;
      website?: string;
      description?: string;
      primaryColor?: string;
      accentColor?: string;
      backgroundColor?: string;
      settings?: Prisma.InputJsonValue;
      // Nullable so the settings form can clear a fiscal field (sets the
      // column back to NULL) rather than only ever setting a new value.
      legalName?: string | null;
      taxId?: string | null;
      address?: string | null;
      quoteFooter?: string | null;
    },
  ) {
    // A whole-object `settings` write must at least be a recognizable v1/v2
    // shape with valid categories — never arbitrary JSON that the rest of
    // the app then fails to read.
    if (data.settings !== undefined) assertParsableSettings(data.settings);
    try {
      return await this.prisma.company.update({ where: { id }, data });
    } catch (error) {
      // Company.phone is unique — surface the real cause instead of an
      // opaque 500, matching how WhatsAppIntegrationManagementService
      // handles the equivalent phoneNumberId collision.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'El teléfono ya está registrado para otra empresa',
        );
      }
      throw error;
    }
  }

  /**
   * Vista normalizada de `Company.settings` (v1 o v2) para la empresa del
   * usuario autenticado. Solo lee: una empresa con settings v1 sigue teniendo
   * settings v1 hasta que alguien los edite explícitamente.
   */
  async getSettings(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { settings: true },
    });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    return toPublicSettings(parseCompanySettings(company.settings));
  }

  /**
   * Edición parcial y tipada (categorías del catálogo y banderas
   * comerciales). Lee lo que hay, fusiona y escribe la forma v2 conservando
   * las claves desconocidas y el `vertical` de origen. Es la única vía por la
   * que unos settings v1 pasan a v2, y solo por decisión explícita de un
   * administrador de esa empresa.
   */
  async updateSettings(companyId: string, patch: UpdateCompanySettingsDto) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { settings: true },
    });
    if (!company) throw new NotFoundException('Empresa no encontrada');

    const current = parseCompanySettings(company.settings);
    const categories =
      patch.catalog?.categories !== undefined
        ? normalizeCategories(patch.catalog.categories, { strict: true })
        : current.catalog.categories;
    const next = buildCompanySettingsV2({
      commercial: { ...current.commercial, ...(patch.commercial ?? {}) },
      categories,
      vertical: current.vertical,
      pipelineDefaults: current.pipelineDefaults,
      extra: current.extra,
    });

    const updated = await this.prisma.company.update({
      where: { id: companyId },
      data: { settings: next as unknown as Prisma.InputJsonValue },
      select: { settings: true },
    });
    return toPublicSettings(parseCompanySettings(updated.settings));
  }
}
