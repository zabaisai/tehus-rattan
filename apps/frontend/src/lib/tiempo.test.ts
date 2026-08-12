import { afterEach, describe, expect, it, vi } from 'vitest';
import { antiguedadEnPalabras, timeAgo } from './tiempo';

const hace = (ms: number) => new Date(Date.now() - ms).toISOString();
const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

afterEach(() => vi.useRealTimers());

describe('timeAgo', () => {
  it('menos de un minuto es «ahora», no «0m»', () => {
    expect(timeAgo(hace(20_000))).toBe('ahora');
  });

  it('redondea hacia abajo: 59 minutos no son una hora', () => {
    expect(timeAgo(hace(59 * MIN))).toBe('59m');
    expect(timeAgo(hace(60 * MIN))).toBe('1h');
  });

  it('a partir de un día cuenta días', () => {
    expect(timeAgo(hace(23 * HORA))).toBe('23h');
    expect(timeAgo(hace(3 * DIA))).toBe('3d');
  });

  it('sin fecha no escribe nada: una conversación puede no tener mensajes', () => {
    expect(timeAgo(null)).toBe('');
    expect(timeAgo(undefined)).toBe('');
  });
});

describe('antiguedadEnPalabras', () => {
  it('concuerda el singular y el plural', () => {
    expect(antiguedadEnPalabras(hace(1 * MIN))).toBe('hace 1 minuto');
    expect(antiguedadEnPalabras(hace(2 * MIN))).toBe('hace 2 minutos');
    expect(antiguedadEnPalabras(hace(1 * HORA))).toBe('hace 1 hora');
    expect(antiguedadEnPalabras(hace(1 * DIA))).toBe('hace 1 día');
    expect(antiguedadEnPalabras(hace(2 * DIA))).toBe('hace 2 días');
  });

  it('dice lo mismo que la forma corta, en voz alta', () => {
    expect(antiguedadEnPalabras(hace(20_000))).toBe('hace un momento');
    expect(antiguedadEnPalabras(null)).toBe('sin actividad');
  });
});
