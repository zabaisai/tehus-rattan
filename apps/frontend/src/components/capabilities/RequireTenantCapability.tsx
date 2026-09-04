'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Lock, ToggleRight } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { useTenantCapabilities } from '@/lib/tenant-capabilities';
import {
  updateMyTenantConfiguration,
  type OptionalModuleKey,
} from '@/lib/tenant-configuration';
import { Button } from '@/components/ui/Button';
import { ForbiddenState } from '@/components/ui/ForbiddenState';
import { mensajeDeError } from '@/components/ui/ListState';
import { Skeleton } from '@/components/ui/Skeleton';

const ETIQUETA_POR_DEFECTO: Record<OptionalModuleKey, string> = {
  catalog: 'Catálogo',
  quotes: 'Cotizaciones',
  tasks: 'Tareas',
};

/**
 * GUARDA DE RUTA POR MÓDULO (Fase 4).
 *
 * Envuelve la pantalla de un módulo opcional. Los hijos solo se montan con el
 * módulo activo, así que sus consultas no se lanzan mientras no se sabe si
 * está permitido ni cuando no lo está: nada de `403 MODULE_DISABLED` en la
 * consola por una pantalla que no debía cargarse.
 *
 * NUNCA REDIRIGE. Quien llega por un enlace guardado ve por qué no hay nada y
 * qué puede hacer: un administrador lo activa desde aquí mismo; un asesor
 * sabe a quién pedírselo. Redirigir al Inicio habría dejado la pregunta sin
 * respuesta y, con una redirección en el otro sentido, un bucle.
 *
 * La seguridad la sigue poniendo el servidor en cada petición; esto es la
 * experiencia.
 */
export function RequireTenantCapability({
  capability,
  children,
}: {
  capability: OptionalModuleKey;
  children: ReactNode;
}) {
  const capacidades = useTenantCapabilities();
  const rol = useAuthStore((s) => s.user?.role);
  const queryClient = useQueryClient();
  const [activando, setActivando] = useState(false);
  const [errorDeActivacion, setErrorDeActivacion] = useState('');

  const definicion = capacidades.definition(capability);
  const etiqueta = definicion?.label ?? ETIQUETA_POR_DEFECTO[capability];

  if (capacidades.status === 'platform') {
    return (
      <ForbiddenState
        titulo="Esta sección pertenece a una empresa"
        detalle="La administración de la plataforma no tiene módulos de empresa que mostrar aquí."
      />
    );
  }

  if (capacidades.status === 'loading' || capacidades.status === 'anonymous') {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-live="polite"
        className="space-y-3"
      >
        <span className="sr-only">Cargando módulos…</span>
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (capacidades.status === 'error') {
    return (
      <div
        role="alert"
        className="flex flex-col items-center gap-2 rounded-lg border border-status-error/20 bg-status-error-surface px-4 py-10 text-center"
      >
        <AlertTriangle
          size={24}
          aria-hidden="true"
          strokeWidth={1.5}
          className="text-status-error"
        />
        <p className="text-sm font-medium text-status-error">
          No se pudo comprobar qué módulos tiene activos tu empresa.
        </p>
        <p className="max-w-sm text-xs text-content-secondary">
          {mensajeDeError(capacidades.error)}
        </p>
        <button
          type="button"
          onClick={capacidades.retry}
          className="mt-1 rounded-md border border-status-error/30 bg-surface-default px-2.5 py-1.5 text-xs text-status-error outline-none transition-colors motion-reduce:transition-none hover:bg-status-error-surface focus-visible:ring-2 focus-visible:ring-line-focus focus-visible:ring-offset-1"
        >
          Reintentar
        </button>
      </div>
    );
  }

  if (capacidades.can(capability)) {
    return <>{children}</>;
  }

  const puedeActivar = rol === 'ADMIN' || rol === 'SUPER_ADMIN';

  if (!puedeActivar) {
    // Sin enlace a la configuración ni datos internos: un asesor no puede
    // activarlo, y saber que existe una pantalla que no puede abrir no le
    // ayuda. Sí le sirve saber a quién pedirlo.
    return (
      <ForbiddenState
        titulo="Este módulo no está disponible"
        detalle={`${etiqueta} no está activo en tu empresa. Si lo necesitas, pídeselo a un administrador.`}
      />
    );
  }

  async function activar() {
    setErrorDeActivacion('');
    setActivando(true);
    try {
      const respuesta = await updateMyTenantConfiguration({
        modules: { [capability]: true },
      });
      // Primero la respuesta canónica —la pantalla cambia ya— y después la
      // invalidación de todo lo derivado de la empresa (configuración,
      // ajustes, perfil), por si algo más leyó los módulos.
      capacidades.apply(respuesta);
      await queryClient.invalidateQueries({ queryKey: ['company-me'] });
    } catch (e) {
      setErrorDeActivacion(mensajeDeError(e));
    } finally {
      setActivando(false);
    }
  }

  return (
    <section
      aria-labelledby={`modulo-inactivo-${capability}`}
      className="mx-auto flex max-w-lg flex-col items-center gap-3 rounded-lg border border-dashed border-line-strong bg-surface-subtle px-5 py-10 text-center"
    >
      <Lock size={22} aria-hidden="true" className="text-content-disabled" />
      <h2
        id={`modulo-inactivo-${capability}`}
        className="text-base font-semibold text-content-primary"
      >
        Este módulo no está activo para tu empresa
      </h2>
      <p className="text-sm text-content-secondary">
        <strong className="font-medium text-content-primary">{etiqueta}</strong>
        {definicion?.description ? `: ${definicion.description}` : '.'}
      </p>
      <p className="max-w-sm text-xs text-content-secondary">
        Activarlo no crea ni borra nada: si la empresa lo usó antes, sus datos
        vuelven a verse tal como estaban.
      </p>

      {errorDeActivacion && (
        <p role="alert" className="text-xs font-medium text-status-error">
          {errorDeActivacion}
        </p>
      )}

      <div className="mt-2 flex flex-col-reverse items-center gap-2 sm:flex-row">
        <Link
          href="/dashboard/settings/company"
          className="rounded-md px-3 py-2 text-sm text-content-link outline-none transition-colors motion-reduce:transition-none hover:underline focus-visible:ring-2 focus-visible:ring-line-focus focus-visible:ring-offset-1"
        >
          Ver la configuración de la empresa
        </Link>
        <Button onClick={() => void activar()} disabled={activando}>
          <ToggleRight size={16} aria-hidden="true" />
          {activando ? 'Activando…' : 'Activar módulo'}
        </Button>
      </div>
    </section>
  );
}
