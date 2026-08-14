import { useCallback, useSyncExternalStore } from 'react';

/**
 * Si el viewport cumple una consulta de medios.
 *
 * Existe porque hay decisiones que NO son de estilo y por tanto no pueden vivir
 * solo en CSS: a partir de 1280 px la ficha del contacto cabe como tercera
 * columna y se abre sola; por debajo sería un cajón encima del hilo, así que
 * empieza cerrada. Eso cambia lo que se *monta*, no solo cómo se ve, y con
 * `hidden` en CSS el panel seguiría pidiendo su consulta al servidor.
 *
 * Va con `useSyncExternalStore` y no con estado más efecto: `matchMedia` ES una
 * fuente externa, y suscribirse a ella con `useState` obliga a un `setState`
 * dentro del efecto —lo que React desaconseja y el linter marca— además de
 * dejar una ventana en la que la pantalla ya se pintó con el valor equivocado.
 *
 * En el servidor devuelve `false`: allí no hay ventana, y suponer que es ancha
 * haría que el primer pintado dibujara un panel que luego desaparece.
 */
export function useConsultaDeMedios(consulta: string): boolean {
  const suscribir = useCallback(
    (avisar: () => void) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const mq = window.matchMedia(consulta);
      // `addListener` es el nombre viejo; algún navegador todavía en uso no
      // trae `addEventListener` en `MediaQueryList`.
      if (mq.addEventListener) mq.addEventListener('change', avisar);
      else mq.addListener(avisar);
      return () => {
        if (mq.removeEventListener) mq.removeEventListener('change', avisar);
        else mq.removeListener(avisar);
      };
    },
    [consulta],
  );

  const leer = useCallback(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(consulta).matches;
  }, [consulta]);

  return useSyncExternalStore(suscribir, leer, () => false);
}

/**
 * El ancho a partir del cual la ficha del contacto cabe como columna.
 *
 * 1280 px es el `xl` de Tailwind, y es el mismo número que usa la clase que
 * pinta la ficha como columna. Si se cambia uno hay que cambiar el otro: por
 * eso está escrito aquí una sola vez y se importa.
 */
export const ANCHO_TRES_PANELES = '(min-width: 1280px)';
