import {
  buildRedisConnection,
  DEFAULT_JOB_OPTIONS,
  QUEUE_NAMES,
} from './queue.config';

describe('buildRedisConnection', () => {
  it('usa el host del servicio de Docker por defecto', () => {
    const c = buildRedisConnection({});

    expect(c.host).toBe('redis');
    expect(c.port).toBe(6379);
  });

  it('respeta host y puerto del entorno', () => {
    const c = buildRedisConnection({ REDIS_HOST: 'otro', REDIS_PORT: '6380' });

    expect(c.host).toBe('otro');
    expect(c.port).toBe(6380);
  });

  it('no incluye password cuando no se configura', () => {
    // Redis vive solo en la red interna de Docker, sin puertos publicados.
    // Añadir un secreto que nunca sale de esa red daría falsa seguridad.
    expect(buildRedisConnection({})).not.toHaveProperty('password');
  });

  it('incluye password cuando sí se configura', () => {
    const c = buildRedisConnection({ REDIS_PASSWORD: 'x' }) as {
      password?: string;
    };

    expect(c.password).toBe('x');
  });

  it('ignora una password en blanco en vez de enviar una cadena vacía', () => {
    expect(buildRedisConnection({ REDIS_PASSWORD: '   ' })).not.toHaveProperty(
      'password',
    );
  });

  it.each([['0'], ['70000'], ['abc'], ['-1']])(
    'rechaza un puerto inválido (%s)',
    (port) => {
      expect(() => buildRedisConnection({ REDIS_PORT: port })).toThrow();
    },
  );

  it('fija maxRetriesPerRequest a null, como exige BullMQ', () => {
    // Sin esto un comando bloqueante reintenta indefinidamente y el worker se
    // cuelga en silencio en lugar de fallar de forma visible.
    expect(buildRedisConnection({}).maxRetriesPerRequest).toBeNull();
  });
});

describe('DEFAULT_JOB_OPTIONS', () => {
  it('reintenta con backoff exponencial', () => {
    expect(DEFAULT_JOB_OPTIONS.attempts).toBe(5);
    expect(DEFAULT_JOB_OPTIONS.backoff).toEqual({
      type: 'exponential',
      delay: 5_000,
    });
  });

  it('CONSERVA los jobs fallidos: son la dead-letter queue', () => {
    // Si se descartaran, los fallos desaparecerían igual que hoy se tragan en
    // el motor de automatizaciones actual. Deben poder inspeccionarse y
    // reejecutarse.
    expect(DEFAULT_JOB_OPTIONS.removeOnFail).toBe(false);
  });

  it('limpia los completados para que Redis no crezca sin límite', () => {
    expect(DEFAULT_JOB_OPTIONS.removeOnComplete).toEqual({
      age: 3600,
      count: 1000,
    });
  });
});

describe('QUEUE_NAMES', () => {
  it('todas las colas van con prefijo propio', () => {
    for (const nombre of Object.values(QUEUE_NAMES)) {
      expect(nombre.startsWith('takto.')).toBe(true);
    }
  });

  it('no hay nombres duplicados', () => {
    const nombres = Object.values(QUEUE_NAMES);

    expect(new Set(nombres).size).toBe(nombres.length);
  });
});
