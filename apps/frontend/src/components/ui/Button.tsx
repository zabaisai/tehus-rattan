import { forwardRef } from 'react';

export type VarianteBoton =
  | 'primary'
  | 'accent'
  | 'secondary'
  | 'quiet'
  | 'danger';
export type TamanoBoton = 'sm' | 'md';

/**
 * Botón del sistema TAKTO.
 *
 * EXISTE PARA QUE LAS REGLAS DE MARCA NO SE PUEDAN INCUMPLIR. El manual dice
 * que un botón naranja lleva texto **navy**, nunca blanco, porque blanco sobre
 * #FF6A00 no alcanza el contraste mínimo. Escrito a mano en cada pantalla, esa
 * regla se rompe la primera vez que alguien copia y pega un botón; codificada
 * aquí, no hay forma de romperla sin editar este archivo.
 *
 * Lo mismo con el foco: el anillo visible es obligatorio para quien navega con
 * teclado y es lo primero que desaparece cuando cada botón trae sus clases.
 */
const VARIANTES: Record<VarianteBoton, string> = {
  // Acción principal: navy de marca.
  primary:
    'bg-brand-primary text-white hover:bg-primary-900 disabled:bg-neutral-300 disabled:text-neutral-500',
  // Acento naranja. TEXTO NAVY, no blanco: es la regla del manual.
  accent:
    'bg-brand-secondary text-brand-primary hover:bg-secondary-600 disabled:bg-secondary-200 disabled:text-neutral-500',
  secondary:
    'border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50 disabled:text-neutral-400',
  quiet:
    'text-neutral-600 hover:bg-neutral-100 disabled:text-neutral-400 disabled:hover:bg-transparent',
  // Rojo de estado, no un rojo cualquiera.
  danger:
    'bg-status-error text-white hover:bg-secondary-800 disabled:bg-neutral-300',
};

const TAMANOS: Record<TamanoBoton, string> = {
  sm: 'px-2.5 py-1.5 text-xs gap-1.5',
  md: 'px-3 py-2 text-sm gap-2',
};

const BASE =
  'inline-flex items-center justify-center rounded-md font-medium transition-colors ' +
  // Foco visible y consistente. `focus-visible` y no `focus` para que no
  // aparezca al hacer clic con el ratón, que es ruido.
  'outline-none focus-visible:ring-2 focus-visible:ring-line-focus focus-visible:ring-offset-1 ' +
  'disabled:cursor-not-allowed';

export interface PropsBoton
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: VarianteBoton;
  size?: TamanoBoton;
}

export const Button = forwardRef<HTMLButtonElement, PropsBoton>(
  function Button(
    { variant = 'primary', size = 'md', className = '', type, ...resto },
    ref,
  ) {
    return (
      <button
        ref={ref}
        // `type="button"` por defecto: dentro de un formulario, un botón sin
        // tipo envía el formulario. Es el origen de "se guardó solo al pulsar
        // cancelar", y basta con olvidarlo una vez.
        type={type ?? 'button'}
        className={`${BASE} ${VARIANTES[variant]} ${TAMANOS[size]} ${className}`}
        {...resto}
      />
    );
  },
);
