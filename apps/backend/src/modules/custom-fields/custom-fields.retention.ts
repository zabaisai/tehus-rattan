import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { shouldConsumeQueue } from '../../common/queue/queue.role';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomFieldsService } from './custom-fields.service';

/**
 * Barrido de retención del historial de campos personalizados.
 *
 * CORRE SOLO EN EL WORKER, a diferencia del despachador del outbox. Aquí no
 * hay nada que recuperar si el worker está caído: el historial viejo sigue
 * ahí y se limpiará mañana. Ejecutarlo también en el backend solo duplicaría
 * el trabajo mientras alguien usa el producto.
 *
 * DE MADRUGADA y no cada hora: borrar filas viejas no es urgente, y hacerlo
 * cuando nadie trabaja evita competir por la tabla con las escrituras de los
 * bots.
 */
@Injectable()
export class CustomFieldsRetentionService {
  private readonly logger = new Logger(CustomFieldsRetentionService.name);
  private corriendo = false;

  private ultimoPaseEn: Date | null = null;
  private borradosTotales = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly campos: CustomFieldsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async pasar(): Promise<void> {
    if (this.corriendo || !shouldConsumeQueue()) return;

    this.corriendo = true;
    try {
      const resumen = await this.compactarTodo();
      if (resumen.borrados > 0) {
        this.logger.log(
          `Retención de historial: ${resumen.borrados} filas en ${resumen.empresas} empresas`,
        );
      }
    } catch (error) {
      // Un fallo aquí no puede tumbar el worker: lo viejo sigue viejo y el
      // pase de mañana lo volverá a intentar.
      this.logger.warn(
        `Pase de retención fallido [${
          error instanceof Error ? error.name : 'Error'
        }]`,
      );
    } finally {
      this.corriendo = false;
    }
  }

  /**
   * Compacta empresa por empresa.
   *
   * POR EMPRESA Y NO GLOBAL para que una empresa con millones de filas no
   * retrase indefinidamente la limpieza de las demás, y para que el aislamiento
   * multiempresa siga siendo cierto también aquí: cada borrado lleva su
   * `companyId` en el `where`.
   *
   * Público para poder forzarlo desde el endpoint de operación.
   */
  async compactarTodo(
    opciones: { lotesPorEmpresa?: number } = {},
  ): Promise<{ borrados: number; empresas: number }> {
    const empresas = await this.prisma.company.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true },
    });

    const maxLotes = opciones.lotesPorEmpresa ?? 5;
    let borrados = 0;
    let tocadas = 0;

    for (const empresa of empresas) {
      let borradosAqui = 0;
      // Varios lotes por pase, con tope: una empresa con años de historial se
      // limpia en varias noches en vez de en una transacción interminable.
      for (let i = 0; i < maxLotes; i += 1) {
        const r = await this.campos.compactarHistorial(empresa.id);
        borradosAqui += r.borrados;
        if (r.borrados === 0) break;
      }
      if (borradosAqui > 0) {
        borrados += borradosAqui;
        tocadas += 1;
      }
    }

    this.ultimoPaseEn = new Date();
    this.borradosTotales += borrados;
    return { borrados, empresas: tocadas };
  }

  /** Para el health. Sin PII: solo cuántos y cuándo. */
  estado(): {
    ultimoPaseEn: string | null;
    borradosTotales: number;
    diasConfigurados: number;
  } {
    return {
      ultimoPaseEn: this.ultimoPaseEn?.toISOString() ?? null,
      borradosTotales: this.borradosTotales,
      diasConfigurados: Number(process.env.CUSTOM_FIELD_HISTORY_DAYS ?? 90),
    };
  }
}
