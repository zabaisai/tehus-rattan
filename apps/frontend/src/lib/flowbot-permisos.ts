import type { Role } from '@/types';

/**
 * Qué puede hacer cada rol con los bots, en un solo sitio.
 *
 * ESTO NO ES LA SEGURIDAD. El servidor decide; aquí solo se decide qué se
 * DIBUJA. Enseñarle a un asesor un botón «Publicar» que siempre va a devolver
 * 403 no protege nada y encima parece una avería del producto.
 *
 * Al revés también importa: ocultar algo aquí no lo protege. Por eso ninguna
 * de estas funciones vive cerca de una llamada, para que nadie las confunda
 * con una comprobación.
 */
export interface PermisosFlowBot {
  /** Ver la sección. Un asesor la ve: necesita saber si el bot está atendiendo. */
  puedeVer: boolean;
  /** Crear, duplicar, usar plantillas. */
  puedeCrear: boolean;
  /** Editar el borrador y guardarlo. */
  puedeEditar: boolean;
  /** Publicar una versión. */
  puedePublicar: boolean;
  /** Activar y pausar. */
  puedeActivar: boolean;
  /** Archivar, restaurar y borrar. */
  puedeArchivar: boolean;
  /** Simular. No toca nada real, pero enseña el flujo entero. */
  puedeSimular: boolean;
  /** Ver TODAS las ejecuciones, no solo las suyas. */
  veTodasLasEjecuciones: boolean;
  /** Cancelar, pausar, reintentar y forzar handoff. */
  puedeIntervenir: boolean;
}

export function permisosDe(role: Role | undefined | null): PermisosFlowBot {
  const admin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const disena = admin || role === 'MANAGER';

  return {
    puedeVer: !!role,
    puedeCrear: disena,
    puedeEditar: disena,
    puedePublicar: disena,
    puedeActivar: disena,
    // Archivar retira el bot del producto; pausarlo solo lo apaga un rato.
    puedeArchivar: admin,
    puedeSimular: disena,
    veTodasLasEjecuciones: disena,
    puedeIntervenir: disena,
  };
}
