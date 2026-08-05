import { describe, expect, it } from 'vitest';
import { permisosDe } from './flowbot-permisos';

/**
 * Estos permisos NO protegen nada —eso lo hace el servidor—, deciden qué se
 * dibuja. Lo que fijan estas pruebas es que un asesor no vea botones que
 * siempre le van a devolver 403, porque eso no parece una restricción: parece
 * que el producto está roto.
 */
describe('permisosDe', () => {
  it('un AGENT puede mirar, pero no crear ni publicar', () => {
    const p = permisosDe('AGENT');

    expect(p.puedeVer).toBe(true);
    expect(p.puedeCrear).toBe(false);
    expect(p.puedeEditar).toBe(false);
    expect(p.puedePublicar).toBe(false);
    expect(p.puedeActivar).toBe(false);
    expect(p.puedeArchivar).toBe(false);
  });

  it('un AGENT tampoco ve las ejecuciones de los demás', () => {
    // El filtro lo impone el servidor; aquí solo se evita ofrecerle un filtro
    // «todas» que no le va a devolver todas.
    expect(permisosDe('AGENT').veTodasLasEjecuciones).toBe(false);
  });

  it('un MANAGER diseña y publica', () => {
    const p = permisosDe('MANAGER');

    expect(p.puedeCrear).toBe(true);
    expect(p.puedeEditar).toBe(true);
    expect(p.puedePublicar).toBe(true);
    expect(p.puedeActivar).toBe(true);
    expect(p.puedeSimular).toBe(true);
    expect(p.puedeIntervenir).toBe(true);
  });

  it('un MANAGER NO archiva: retirar un bot no es lo mismo que pausarlo', () => {
    expect(permisosDe('MANAGER').puedeArchivar).toBe(false);
    expect(permisosDe('MANAGER').puedeActivar).toBe(true);
  });

  it('un ADMIN lo puede todo', () => {
    const p = permisosDe('ADMIN');
    expect(Object.values(p).every(Boolean)).toBe(true);
  });

  it('sin rol no se ve nada', () => {
    // Mientras carga la sesión no hay rol. Enseñar la interfaz completa y
    // quitarla medio segundo después es peor que no enseñarla.
    expect(permisosDe(undefined).puedeVer).toBe(false);
    expect(permisosDe(null).puedeCrear).toBe(false);
  });
});
