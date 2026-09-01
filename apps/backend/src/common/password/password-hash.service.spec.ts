import * as bcrypt from 'bcryptjs';
import { PasswordHashService } from './password-hash.service';

describe('PasswordHashService', () => {
  const OLD = process.env.BCRYPT_COST;
  let svc: PasswordHashService;

  beforeEach(() => {
    // Coste bajo en la prueba para que sea rápida; el objetivo se lee del env.
    process.env.BCRYPT_COST = '10';
    svc = new PasswordHashService();
  });
  afterAll(() => {
    if (OLD === undefined) delete process.env.BCRYPT_COST;
    else process.env.BCRYPT_COST = OLD;
  });

  it('hash usa el coste objetivo del env y compara correctamente', async () => {
    const h = await svc.hash('secreta');
    expect(bcrypt.getRounds(h)).toBe(10);
    expect(await svc.compare('secreta', h)).toBe(true);
    expect(await svc.compare('otra', h)).toBe(false);
  });

  it('necesitaRehash: true para un hash de coste inferior al objetivo', async () => {
    const viejo = await bcrypt.hash('x', 8); // coste 8 < 10
    expect(svc.necesitaRehash(viejo)).toBe(true);
    const actual = await bcrypt.hash('x', 10);
    expect(svc.necesitaRehash(actual)).toBe(false);
  });

  it('necesitaRehash: false (no lanza) ante un hash ilegible', () => {
    expect(svc.necesitaRehash('no-es-un-hash')).toBe(false);
  });

  it('rehashSiHaceFalta recifra y persiste cuando el hash es débil', async () => {
    const viejo = await bcrypt.hash('clave', 8);
    let guardado: string | null = null;
    const recifro = await svc.rehashSiHaceFalta('clave', viejo, async (h) => {
      guardado = h;
    });
    expect(recifro).toBe(true);
    expect(guardado).not.toBeNull();
    expect(bcrypt.getRounds(guardado!)).toBe(10);
    // La nueva contraseña sigue siendo la misma.
    expect(await bcrypt.compare('clave', guardado!)).toBe(true);
  });

  it('rehashSiHaceFalta NO toca un hash que ya cumple el coste', async () => {
    const actual = await bcrypt.hash('clave', 10);
    const persistir = jest.fn();
    const recifro = await svc.rehashSiHaceFalta('clave', actual, persistir);
    expect(recifro).toBe(false);
    expect(persistir).not.toHaveBeenCalled();
  });

  it('un fallo al persistir el rehash NO rompe (best-effort)', async () => {
    const viejo = await bcrypt.hash('clave', 8);
    const recifro = await svc.rehashSiHaceFalta('clave', viejo, async () => {
      throw new Error('db down');
    });
    expect(recifro).toBe(false); // no lanzó
  });

  it('por defecto (sin BCRYPT_COST) el objetivo es 12', () => {
    delete process.env.BCRYPT_COST;
    expect(new PasswordHashService().cost).toBe(12);
  });
});
