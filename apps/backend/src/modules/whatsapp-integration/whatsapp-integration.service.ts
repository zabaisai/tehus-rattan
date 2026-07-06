import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class WhatsAppIntegrationService {
  constructor(private prisma: PrismaService) {}

  async findConnectedByPhoneNumberId(phoneNumberId: string) {
    if (!phoneNumberId?.trim()) return null;

    return this.prisma.whatsAppIntegration.findFirst({
      where: {
        phoneNumberId: phoneNumberId.trim(),
        status: 'CONNECTED',
      },
      select: {
        id: true,
        companyId: true,
        phoneNumberId: true,
        displayPhoneNumber: true,
        wabaId: true,
        status: true,
      },
    });
  }

  async findConnectedByCompanyId(companyId: string) {
    if (!companyId?.trim()) return null;

    return this.prisma.whatsAppIntegration.findFirst({
      where: {
        companyId: companyId.trim(),
        status: 'CONNECTED',
      },
    });
  }

  async assertConnectedByCompanyId(companyId: string) {
    const integration = await this.findConnectedByCompanyId(companyId);

    if (!integration) {
      throw new NotFoundException('WhatsApp no conectado para esta empresa');
    }

    return integration;
  }
}
