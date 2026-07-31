import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformAuditLogService } from '../platform/platform-audit-log.service';

export interface ActorNumeros {
  userId: string;
  role: string;
}

/** Lo que la interfaz necesita. NUNCA el token. */
const CAMPOS_SEGUROS = {
  id: true,
  phoneNumberId: true,
  displayPhoneNumber: true,
  label: true,
  isPrimary: true,
  order: true,
  status: true,
  connectedAt: true,
  lastErrorCode: true,
} as const;

const MAX_ETIQUETA = 40;

/**
 * Los números de WhatsApp de una empresa.
 *
 * LA BASE SOPORTABA VARIOS DESDE HACE TIEMPO Y NO HABÍA FORMA DE VERLOS. El
 * esquema quitó el UNIQUE sobre `companyId`, dejó un índice parcial para que
 * solo hubiera un principal, y todas las consultas ordenaban por `isPrimary`…
 * pero ningún endpoint listaba los números ni permitía decir cuál era el
 * principal. En la práctica: se podían conectar varios, se recibía por todos,
 * y la empresa no podía ni verlos ni elegir desde cuál se responde por
 * defecto.
 */
@Injectable()
export class WhatsAppNumbersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditLogService,
  ) {}

  async listar(companyId: string) {
    return this.prisma.whatsAppIntegration.findMany({
      where: { companyId },
      orderBy: [{ isPrimary: 'desc' }, { order: 'asc' }, { createdAt: 'asc' }],
      select: CAMPOS_SEGUROS,
    });
  }

  /**
   * La etiqueta es lo que hace usable tener varios: nadie reconoce un
   * `phoneNumberId` de 16 dígitos, y sin nombre la lista es indistinguible.
   */
  async renombrar(companyId: string, id: string, etiqueta: string | null) {
    const numero = await this.buscar(companyId, id);

    const limpia = etiqueta?.trim() || null;
    if (limpia && limpia.length > MAX_ETIQUETA) {
      throw new BadRequestException(
        `La etiqueta no puede pasar de ${MAX_ETIQUETA} caracteres.`,
      );
    }

    return this.prisma.whatsAppIntegration.update({
      where: { id: numero.id },
      data: { label: limpia },
      select: CAMPOS_SEGUROS,
    });
  }

  /**
   * Marca el principal.
   *
   * En UNA transacción, y quitando primero el anterior: el índice parcial
   * `whatsapp_one_primary_per_company` rechaza dos principales, así que
   * hacerlo en dos pasos sueltos fallaría a mitad y dejaría a la empresa sin
   * ninguno —y sin principal, el envío vuelve a elegir una fila cualquiera.
   */
  async marcarPrincipal(companyId: string, id: string, actor: ActorNumeros) {
    const numero = await this.buscar(companyId, id);

    if (numero.status !== 'CONNECTED') {
      throw new BadRequestException(
        'Solo un número conectado puede ser el principal: desde uno desconectado no se puede enviar.',
      );
    }

    if (numero.isPrimary) return this.conCamposSeguros(numero.id);

    await this.prisma.$transaction(async (tx) => {
      await tx.whatsAppIntegration.updateMany({
        where: { companyId, isPrimary: true },
        data: { isPrimary: false },
      });
      await tx.whatsAppIntegration.update({
        where: { id: numero.id },
        data: { isPrimary: true },
      });
    });

    await this.audit.record(this.prisma, {
      actorUserId: actor.userId,
      actorRole: actor.role as never,
      affectedCompanyId: companyId,
      action: 'WHATSAPP_PRIMARY_NUMBER_CHANGED',
      entityType: 'WhatsAppIntegration',
      entityId: numero.id,
      // El phoneNumberId no es un secreto, pero el número visible sí es un
      // dato de la empresa: basta con el identificador interno.
      metadata: { phoneNumberId: numero.phoneNumberId },
    });

    return this.conCamposSeguros(numero.id);
  }

  private async buscar(companyId: string, id: string) {
    // Acotado por companyId: sin esto, un id de otro tenant se podría
    // renombrar o marcar como principal desde esta empresa.
    const numero = await this.prisma.whatsAppIntegration.findFirst({
      where: { id, companyId },
    });
    if (!numero) throw new NotFoundException('Número no encontrado');
    return numero;
  }

  private conCamposSeguros(id: string) {
    return this.prisma.whatsAppIntegration.findUniqueOrThrow({
      where: { id },
      select: CAMPOS_SEGUROS,
    });
  }
}
