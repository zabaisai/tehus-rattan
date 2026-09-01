import { RedisThrottlerStorage } from './redis-throttler.storage';

// Máquina de estados degradado→recuperado, determinista y sin Redis real: se
// sustituye el `eval` del cliente por un mock. Cubre "Redis caído" (fallback
// local), "fallback local sigue contando/bloqueando" y "recuperación".
describe('RedisThrottlerStorage — degradación y recuperación', () => {
  let storage: RedisThrottlerStorage;
  let evalMock: jest.Mock;

  beforeEach(() => {
    // Puerto cerrado: el cliente real nunca conecta, pero sustituimos eval.
    storage = new RedisThrottlerStorage({ host: '127.0.0.1', port: 1 });
    evalMock = jest.fn();
    (storage as unknown as { client: { eval: jest.Mock } }).client.eval =
      evalMock;
  });

  afterEach(async () => {
    await (
      storage as unknown as { onModuleDestroy: () => Promise<void> }
    ).onModuleDestroy();
  });

  const degradado = () =>
    (storage as unknown as { estaDegradado: () => boolean }).estaDegradado();

  it('Redis disponible: usa el resultado de Redis y no está degradado', async () => {
    // [totalHits, ttlMs, isBlocked, blockTtlMs]
    evalMock.mockResolvedValue([1, 60000, 0, 0]);
    const r = await storage.increment('k', 60000, 5, 60000, 'auth');
    expect(r.totalHits).toBe(1);
    expect(r.isBlocked).toBe(false);
    expect(degradado()).toBe(false);
  });

  it('Redis caído: cae al limitador LOCAL y marca degradado (no ilimitado)', async () => {
    evalMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const r1 = await storage.increment('k', 60000, 2, 60000, 'auth');
    expect(r1.totalHits).toBe(1); // cuenta local, no 0
    const r2 = await storage.increment('k', 60000, 2, 60000, 'auth');
    expect(r2.totalHits).toBe(2);
    const r3 = await storage.increment('k', 60000, 2, 60000, 'auth');
    expect(r3.isBlocked).toBe(true); // LOCAL bloquea al superar el límite
    expect(degradado()).toBe(true);
  });

  it('recuperación: cuando Redis vuelve, sale del modo degradado', async () => {
    evalMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await storage.increment('k', 60000, 5, 60000, 'auth');
    expect(degradado()).toBe(true);

    evalMock.mockResolvedValue([1, 60000, 0, 0]);
    const r = await storage.increment('k', 60000, 5, 60000, 'auth');
    expect(r.totalHits).toBe(1);
    expect(degradado()).toBe(false);
  });

  it('la transición degradado se registra UNA sola vez (sin spam)', async () => {
    const warn = jest
      .spyOn(
        (storage as unknown as { logger: { warn: (m: string) => void } })
          .logger,
        'warn',
      )
      .mockImplementation(() => undefined);
    evalMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await storage.increment('k', 60000, 5, 60000, 'auth');
    await storage.increment('k', 60000, 5, 60000, 'auth');
    await storage.increment('k', 60000, 5, 60000, 'auth');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
