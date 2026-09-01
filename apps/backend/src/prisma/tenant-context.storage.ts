import { AsyncLocalStorage } from 'node:async_hooks';

// Contexto de empresa por petición/operación, propagado con AsyncLocalStorage.
//
// Es el punto de integración para RLS: un interceptor lo fija desde
// `req.user.companyId` en cada request autenticada, y los caminos de sistema
// (jobs BullMQ, worker, tareas programadas, WebSocket) lo fijan de forma
// explícita alrededor de su trabajo. `runWithTenant` lo lee para saber qué
// `app.company_id` establecer en la transacción.
//
// No fija nada por sí mismo: sin llamar a `ejecutarCon`, `empresaActual()`
// devuelve null y el consumidor decide (con RLS activo, eso significa 0 filas —
// deny-by-default).

interface ContextoEmpresa {
  companyId: string | null;
  // Marca un acceso legítimamente cross-tenant de sistema (dispatcher, barridos).
  esSistema?: boolean;
}

const almacen = new AsyncLocalStorage<ContextoEmpresa>();

export const TenantContext = {
  /** Ejecuta `fn` con el contexto de empresa dado. */
  ejecutarCon<T>(companyId: string | null, fn: () => T): T {
    return almacen.run({ companyId }, fn);
  },

  /** Ejecuta `fn` marcando el bloque como camino de sistema (cross-tenant). */
  ejecutarComoSistema<T>(fn: () => T): T {
    return almacen.run({ companyId: null, esSistema: true }, fn);
  },

  /** La empresa del contexto actual, o null si no hay. */
  empresaActual(): string | null {
    return almacen.getStore()?.companyId ?? null;
  },

  esSistema(): boolean {
    return almacen.getStore()?.esSistema === true;
  },
};
