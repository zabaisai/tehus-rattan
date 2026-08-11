'use client';

import { forwardRef } from 'react';
import {
  CLASES_CONTROL,
  CLASES_CONTROL_BORDE,
  usePropsDeCampo,
} from './Field';

export interface PropsInput
  extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Pinta el borde de error. Dentro de un `Field` con `error` se hereda. */
  invalid?: boolean;
}

/**
 * Campo de texto del sistema TAKTO.
 *
 * Dentro de un `Field` se conecta solo con su etiqueta, su ayuda y su error.
 * Suelto también funciona, pero entonces el `id` y la accesibilidad son
 * responsabilidad de quien lo usa.
 */
export const Input = forwardRef<HTMLInputElement, PropsInput>(function Input(
  { className = '', invalid, ...resto },
  ref,
) {
  const props = usePropsDeCampo(resto);
  const conError = invalid ?? props['aria-invalid'] === true;

  return (
    <input
      ref={ref}
      className={`${CLASES_CONTROL} ${
        conError ? CLASES_CONTROL_BORDE.error : CLASES_CONTROL_BORDE.normal
      } ${className}`}
      {...props}
    />
  );
});
