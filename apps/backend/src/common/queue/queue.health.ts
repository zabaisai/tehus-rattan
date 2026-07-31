import { Injectable, Logger } from '@nestjs/common';
import { buildRedisConnection } from './queue.config';

export type QueueHealthState = 'up' | 'down' | 'disabled';

export interface QueueHealth {
  state: QueueHealthState;
  /** Latencia del PING en ms. Ausente si no se pudo medir. */
  latencyMs?: number;
  /** Clasificador de error ya redactado; nunca la cadena de conexión. */
  reason?: string;
}

/**
 * Salud de la cola, para `/api/health/ready`.
 *
 * REGLA DE DISEÑO: que Redis esté caído NO debe tumbar la API.
 *
 * El CRM tiene que seguir sirviendo conversaciones, pipelines y cotizaciones
 * aunque el procesamiento diferido esté degradado — un readiness que devuelva
 * 503 por Redis haría que el orquestador reinicie un backend perfectamente
 * sano y convertiría una degradación parcial en una caída total.
 *
 * Por eso esto informa, no decide: expone `down` para que se vea en
 * monitorización, y quien consuma el endpoint elige qué hacer con ello.
 */
@Injectable()
export class QueueHealthService {
  private readonly logger = new Logger(QueueHealthService.name);

  /**
   * `disabled` cuando la cola no está configurada. Es un estado legítimo, no
   * un fallo: permite arrancar el backend sin Redis (tests, desarrollo
   * local sin Docker) sin ensuciar la monitorización con falsas alarmas.
   */
  isEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.QUEUE_ENABLED?.trim() !== 'false';
  }

  async check(
    ping: (conn: ReturnType<typeof buildRedisConnection>) => Promise<unknown>,
    env: NodeJS.ProcessEnv = process.env,
  ): Promise<QueueHealth> {
    if (!this.isEnabled(env)) return { state: 'disabled' };

    const inicio = Date.now();
    try {
      await ping(buildRedisConnection(env));
      return { state: 'up', latencyMs: Date.now() - inicio };
    } catch (error) {
      // Nunca se registra la cadena de conexión ni la contraseña: solo el
      // tipo de fallo, que es lo único accionable.
      const reason =
        error instanceof Error ? error.name || 'Error' : 'DesconocidoError';
      this.logger.warn(`Cola no disponible [${reason}]`);
      return { state: 'down', latencyMs: Date.now() - inicio, reason };
    }
  }
}
