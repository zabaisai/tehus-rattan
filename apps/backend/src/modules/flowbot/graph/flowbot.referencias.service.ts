import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ReferenciasEmpresa, referenciasVacias } from './flowbot.validator';

/**
 * Resuelve, para UNA empresa, todo lo que el validador necesita comprobar.
 *
 * EXISTE PARA QUE EL VALIDADOR SIGA SIENDO PURO. Recibe conjuntos de
 * identificadores y responde; no conoce Prisma. Así el mismo validador corre
 * en el simulador, en la publicación y —el día que exista— en el navegador,
 * sin arrastrar la base de datos detrás.
 *
 * TODO SE CONSULTA ACOTADO POR EMPRESA. Si el validador aceptara un
 * `stageId` de otra empresa, un flujo publicado movería oportunidades al
 * tablero de un tercero.
 */
@Injectable()
export class FlowBotReferenciasService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Las claves de campo personalizado que existen.
   *
   * Separadas de `ReferenciasEmpresa` porque el validador todavia no las
   * comprueba: hacerlo obligaria a que un flujo exportado de otra empresa
   * dejara de validar por campos que si podrian crearse. El editor SI las usa
   * para ofrecer lo que existe en vez de dejar escribir cualquier clave.
   */
  async clavesDeCampo(companyId: string): Promise<string[]> {
    const campos = await this.prisma.customFieldDefinition.findMany({
      where: { companyId, isActive: true },
      select: { key: true },
      orderBy: { key: 'asc' },
    });
    return campos.map((c) => c.key);
  }

  async paraEmpresa(companyId: string): Promise<ReferenciasEmpresa> {
    const [pipelines, etapas, usuarios, numeros, credenciales, config] =
      await Promise.all([
        this.prisma.pipeline.findMany({
          where: { companyId, isArchived: false },
          select: { id: true },
        }),
        this.prisma.pipelineStage.findMany({
          where: { pipeline: { companyId } },
          select: { id: true },
        }),
        this.prisma.user.findMany({
          where: { companyId, isActive: true },
          select: { id: true },
        }),
        this.prisma.whatsAppIntegration.findMany({
          where: { companyId, status: 'CONNECTED' },
          select: { id: true },
        }),
        this.prisma.flowBotCredential.findMany({
          where: { companyId },
          select: { id: true },
        }),
        this.prisma.flowBotSettings.findUnique({
          where: { companyId },
          select: {
            httpEnabled: true,
            httpAllowedHosts: true,
            aiEnabled: true,
            aiProvider: true,
            aiApiKeyEncrypted: true,
          },
        }),
      ]);

    const base = referenciasVacias();
    return {
      ...base,
      pipelineIds: new Set(pipelines.map((p) => p.id)),
      stageIds: new Set(etapas.map((e) => e.id)),
      userIds: new Set(usuarios.map((u) => u.id)),
      whatsappIntegrationIds: new Set(numeros.map((n) => n.id)),
      credentialIds: new Set(credenciales.map((c) => c.id)),
      // Los nombres de plantilla no se pueden comprobar sin llamar a Meta, y
      // llamar a Meta al validar convertiría el editor en algo lento y
      // dependiente de que su API responda. Se deja vacío a propósito: el
      // validador solo avisa cuando el conjunto trae algo.
      templateNames: base.templateNames,
      // Las dos cosas, no una: encender HTTP sin destinos lo deja igualmente
      // inservible, porque una lista vacía no significa «todos».
      httpConfigurado: Boolean(
        config?.httpEnabled && (config.httpAllowedHosts?.length ?? 0) > 0,
      ),
      // Las tres: encendida, proveedor nombrado y credencial guardada.
      iaConfigurada: Boolean(
        config?.aiEnabled && config.aiProvider && config.aiApiKeyEncrypted,
      ),
    };
  }
}
