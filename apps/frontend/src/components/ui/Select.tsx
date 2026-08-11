'use client';

import { forwardRef } from 'react';
import {
  CLASES_CONTROL,
  CLASES_CONTROL_BORDE,
  usePropsDeCampo,
} from './Field';

export interface PropsSelect
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

/**
 * Desplegable del sistema TAKTO.
 *
 * Mantiene el `<select>` nativo a propósito: en móvil abre el selector del
 * sistema, ya sabe navegarse con teclado y no hay que reimplementar el
 * comportamiento de una lista accesible.
 *
 * `appearance-none` más flecha propia para que la flecha no cambie de forma
 * entre navegadores. `pr-9` reserva el sitio: sin eso, una opción larga pasa
 * por debajo de la flecha.
 */
export const Select = forwardRef<HTMLSelectElement, PropsSelect>(
  function Select({ className = '', invalid, children, ...resto }, ref) {
    const props = usePropsDeCampo(resto);
    const conError = invalid ?? props['aria-invalid'] === true;

    return (
      <div className="relative">
        <select
          ref={ref}
          className={`${CLASES_CONTROL} ${
            conError ? CLASES_CONTROL_BORDE.error : CLASES_CONTROL_BORDE.normal
          } appearance-none pr-9 ${className}`}
          {...props}
        >
          {children}
        </select>

        {/* Decorativa: el `<select>` ya se anuncia como desplegable. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-secondary"
        >
          <path
            d="M6 8l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    );
  },
);
