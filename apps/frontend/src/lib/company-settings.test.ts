import { describe, expect, it } from 'vitest';
import { hasCategory, normalizeCategoryList } from './company-settings';

describe('company-settings (frontend, misma regla que el backend)', () => {
  it('recorta, colapsa espacios, quita vacíos y duplicados sin distinguir mayúsculas; conserva orden y grafía', () => {
    const { categories, error } = normalizeCategoryList([
      '  Salas ',
      'salas',
      '',
      'SALAS',
      'Come  dores',
      'Comedores',
    ]);
    expect(error).toBeNull();
    expect(categories).toEqual(['Salas', 'Come dores', 'Comedores']);
  });

  it('avisa junto al campo cuando se superan los límites del servidor', () => {
    expect(
      normalizeCategoryList(['x'.repeat(61)], { maxLength: 60, maxCount: 30 }).error,
    ).toMatch(/60 caracteres/);
    const muchas = Array.from({ length: 31 }, (_, i) => `c${i}`);
    expect(normalizeCategoryList(muchas, { maxLength: 60, maxCount: 30 }).error).toMatch(
      /30 categorías/,
    );
    expect(normalizeCategoryList(['ok'], { maxLength: 2, maxCount: 1 }).error).toBeNull();
  });

  it('hasCategory ignora mayúsculas y espacios', () => {
    expect(hasCategory(['Salas', 'Comedores'], ' salas ')).toBe(true);
    expect(hasCategory(['Salas'], 'Sillas')).toBe(false);
  });
});
