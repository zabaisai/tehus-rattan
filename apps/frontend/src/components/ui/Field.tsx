'use client';

import { createContext, useContext, useId } from 'react';

/**
 * Clases compartidas por TODO campo de formulario del producto.
 *
 * EXISTE POR EL MISMO MOTIVO QUE `Button`: para que una regla no se pueda
 * incumplir por copiar y pegar. Aquí la regla es el foco.
 *
 * El producto escribe `outline-none` en prácticamente todos sus campos para
 * quitar el contorno azul del navegador, y cuando eso se hace sin poner nada
 * en su lugar, quien navega con teclado deja de saber dónde está. `globals.css`
 * repone un `outline` a nivel de elemento, pero el borde del propio campo
 * también tiene que moverse: si no, el campo enfocado se ve idéntico al de al
 * lado. Ese par —borde navy + anillo— vive aquí y en un solo sitio.
 *
 * El navy de foco es `line-focus`, el token de marca. Escrito a mano acabó
 * siendo `neutral-500` en el login, `#A57014` en el onboarding y ningún color
 * en varias pantallas: tres focos distintos para la misma acción.
 */
export const CLASES_CONTROL =
  'w-full rounded-md border bg-white px-3 py-2 text-sm text-content-primary ' +
  'placeholder:text-content-disabled transition-colors ' +
  'outline-none focus:border-line-focus focus:ring-1 focus:ring-line-focus ' +
  'disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-content-disabled';

/** Borde normal frente a borde de error. El rojo es el de ESTADO, no uno suelto. */
export const CLASES_CONTROL_BORDE = {
  normal: 'border-neutral-300',
  error: 'border-status-error focus:border-status-error focus:ring-status-error',
} as const;

interface ContextoCampo {
  id: string;
  /** Id del texto de ayuda y/o del error, para `aria-describedby`. */
  describedBy?: string;
  invalido: boolean;
}

const CampoContext = createContext<ContextoCampo | null>(null);

/**
 * Conecta un control con la etiqueta, la ayuda y el error que lo rodean.
 *
 * Devuelve las props que el control debe recibir. Va por contexto y no por
 * props explícitas porque el cableado accesible —`id`, `aria-describedby`,
 * `aria-invalid`— es justo lo que se omite al escribir el campo número
 * veinte, y omitirlo deja el error visible para quien ve la pantalla e
 * invisible para quien la escucha.
 */
export function usePropsDeCampo<
  // Genérico y no una forma fija: `aria-invalid` de React admite además
  // `"grammar"` y `"spelling"`, y fijar el tipo aquí obligaría a cada control
  // a estrechar el suyo.
  P extends {
    id?: string;
    'aria-describedby'?: string;
    'aria-invalid'?: React.AriaAttributes['aria-invalid'];
  },
>(propias: P): P {
  const campo = useContext(CampoContext);
  if (!campo) return propias;

  return {
    ...propias,
    id: propias.id ?? campo.id,
    'aria-describedby': propias['aria-describedby'] ?? campo.describedBy,
    'aria-invalid': propias['aria-invalid'] ?? (campo.invalido || undefined),
  };
}

export interface PropsCampo {
  label: string;
  /** Texto de ayuda permanente. Se anuncia junto al campo, no en su lugar. */
  hint?: string;
  /** Mensaje de error. Su presencia marca el campo como inválido. */
  error?: string;
  /** Marca visual de obligatorio. El `required` real va en el control. */
  required?: boolean;
  /** Oculta la etiqueta a la vista pero la conserva para lectores de pantalla. */
  labelOculta?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function Field({
  label,
  hint,
  error,
  required = false,
  labelOculta = false,
  className = '',
  children,
}: PropsCampo) {
  const base = useId();
  const id = `${base}-control`;
  const idHint = hint ? `${base}-hint` : undefined;
  const idError = error ? `${base}-error` : undefined;

  // Ambos, y en este orden: quien usa lector de pantalla necesita oír la ayuda
  // Y el error, no solo el último que se haya escrito.
  const describedBy = [idHint, idError].filter(Boolean).join(' ') || undefined;

  return (
    <CampoContext.Provider value={{ id, describedBy, invalido: Boolean(error) }}>
      <div className={className}>
        <label
          htmlFor={id}
          className={
            labelOculta
              ? 'sr-only'
              : 'mb-1.5 block text-sm font-medium text-neutral-700'
          }
        >
          {label}
          {required && (
            // `aria-hidden`: el asterisco es una pista visual. Lo obligatorio
            // se anuncia por el `required` del control, no leyendo "asterisco".
            <span aria-hidden="true" className="ml-0.5 text-status-error">
              *
            </span>
          )}
        </label>

        {children}

        {hint && (
          <p id={idHint} className="mt-1.5 text-xs text-content-secondary">
            {hint}
          </p>
        )}

        {error && (
          // `role="alert"`: el error aparece después de intentar enviar, y sin
          // esto un lector de pantalla no lo menciona nunca.
          <p
            id={idError}
            role="alert"
            className="mt-1.5 text-xs font-medium text-status-error"
          >
            {error}
          </p>
        )}
      </div>
    </CampoContext.Provider>
  );
}
