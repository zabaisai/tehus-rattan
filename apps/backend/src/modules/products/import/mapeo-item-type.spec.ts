import { CAMPOS, mapearCabeceras, validarMapeo } from './mapeo-columnas';

/**
 * Columna «Tipo de elemento» (Fase 2) en el mapeo automático de cabeceras.
 * La regla que importa: `tipo` a solas sigue siendo CATEGORÍA, como antes.
 */
describe('mapeo de columnas — itemType', () => {
  it('itemType existe como campo, con etiqueta legible y después de category', () => {
    const campos = CAMPOS.map((c) => c.campo);
    expect(campos).toContain('itemType');
    expect(campos.indexOf('category')).toBeLessThan(campos.indexOf('itemType'));
    expect(CAMPOS.find((c) => c.campo === 'itemType')?.etiqueta).toBe(
      'Tipo de elemento',
    );
  });

  it.each([
    'Tipo de elemento',
    'TIPO DE ELEMENTO',
    'tipo_de_elemento',
    'Tipo de catálogo',
    'Item Type',
    'itemType',
    'Producto o servicio',
    'Tipo de ítem',
  ])('reconoce la cabecera «%s»', (cabecera) => {
    const mapeo = mapearCabeceras(['Nombre', 'Precio', cabecera]);
    expect(mapeo.campos.itemType).toBe(2);
    expect(mapeo.campos.category).toBeUndefined();
  });

  it('la cabecera «tipo» a solas sigue siendo categoría (sin ambigüedad nueva)', () => {
    const mapeo = mapearCabeceras(['Nombre', 'Tipo', 'Precio']);
    expect(mapeo.campos.category).toBe(1);
    expect(mapeo.campos.itemType).toBeUndefined();
  });

  it('con «Tipo» y «Tipo de elemento» a la vez, cada una va a su campo', () => {
    const mapeo = mapearCabeceras([
      'Nombre',
      'Tipo',
      'Tipo de elemento',
      'Precio',
    ]);
    expect(mapeo.campos.category).toBe(1);
    expect(mapeo.campos.itemType).toBe(2);
  });

  it('un archivo antiguo sin la columna no la mapea (y por tanto el tipo no se toca al importar)', () => {
    const mapeo = mapearCabeceras(['Nombre', 'SKU', 'Precio']);
    expect(mapeo.campos.itemType).toBeUndefined();
  });

  it('validarMapeo admite itemType como campo conocido', () => {
    expect(
      validarMapeo({ campos: { name: 0, itemType: 1 }, sinAsignar: [] }, 2),
    ).toBeNull();
  });
});
