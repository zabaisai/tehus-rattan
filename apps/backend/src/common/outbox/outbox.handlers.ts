import { Injectable, Logger } from '@nestjs/common';

/**
 * Registro de manejadores del outbox.
 *
 * POR QUÉ EXISTE: el despachador vive en `common/` y FlowBot en `modules/`.
 * Si el despachador importara FlowBot, la capa común pasaría a depender de un
 * módulo de negocio y cada tipo de evento nuevo obligaría a tocarla. Con el
 * registro, cada módulo declara qué sabe publicar y el despachador solo busca.
 *
 * Un tipo SIN manejador sigue marcándose como fallido, no ignorado: un evento
 * que nadie publica y que además desaparece del radar es exactamente cómo se
 * pierde trabajo sin que nadie se entere.
 */

/**
 * Publica el evento en su cola. Devuelve `false` si no se pudo —Redis caído,
 * por ejemplo— para que el despachador lo deje pendiente y lo reintente.
 *
 * NO debe marcar el outbox: de eso se encarga el despachador, y solo después
 * de que esto confirme.
 */
export type ManejadorOutbox = (evento: {
  id: string;
  type: string;
  companyId: string;
  payload: unknown;
  attempts: number;
}) => Promise<boolean>;

@Injectable()
export class OutboxHandlerRegistry {
  private readonly logger = new Logger(OutboxHandlerRegistry.name);
  private readonly manejadores = new Map<string, ManejadorOutbox>();

  /**
   * Registra quién publica un tipo.
   *
   * Registrar dos veces el mismo tipo es un error de programación, no una
   * situación normal: significa que dos módulos creen ser dueños del mismo
   * evento y el ganador dependería del orden de arranque.
   */
  registrar(type: string, manejador: ManejadorOutbox): void {
    if (this.manejadores.has(type)) {
      throw new Error(`ManejadorDuplicadoParaTipo:${type}`);
    }
    this.manejadores.set(type, manejador);
    this.logger.log(`Manejador de outbox registrado para "${type}"`);
  }

  obtener(type: string): ManejadorOutbox | null {
    return this.manejadores.get(type) ?? null;
  }

  /** Tipos conocidos, para el health y el diagnóstico. */
  tiposRegistrados(): string[] {
    return [...this.manejadores.keys()].sort();
  }
}
