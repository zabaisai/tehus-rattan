import { Prisma } from '@prisma/client';
import { of, lastValueFrom } from 'rxjs';
import { DecimalInterceptor } from './decimal.interceptor';

/**
 * UN IMPORTE NO PUEDE SALIR POR LA API COMO {"s":1,"e":6,"d":[...]}.
 *
 * Eso es la representacion interna de decimal.js, y en el navegador es `NaN`.
 * Se veia como «$ NaN» en cada tarjeta del tablero, y no lo detecto ninguna
 * prueba porque todas comprueban el SERVICIO —donde el valor todavia es un
 * Decimal correcto— y no lo que sale por HTTP.
 */
describe('Serialización de importes en la respuesta', () => {
  const interceptor = new DecimalInterceptor();
  const pasar = (datos: unknown) =>
    lastValueFrom(
      interceptor.intercept({} as never, { handle: () => of(datos) } as never),
    );

  it('convierte un Decimal suelto a número', async () => {
    const r = await pasar(new Prisma.Decimal('4500000.5'));
    expect(r).toBe(4500000.5);
  });

  it('convierte los importes dentro de un objeto', async () => {
    const r = (await pasar({
      id: 'lead-1',
      title: 'Sala de ratán',
      value: new Prisma.Decimal('4500000'),
    })) as Record<string, unknown>;

    expect(r.value).toBe(4500000);
    expect(typeof r.value).toBe('number');
    expect(r.title).toBe('Sala de ratán');
  });

  it('convierte los importes anidados en listas', async () => {
    // Es la forma exacta que devuelve el tablero: columnas con sus leads.
    const r = (await pasar({
      stages: [
        {
          name: 'Contactado',
          leads: [
            { id: 'l1', value: new Prisma.Decimal('1500000') },
            { id: 'l2', value: new Prisma.Decimal('3000000') },
          ],
        },
      ],
    })) as any;

    expect(r.stages[0].leads[0].value).toBe(1500000);
    expect(r.stages[0].leads[1].value).toBe(3000000);
  });

  it('el resultado sobrevive a JSON.stringify como número', async () => {
    // La comprobación que de verdad importa: lo que llega al navegador.
    const r = await pasar({ total: new Prisma.Decimal('1190000') });
    expect(JSON.stringify(r)).toBe('{"total":1190000}');
    expect(JSON.stringify(r)).not.toContain('"s":');
  });

  it('no toca las fechas', async () => {
    const fecha = new Date('2026-08-05T12:00:00.000Z');
    const r = (await pasar({ createdAt: fecha })) as Record<string, unknown>;
    expect(r.createdAt).toBeInstanceOf(Date);
    expect((r.createdAt as Date).toISOString()).toBe(fecha.toISOString());
  });

  it('NO recorre un Buffer', async () => {
    // El PDF de una cotización es un Buffer: recorrerlo byte a byte lo
    // destruiría además de costar una eternidad.
    const pdf = Buffer.from('%PDF-1.7 contenido');
    const r = await pasar(pdf);
    expect(Buffer.isBuffer(r)).toBe(true);
    expect((r as Buffer).toString()).toBe('%PDF-1.7 contenido');
  });

  it('deja pasar null y undefined sin inventar nada', async () => {
    expect(await pasar(null)).toBeNull();
    const r = (await pasar({ value: null })) as Record<string, unknown>;
    expect(r.value).toBeNull();
  });

  it('no muta el objeto original', async () => {
    // Mutar la entidad de Prisma la dejaría alterada para cualquier otro uso
    // dentro de la misma petición.
    const original = { value: new Prisma.Decimal('100') };
    await pasar(original);
    expect(original.value).toBeInstanceOf(Prisma.Decimal);
  });

  it('una estructura muy anidada no cuelga el proceso', async () => {
    let hondo: Record<string, unknown> = { value: new Prisma.Decimal('1') };
    for (let i = 0; i < 40; i++) hondo = { nivel: hondo };

    await expect(pasar(hondo)).resolves.toBeDefined();
  });
});
