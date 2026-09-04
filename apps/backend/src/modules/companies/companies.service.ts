import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

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
      // Nullable so the settings form can clear a fiscal field (sets the
      // column back to NULL) rather than only ever setting a new value.
      legalName?: string | null;
      taxId?: string | null;
      address?: string | null;
      quoteFooter?: string | null;
    },
  ) {
    // `settings` is deliberately not accepted here: the tolerant reader
    // (parseCompanySettings) exists to read historical data, not to validate
    // a whole-object write. Commercial settings change only through
    // updateSettings() with the typed DTO.
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

  // La configuración (settings, región, módulos, categorías) vive en
  // TenantConfigurationService: un solo motor con transacción, bloqueo de
  // fila y auditoría. Este servicio queda para el perfil de la empresa.
}
