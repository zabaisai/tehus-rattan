import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsAppTokenCryptoService } from './whatsapp-token-crypto.service';

interface ConnectWhatsAppIntegrationInput {
  phoneNumberId: string;
  accessToken: string;
  displayPhoneNumber?: string;
  wabaId?: string;
}

@Injectable()
export class WhatsAppIntegrationManagementService {
  constructor(
    private prisma: PrismaService,
    private tokenCryptoService: WhatsAppTokenCryptoService,
  ) {}

  async getForCompany(companyId: string) {
    const trimmedCompanyId = this.requireNonBlank(
      companyId,
      'companyId no puede estar vacio',
    );

    const integration = await this.prisma.whatsAppIntegration.findUnique({
      where: { companyId: trimmedCompanyId },
    });

    if (!integration) return null;

    return this.toSafeResponse(integration);
  }

  async connectOrUpdateForCompany(
    companyId: string,
    input: ConnectWhatsAppIntegrationInput,
  ) {
    const trimmedCompanyId = this.requireNonBlank(
      companyId,
      'companyId no puede estar vacio',
    );
    const phoneNumberId = this.requireNonBlank(
      input.phoneNumberId,
      'phoneNumberId no puede estar vacio',
    );
    const accessToken = this.requireNonBlank(
      input.accessToken,
      'accessToken no puede estar vacio',
    );
    const displayPhoneNumber = input.displayPhoneNumber?.trim() || undefined;
    const wabaId = input.wabaId?.trim() || undefined;

    const existingOwner = await this.prisma.whatsAppIntegration.findUnique({
      where: { phoneNumberId },
      select: { companyId: true },
    });

    if (existingOwner && existingOwner.companyId !== trimmedCompanyId) {
      throw new ConflictException(
        'Este phoneNumberId ya está conectado a otra empresa',
      );
    }

    const accessTokenEncrypted = this.tokenCryptoService.encrypt(accessToken);
    const connectedAt = new Date();

    const integration = await this.prisma.whatsAppIntegration.upsert({
      where: { companyId: trimmedCompanyId },
      create: {
        companyId: trimmedCompanyId,
        phoneNumberId,
        displayPhoneNumber,
        wabaId,
        accessTokenEncrypted,
        status: 'CONNECTED',
        connectedAt,
        disconnectedAt: null,
      },
      update: {
        phoneNumberId,
        displayPhoneNumber,
        wabaId,
        accessTokenEncrypted,
        status: 'CONNECTED',
        connectedAt,
        disconnectedAt: null,
      },
    });

    return this.toSafeResponse(integration);
  }

  async disconnectForCompany(companyId: string) {
    const trimmedCompanyId = this.requireNonBlank(
      companyId,
      'companyId no puede estar vacio',
    );

    const integration = await this.prisma.whatsAppIntegration.findUnique({
      where: { companyId: trimmedCompanyId },
    });

    if (!integration) {
      throw new NotFoundException('WhatsApp no conectado para esta empresa');
    }

    const updated = await this.prisma.whatsAppIntegration.update({
      where: { companyId: trimmedCompanyId },
      data: {
        status: 'DISCONNECTED',
        disconnectedAt: new Date(),
      },
    });

    return this.toSafeResponse(updated);
  }

  private requireNonBlank(value: string | undefined, message: string): string {
    if (!value?.trim()) {
      throw new BadRequestException(message);
    }
    return value.trim();
  }

  private toSafeResponse(integration: {
    id: string;
    companyId: string;
    displayPhoneNumber: string | null;
    phoneNumberId: string;
    wabaId: string | null;
    status: string;
    connectedAt: Date | null;
    disconnectedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: integration.id,
      companyId: integration.companyId,
      displayPhoneNumber: integration.displayPhoneNumber,
      phoneNumberId: integration.phoneNumberId,
      wabaId: integration.wabaId,
      status: integration.status,
      connectedAt: integration.connectedAt,
      disconnectedAt: integration.disconnectedAt,
      createdAt: integration.createdAt,
      updatedAt: integration.updatedAt,
    };
  }
}
