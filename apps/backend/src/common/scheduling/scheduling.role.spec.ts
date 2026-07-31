import { shouldRunScheduledJobs } from './scheduling.role';

describe('shouldRunScheduledJobs', () => {
  it('el WORKER ejecuta los trabajos programados', () => {
    expect(shouldRunScheduledJobs({ WORKER_ROLE: 'queue' })).toBe(true);
  });

  it('el BACKEND no los ejecuta cuando hay worker', () => {
    // EL FALLO QUE ESTO EVITA: backend y worker comparten imagen y AppModule,
    // asi que ambos registran los mismos @Cron y todo lo programado corre por
    // duplicado. Hoy no se nota porque las notificaciones se deduplican y los
    // borrados son idempotentes, pero eso es una coincidencia afortunada: el
    // primer trabajo con efectos acumulativos se ejecutaria dos veces.
    expect(shouldRunScheduledJobs({})).toBe(false);
    expect(shouldRunScheduledJobs({ QUEUE_ENABLED: 'true' })).toBe(false);
  });

  it('sin cola, el proceso unico SI los ejecuta', () => {
    // Desarrollo, pruebas o un despliegue sin Redis: no hay worker, y el CRM
    // debe seguir haciendo sus limpiezas y avisos igualmente.
    expect(shouldRunScheduledJobs({ QUEUE_ENABLED: 'false' })).toBe(true);
    expect(shouldRunScheduledJobs({ QUEUE_ENABLED: ' false ' })).toBe(true);
  });

  it('el worker los ejecuta aunque la cola este apagada', () => {
    expect(
      shouldRunScheduledJobs({ WORKER_ROLE: 'queue', QUEUE_ENABLED: 'false' }),
    ).toBe(true);
  });

  it('en un despliegue normal hay EXACTAMENTE un ejecutor', () => {
    // La propiedad que de verdad importa, comprobada sobre los dos procesos
    // que existen en staging.
    const backend = { QUEUE_ENABLED: 'true' };
    const worker = { WORKER_ROLE: 'queue', QUEUE_ENABLED: 'true' };

    const ejecutores = [backend, worker].filter(shouldRunScheduledJobs);

    expect(ejecutores).toHaveLength(1);
  });
});
