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

  // Resuelve la integracion con la que ENVIAR para una empresa.
  //
  // Con varios numeros, `findFirst` sin criterio devolveria una fila
  // arbitraria: el mensaje podria salir por el numero equivocado sin que nada
  // fallara. Por eso el desempate es explicito: primero la principal, luego el
  // orden declarado, y por ultimo la mas antigua como red de seguridad si
  // ninguna estuviera marcada.
  //
  // Se establece AHORA, mientras `companyId` sigue siendo unico y por tanto el
  // cambio no puede alterar el comportamiento observable. Cuando se retire el
  // UNIQUE, el criterio ya estara en su sitio y probado.
  async findConnectedByCompanyId(companyId: string) {
    if (!companyId?.trim()) return null;

    return this.prisma.whatsAppIntegration.findFirst({
      where: {
        companyId: companyId.trim(),
        status: 'CONNECTED',
      },
      orderBy: [{ isPrimary: 'desc' }, { order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  // Todas las integraciones conectadas de una empresa, para el selector de
  // numero remitente de la bandeja.
  async findAllConnectedByCompanyId(companyId: string) {
    if (!companyId?.trim()) return [];

    return this.prisma.whatsAppIntegration.findMany({
      where: { companyId: companyId.trim(), status: 'CONNECTED' },
      orderBy: [{ isPrimary: 'desc' }, { order: 'asc' }, { createdAt: 'asc' }],
      // Nunca el token: este listado alimenta la interfaz.
      select: {
        id: true,
        phoneNumberId: true,
        displayPhoneNumber: true,
        label: true,
        isPrimary: true,
        order: true,
        status: true,
      },
    });
  }

  // Resuelve un numero CONCRETO de la empresa, para cuando el asesor elige
  // explicitamente desde que numero responder. Acotado por companyId para que
  // un phoneNumberId de otro tenant nunca resuelva.
  async findConnectedByCompanyAndPhoneNumberId(
    companyId: string,
    phoneNumberId: string,
  ) {
    if (!companyId?.trim() || !phoneNumberId?.trim()) return null;

    return this.prisma.whatsAppIntegration.findFirst({
      where: {
        companyId: companyId.trim(),
        phoneNumberId: phoneNumberId.trim(),
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
