import { describe, expect, it } from 'vitest';
import {
  filtrarRespuesta,
  TIPOS_BUSCABLES,
  tiposBuscablesPara,
  type RespuestaDeBusqueda,
} from './busqueda';
import type { TenantCapabilityKey } from './tenant-capabilities';

const solo =
  (...activas: TenantCapabilityKey[]) =>
  (k: TenantCapabilityKey) =>
    activas.includes(k);

describe('tiposBuscablesPara', () => {
  it('con todo activo devuelve los cinco tipos, en el orden de siempre', () => {
    expect(tiposBuscablesPara(() => true)).toEqual([...TIPOS_BUSCABLES]);
  });

  it('sin catálogo no se buscan productos; sin cotizaciones, tampoco cotizaciones', () => {
    expect(tiposBuscablesPara(solo('quotes'))).toEqual([
      'contactos',
      'conversaciones',
      'oportunidades',
      'cotizaciones',
    ]);
    expect(tiposBuscablesPara(solo('catalog'))).toEqual([
      'contactos',
      'conversaciones',
      'oportunidades',
      'productos',
    ]);
  });

  it('mientras no se conoce la configuración (`can` siempre falso) quedan los centrales', () => {
    expect(tiposBuscablesPara(() => false)).toEqual([
      'contactos',
      'conversaciones',
      'oportunidades',
    ]);
  });
});

describe('filtrarRespuesta', () => {
  const respuesta: RespuestaDeBusqueda = {
    consulta: 'sala',
    total: 3,
    grupos: [
      {
        tipo: 'oportunidades',
        total: 1,
        resultados: [
          { tipo: 'oportunidades', id: 'l1', titulo: 'Sala', subtitulo: null, insignia: null, contactoId: null },
        ],
      },
      {
        tipo: 'productos',
        total: 2,
        resultados: [
          { tipo: 'productos', id: 'p1', titulo: 'Sala Toscana', subtitulo: null, insignia: null, contactoId: null },
          { tipo: 'productos', id: 'p2', titulo: 'Sala Milán', subtitulo: null, insignia: null, contactoId: null },
        ],
      },
    ],
  };

  it('quita los grupos de un módulo apagado y recalcula el total', () => {
    const filtrada = filtrarRespuesta(respuesta, ['contactos', 'conversaciones', 'oportunidades']);

    expect(filtrada.grupos.map((g) => g.tipo)).toEqual(['oportunidades']);
    expect(filtrada.total).toBe(1);
  });

  it('si nada sobra devuelve la MISMA respuesta, sin copiarla', () => {
    expect(filtrarRespuesta(respuesta, [...TIPOS_BUSCABLES])).toBe(respuesta);
  });
});
