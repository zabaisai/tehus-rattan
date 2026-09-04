import { describe, expect, it } from 'vitest';
import { ordenCompletoTrasMover } from './pipeline';

const etapas = [
  { id: 'a', order: 0 },
  { id: 'b', order: 1 },
  { id: 'c', order: 2 },
];

describe('ordenCompletoTrasMover', () => {
  it('devuelve TODAS las etapas con posiciones 0..n-1, no solo las dos intercambiadas', () => {
    // El servidor rechaza con 400 un orden parcial: la lista tiene que ser la
    // del embudo entero, sin huecos ni repetidos.
    expect(ordenCompletoTrasMover(etapas, 'c', -1)).toEqual([
      { id: 'a', order: 0 },
      { id: 'c', order: 1 },
      { id: 'b', order: 2 },
    ]);
  });

  it('parte del orden guardado aunque la lista llegue desordenada o con huecos', () => {
    const desordenadas = [
      { id: 'c', order: 7 },
      { id: 'a', order: 1 },
      { id: 'b', order: 4 },
    ];
    expect(ordenCompletoTrasMover(desordenadas, 'a', 1)).toEqual([
      { id: 'b', order: 0 },
      { id: 'a', order: 1 },
      { id: 'c', order: 2 },
    ]);
  });

  it('en el extremo no mueve nada, pero normaliza las posiciones', () => {
    expect(ordenCompletoTrasMover(etapas, 'a', -1)).toEqual(etapas);
    expect(ordenCompletoTrasMover(etapas, 'c', 1)).toEqual(etapas);
  });

  it('una etapa desconocida deja el orden intacto', () => {
    expect(ordenCompletoTrasMover(etapas, 'zzz', 1)).toEqual(etapas);
  });
});
