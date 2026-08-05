import 'reflect-metadata';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  HeartbeatService,
  LATIDO_MAXIMO_MS,
  INTERVALO_LATIDO_MS,
  rutaDelLatido,
} from './heartbeat.service';

/**
 * El healthcheck del worker.
 *
 * EL WORKER FIGURABA `unhealthy` SIN ESTARLO. Heredaba el HEALTHCHECK de la
 * imagen del backend —`wget http://127.0.0.1:3001/api/health`— y el worker no
 * expone HTTP por diseño, así que fallaba siempre. Docker no lo reiniciaba,
 * pero la monitorización leía justo lo contrario de la verdad.
 *
 * La señal correcta es que ESTE PROCESO siga vivo y su temporizador corriendo.
 */
describe('marca local de latido del worker', () => {
  let dir: string;
  let fichero: string;
  const entornoOriginal = { ...process.env };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'latido-'));
    fichero = join(dir, 'worker-heartbeat');
    process.env.WORKER_HEARTBEAT_FILE = fichero;
    process.env.WORKER_ROLE = 'queue';
  });

  afterEach(() => {
    process.env = { ...entornoOriginal };
    rmSync(dir, { recursive: true, force: true });
  });

  const servicio = () =>
    new HeartbeatService({
      systemHeartbeat: { upsert: jest.fn().mockResolvedValue({}) },
    } as never);

  it('escribe la marca al arrancar, sin esperar al primer tic', () => {
    // Sin esto el worker pasaria sus primeros 30 s marcado como enfermo.
    servicio().onApplicationBootstrap();

    expect(existsSync(fichero)).toBe(true);
  });

  it('el latido periódico refresca la marca', async () => {
    const s = servicio();
    s.onApplicationBootstrap();
    const primera = readFileSync(fichero, 'utf-8');

    await new Promise((r) => setTimeout(r, 5));
    await s.latir();

    expect(Number(readFileSync(fichero, 'utf-8'))).toBeGreaterThanOrEqual(
      Number(primera),
    );
  });

  it('LA MARCA SE ESCRIBE AUNQUE LA BASE FALLE', async () => {
    // Un parpadeo de PostgreSQL no puede marcar enfermo a un worker sano: es
    // el mismo error que este arreglo corrige, solo que al reves.
    const s = new HeartbeatService({
      systemHeartbeat: {
        upsert: jest.fn().mockRejectedValue(new Error('base caida')),
      },
    } as never);

    await expect(s.latir()).resolves.toBeUndefined();

    expect(existsSync(fichero)).toBe(true);
  });

  it('el backend NO escribe marca: no es el worker', async () => {
    process.env.WORKER_ROLE = '';
    const s = servicio();

    s.onApplicationBootstrap();
    await s.latir();

    expect(existsSync(fichero)).toBe(false);
  });

  it('un worker detenido deja envejecer la marca (no queda healthy)', async () => {
    const s = servicio();
    s.onApplicationBootstrap();

    // Nadie vuelve a latir: la edad crece y el healthcheck la vera vieja.
    const edad = Date.now() - statSync(fichero).mtimeMs;
    expect(edad).toBeLessThan(LATIDO_MAXIMO_MS);
    expect(LATIDO_MAXIMO_MS).toBeGreaterThan(INTERVALO_LATIDO_MS);
  });

  it('tolera perder un tic sin marcar enfermo', () => {
    // Dos intervalos y medio: una pausa del recolector o un pico de carga no
    // deben producir una falsa alarma.
    expect(LATIDO_MAXIMO_MS).toBeGreaterThanOrEqual(INTERVALO_LATIDO_MS * 2);
  });

  it('no revienta si el fichero no se puede escribir', async () => {
    process.env.WORKER_HEARTBEAT_FILE = join(dir, 'no', 'existe', 'ruta');
    const s = servicio();

    // El worker sigue trabajando; el healthcheck vera la marca envejecer,
    // que es exactamente lo que debe pasar.
    await expect(s.latir()).resolves.toBeUndefined();
  });

  it('la ruta es configurable y tiene un valor por defecto', () => {
    expect(rutaDelLatido({ WORKER_HEARTBEAT_FILE: '/x/y' })).toBe('/x/y');
    expect(rutaDelLatido({})).toBe('/tmp/worker-heartbeat');
    expect(rutaDelLatido({ WORKER_HEARTBEAT_FILE: '  ' })).toBe(
      '/tmp/worker-heartbeat',
    );
  });
});
