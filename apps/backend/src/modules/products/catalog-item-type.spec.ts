import { BadRequestException } from '@nestjs/common';
import {
  effectiveItemType,
  isCatalogItemType,
  parseItemTypeFilter,
  parseItemTypeLabel,
} from './catalog-item-type';

describe('catalog-item-type', () => {
  it('effectiveItemType: NULL legacy → PRODUCT, explícito se respeta', () => {
    expect(effectiveItemType(null)).toBe('PRODUCT');
    expect(effectiveItemType(undefined)).toBe('PRODUCT');
    expect(effectiveItemType('PRODUCT')).toBe('PRODUCT');
    expect(effectiveItemType('SERVICE')).toBe('SERVICE');
  });

  it('isCatalogItemType solo acepta los dos valores exactos', () => {
    expect(isCatalogItemType('PRODUCT')).toBe(true);
    expect(isCatalogItemType('SERVICE')).toBe(true);
    expect(isCatalogItemType('product')).toBe(false);
    expect(isCatalogItemType('OTRO')).toBe(false);
    expect(isCatalogItemType(1)).toBe(false);
  });

  describe('parseItemTypeFilter (?itemType=)', () => {
    it('sin filtro → undefined', () => {
      expect(parseItemTypeFilter(undefined)).toBeUndefined();
      expect(parseItemTypeFilter('')).toBeUndefined();
    });
    it('PRODUCT incluye las filas legacy en NULL', () => {
      expect(parseItemTypeFilter('PRODUCT')).toEqual({
        OR: [{ itemType: 'PRODUCT' }, { itemType: null }],
      });
    });
    it('SERVICE es exacto', () => {
      expect(parseItemTypeFilter('SERVICE')).toEqual({ itemType: 'SERVICE' });
    });
    it('un valor desconocido es un 400, no un listado vacío', () => {
      expect(() => parseItemTypeFilter('service')).toThrow(BadRequestException);
      expect(() => parseItemTypeFilter('OTRO')).toThrow(BadRequestException);
    });
  });

  describe('parseItemTypeLabel (importación / formularios)', () => {
    it.each([
      ['PRODUCT', 'PRODUCT'],
      ['producto', 'PRODUCT'],
      ['  Producto ', 'PRODUCT'],
      ['SERVICE', 'SERVICE'],
      ['servicio', 'SERVICE'],
      ['SERVÍCIO', 'SERVICE'],
    ])('%s → %s', (input, expected) => {
      expect(parseItemTypeLabel(input)).toBe(expected);
    });

    it.each(['', 'bien', 'productos', 'srv', 'P', '1'])(
      'no adivina: «%s» → null',
      (input) => {
        expect(parseItemTypeLabel(input)).toBeNull();
      },
    );
  });
});
