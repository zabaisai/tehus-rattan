'use client';

import Link from 'next/link';
import { ReactNode } from 'react';
import { ForbiddenState } from './ForbiddenState';
import { mensajeDeError } from './ListState';
import { SkeletonTexto } from './Skeleton';

/**
 * Bloque con título, una acción secundaria y sus estados.
 *
 * EXISTE PORQUE LOS CINCO BLOQUES DEL INICIO REPETÍAN LO MISMO: cabecera,
 * enlace «Ver todas», y cuatro ramas —cargando, sin permiso, error, vacío—
 * escritas a mano. Cinco copias son cinco sitios donde olvidar el estado de
 * error, que es justo el que nadie prueba.
 *
 * `sinPermiso` va **antes** que `error` a propósito: un 403 llega como error de
 * red, y tratarlo como avería invita a reintentar algo que nunca va a
 * funcionar.
 */
export function Panel({
  titulo,
  accion,
  cargando = false,
  sinPermiso = false,
  detalleSinPermiso,
  error,
  vacio = false,
  mensajeVacio,
  children,
  className = '',
}: {
  titulo: string;
  accion?: { href: string; etiqueta: string };
  cargando?: boolean;
  sinPermiso?: boolean;
  detalleSinPermiso?: string;
  error?: unknown;
  vacio?: boolean;
  mensajeVacio?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section
      // `aria-busy` en la región: es lo que anuncia la carga a un lector de
      // pantalla, ya que los esqueletos van `aria-hidden`.
      aria-busy={cargando || undefined}
      aria-labelledby={`panel-${titulo.replace(/\s+/g, '-').toLowerCase()}`}
      className={`flex flex-col rounded-lg border border-line-default bg-surface-default shadow-xs ${className}`}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line-default px-4 py-3">
        <h3
          id={`panel-${titulo.replace(/\s+/g, '-').toLowerCase()}`}
          // Envuelve en vez de truncarse. A 1280 px el panel se queda en un
          // tercio del ancho y «Conversaciones que requieren respuesta» pedía
          // 254 px en 213: se leía «…que requieren re». Un titular cortado es
          // peor que un titular de dos líneas, y con `items-start` en la
          // retícula la altura extra no arrastra a los paneles vecinos.
          className="min-w-0 text-sm font-semibold leading-snug text-content-primary"
        >
          {titulo}
        </h3>
        {accion && !sinPermiso && (
          <Link
            href={accion.href}
            className="shrink-0 rounded text-xs text-content-link outline-none transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-line-focus focus-visible:ring-offset-1"
          >
            {accion.etiqueta}
          </Link>
        )}
      </div>

      <div className="min-h-0 flex-1 p-4">
        {cargando && <SkeletonTexto lineas={4} />}

        {!cargando && sinPermiso && (
          <ForbiddenState detalle={detalleSinPermiso} className="border-0 bg-transparent py-6" />
        )}

        {!cargando && !sinPermiso && error != null && (
          <p role="alert" className="py-6 text-center text-sm text-status-error">
            {mensajeDeError(error)}
          </p>
        )}

        {!cargando && !sinPermiso && error == null && vacio && (
          <p className="py-6 text-center text-sm text-content-secondary">
            {mensajeVacio ?? 'Todavía no hay nada aquí.'}
          </p>
        )}

        {!cargando && !sinPermiso && error == null && !vacio && children}
      </div>
    </section>
  );
}

/** `true` si el fallo es un 403: el panel debe decir «sin permiso», no «error». */
export function esSinPermiso(error: unknown): boolean {
  return (
    (error as { response?: { status?: number } } | undefined)?.response
      ?.status === 403
  );
}
