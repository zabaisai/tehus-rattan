import { describe, expect, it } from 'vitest';
import {
  leerErrorDeFusion,
  puedeFusionar,
  relojDeCuentaAtras,
  segundosParaDeshacer,
} from './fusion';

describe('lib/fusion — cuenta atrás, errores y permisos', () => {
  describe('la ventana para deshacer la fija el SERVIDOR', () => {
    const base = { deshacerHasta: '2026-08-13T12:10:00.000Z', deshecha: false };

    it('cuenta contra `deshacerHasta`, no diez minutos desde el navegador', () => {
      // A las 12:04 quedan seis minutos, aunque la pantalla lleve abierta más.
      const ahora = new Date('2026-08-13T12:04:00.000Z').getTime();
      expect(segundosParaDeshacer(base, ahora)).toBe(360);
    });

    it('una fusión abierta después de la ventana no ofrece deshacer', () => {
      const ahora = new Date('2026-08-13T12:11:00.000Z').getTime();
      expect(segundosParaDeshacer(base, ahora)).toBe(0);
    });

    it('una fusión ya deshecha no tiene cuenta atrás', () => {
      const ahora = new Date('2026-08-13T12:01:00.000Z').getTime();
      expect(segundosParaDeshacer({ ...base, deshecha: true }, ahora)).toBe(0);
    });

    it('una marca ilegible se trata como vencida, no como infinita', () => {
      expect(
        segundosParaDeshacer({ deshacerHasta: 'no-es-fecha', deshecha: false }),
      ).toBe(0);
    });

    it('el reloj se escribe en minutos y segundos', () => {
      expect(relojDeCuentaAtras(598)).toBe('9:58');
      expect(relojDeCuentaAtras(5)).toBe('0:05');
      expect(relojDeCuentaAtras(0)).toBe('0:00');
    });
  });

  describe('errores del contrato', () => {
    const conRespuesta = (status: number, data?: unknown) => ({
      response: { status, data },
    });

    it('un 409 con código conocido se explica en palabras y se marca como conflicto', () => {
      const e = leerErrorDeFusion(
        conRespuesta(409, { codigo: 'VISTA_PREVIA_OBSOLETA' }),
      );
      expect(e.tipo).toBe('conflicto');
      expect(e.codigo).toBe('VISTA_PREVIA_OBSOLETA');
      expect(e.mensaje).toContain('Vuelve a compararlos');
    });

    it('distingue sin permiso de no encontrado y de avería', () => {
      expect(leerErrorDeFusion(conRespuesta(403)).tipo).toBe('sinPermiso');
      expect(leerErrorDeFusion(conRespuesta(404)).tipo).toBe('noEncontrado');
      expect(leerErrorDeFusion(conRespuesta(500)).tipo).toBe('otro');
    });

    it('un 409 sin código conocido no se queda sin mensaje', () => {
      const e = leerErrorDeFusion(conRespuesta(409, { mensaje: 'algo pasó' }));
      expect(e.tipo).toBe('conflicto');
      expect(e.mensaje).toBe('algo pasó');
    });
  });

  describe('roles', () => {
    it('ADMIN y MANAGER fusionan; AGENT no', () => {
      expect(puedeFusionar('ADMIN')).toBe(true);
      expect(puedeFusionar('MANAGER')).toBe(true);
      expect(puedeFusionar('SUPER_ADMIN')).toBe(true);
      expect(puedeFusionar('AGENT')).toBe(false);
      expect(puedeFusionar(null)).toBe(false);
    });
  });
});
