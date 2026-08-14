import { describe, expect, it } from 'vitest';
import {
  PESTANAS,
  aplicarCambios,
  leerEstadoDeBandeja,
  pestanaActiva,
  queryDeEstado,
} from './inbox-url';

/**
 * LA URL ES LA FUENTE DE VERDAD DE LA BANDEJA.
 *
 * Antes solo viajaba la conversación (`?c=`). Los filtros vivían en estado de
 * React, así que recargar con «Sin leer» activo devolvía «Todas» sin avisar, y
 * Atrás no deshacía un cambio de filtro porque nunca había habido entrada en el
 * historial. Estas pruebas fijan el contrato del códec antes de tocar la
 * pantalla: son funciones puras, y comprobarlas aquí evita tener que montar la
 * página entera para saber si un parámetro sobrevive.
 */

const leer = (q: string) => leerEstadoDeBandeja(new URLSearchParams(q));

describe('leerEstadoDeBandeja', () => {
  it('sin parámetros deja la bandeja en «Todas», sin selección y sin perfil', () => {
    const e = leer('');
    expect(e.conversacionId).toBeNull();
    expect(e.perfilAbierto).toBe(false);
    expect(e.filtros).toEqual({});
    expect(pestanaActiva(e.filtros)).toBe('todas');
  });

  it('lee la conversación seleccionada', () => {
    expect(leer('c=conv-1').conversacionId).toBe('conv-1');
  });

  it('lee cada pestaña y la traduce a los filtros del contrato', () => {
    expect(leer('vista=mias').filtros).toEqual({ assigned: 'me' });
    expect(leer('vista=libres').filtros).toEqual({ assigned: 'unassigned' });
    expect(leer('vista=sinleer').filtros).toEqual({ unread: true });
    expect(leer('vista=todas').filtros).toEqual({});
  });

  it('una pestaña inventada no rompe: cae en «Todas»', () => {
    expect(leer('vista=loquesea').filtros).toEqual({});
    expect(pestanaActiva(leer('vista=loquesea').filtros)).toBe('todas');
  });

  it('lee búsqueda y estado', () => {
    const e = leer('q=laura&estado=ARCHIVED');
    expect(e.filtros.search).toBe('laura');
    expect(e.filtros.status).toBe('ARCHIVED');
  });

  it('ignora un estado que el contrato no admite', () => {
    expect(leer('estado=INVENTADO').filtros.status).toBeUndefined();
  });

  it('lee el perfil abierto y la ruta de regreso', () => {
    const e = leer('c=conv-1&perfil=1&volverA=%2Fdashboard%2Fpipeline');
    expect(e.perfilAbierto).toBe(true);
    expect(e.volverA).toBe('/dashboard/pipeline');
  });
});

describe('queryDeEstado', () => {
  it('no escribe los valores por defecto: una bandeja limpia es una URL limpia', () => {
    expect(queryDeEstado({ filtros: {}, conversacionId: null, perfilAbierto: false })).toBe('');
  });

  it('ida y vuelta conserva todo lo significativo', () => {
    const original = leer('c=conv-9&vista=sinleer&q=ana&estado=OPEN&perfil=1');
    const q = queryDeEstado(original);
    expect(leerEstadoDeBandeja(new URLSearchParams(q))).toEqual(original);
  });

  it('conserva volverA para poder regresar al embudo', () => {
    const q = queryDeEstado({
      filtros: {},
      conversacionId: 'conv-1',
      perfilAbierto: false,
      volverA: '/dashboard/pipeline?embudo=e1',
    });
    expect(leerEstadoDeBandeja(new URLSearchParams(q)).volverA).toBe(
      '/dashboard/pipeline?embudo=e1',
    );
  });
});

describe('aplicarCambios', () => {
  const base = leer('c=conv-1&vista=mias&q=ana');

  it('cambiar de pestaña conserva la conversación abierta', () => {
    const siguiente = aplicarCambios(base, { pestana: 'libres' });
    expect(siguiente.conversacionId).toBe('conv-1');
    expect(siguiente.filtros.assigned).toBe('unassigned');
  });

  it('cambiar de pestaña limpia los restos de la anterior', () => {
    // «Sin leer» y «Mías» son excluyentes: arrastrar `assigned` dejaría una
    // combinación que nadie pidió y que luego no se sabe deshacer.
    const siguiente = aplicarCambios(base, { pestana: 'sinleer' });
    expect(siguiente.filtros.assigned).toBeUndefined();
    expect(siguiente.filtros.unread).toBe(true);
  });

  it('abrir y cerrar el perfil NO cambia la conversación', () => {
    const abierto = aplicarCambios(base, { perfilAbierto: true });
    expect(abierto.conversacionId).toBe('conv-1');
    const cerrado = aplicarCambios(abierto, { perfilAbierto: false });
    expect(cerrado.conversacionId).toBe('conv-1');
    expect(cerrado.perfilAbierto).toBe(false);
  });

  it('buscar conserva la pestaña activa', () => {
    const siguiente = aplicarCambios(base, { search: 'otra cosa' });
    expect(siguiente.filtros.assigned).toBe('me');
    expect(siguiente.filtros.search).toBe('otra cosa');
  });

  it('una búsqueda vacía se borra de la URL en vez de viajar en blanco', () => {
    const siguiente = aplicarCambios(base, { search: '   ' });
    expect(siguiente.filtros.search).toBeUndefined();
    expect(queryDeEstado(siguiente)).not.toContain('q=');
  });

  it('seleccionar una conversación conserva los filtros', () => {
    const siguiente = aplicarCambios(base, { conversacionId: 'conv-2' });
    expect(siguiente.filtros).toEqual(base.filtros);
    expect(siguiente.conversacionId).toBe('conv-2');
  });

  it('las cuatro pestañas del mockup están, y en su orden', () => {
    expect(PESTANAS.map((p) => p.clave)).toEqual([
      'todas',
      'mias',
      'libres',
      'sinleer',
    ]);
  });
});
