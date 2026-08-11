'use client';

import { forwardRef } from 'react';
import {
  CLASES_CONTROL,
  CLASES_CONTROL_BORDE,
  usePropsDeCampo,
} from './Field';

export interface PropsTextarea
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

/** Área de texto del sistema TAKTO. Mismo foco y mismo borde que el resto. */
export const Textarea = forwardRef<HTMLTextAreaElement, PropsTextarea>(
  function Textarea({ className = '', invalid, rows = 3, ...resto }, ref) {
    const props = usePropsDeCampo(resto);
    const conError = invalid ?? props['aria-invalid'] === true;

    return (
      <textarea
        ref={ref}
        rows={rows}
        className={`${CLASES_CONTROL} ${
          conError ? CLASES_CONTROL_BORDE.error : CLASES_CONTROL_BORDE.normal
        } ${className}`}
        {...props}
      />
    );
  },
);
