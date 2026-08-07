import { validarMapeo } from './mapeo-columnas';
/**
 * UN CUERPO MAL ESCRITO ES UN 400, NO UN 500.
 *
 * `@IsObject()` acepta `{}` y cualquier objeto sin `campos`; `validarMapeo`
 * entraba entonces a `mapeo.campos.name` sobre `undefined` y el endpoint
 * contestaba 500. Lo descubrió una petición de QA en staging con la forma
 * equivocada: el servidor se rompía en vez de explicar qué faltaba.
 */
describe('validarMapeo con cuerpos mal formados', () => {
  it.each<[unknown, string]>([
    [undefined, 'sin cuerpo'],
    [null, 'nulo'],
    [{}, 'objeto vacío'],
    [{ campos: null }, 'campos nulo'],
    [{ campos: 'name' }, 'campos que no es objeto'],
    [{ campos: [0, 1] }, 'campos que es una lista'],
  ])('devuelve un mensaje en vez de lanzar (%#: %s)', (entrada) => {
    let resultado: string | null = null;
    expect(() => {
      resultado = validarMapeo(entrada as never, 4);
    }).not.toThrow();
    expect(resultado).toBeTruthy();
  });

  it('el mensaje dice cómo se escribe bien', () => {
    const mensaje = validarMapeo({} as never, 4);
    expect(mensaje).toContain('campos');
    expect(mensaje).toMatch(/name/);
  });

  it('un mapeo correcto sigue pasando', () => {
    expect(
      validarMapeo({ campos: { name: 0, sku: 1 } } as never, 4),
    ).toBeNull();
  });
});
