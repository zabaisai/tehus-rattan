'use client';

import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

/**
 * La explicación de un control que solo enseña un icono.
 *
 * POR QUÉ EXISTE, Y POR QUÉ NO EXISTÍA ANTES. El bloque de branding decidió a
 * propósito no crear `Tooltip`: la QA de entonces no encontró ni tres
 * implementaciones repetidas ni un defecto que lo justificara, y crear
 * primitivas para tachar una lista es trabajo sin beneficio. Ahora sí hay
 * defecto, encontrado por una persona mirando la pantalla: en la papelera
 * había un icono cuyo significado no se podía averiguar de ninguna manera.
 *
 * POR QUÉ NO BASTA `title`. Es lo que había, y es lo que falló:
 *
 *   · tarda alrededor de un segundo, y quien pasa el cursor y no ve nada
 *     concluye que no hay nada;
 *   · NO aparece nunca al llegar por teclado, así que la mitad de la gente no
 *     lo tiene;
 *   · lo pinta el sistema operativo, no el producto;
 *   · no se puede leer con las herramientas con las que se mide la pantalla.
 *
 * QUÉ ES Y QUÉ NO ES. Es una DESCRIPCIÓN (`aria-describedby`), no el nombre
 * del control: el nombre lo da el `aria-label` del botón. Si fuera el nombre,
 * un lector de pantalla leería la misma frase dos veces. No lleva foco, no
 * atrapa el teclado y no es un diálogo: para eso está `useDialogoModal`.
 *
 * POSICIÓN FIJA, A PROPÓSITO. Se coloca con `position: fixed` a partir del
 * rectángulo del disparador en vez de con un `absolute` dentro de la fila.
 * La tabla de Contactos vive en un contenedor con `overflow-x: auto`, y en CSS
 * eso convierte el otro eje en `auto` también: un `absolute` dentro quedaría
 * RECORTADO por arriba justo en la primera fila. Es el mismo tipo de trampa
 * que costó una ronda entera en el incremento 2.3, con el `sr-only` que se
 * escapaba de `main`.
 *
 * Se oculta al desplazar en vez de reposicionarse: un tooltip que persigue al
 * cursor mientras la lista se mueve es peor que uno que desaparece, y evita
 * tener que escuchar el scroll de cada antepasado.
 */

const MARGEN = 8;

export function Tooltip({
  texto,
  children,
}: {
  /** Vacío = no hay nada que explicar y el envoltorio no hace nada. */
  texto: string;
  children: React.ReactElement<{ 'aria-describedby'?: string }>;
}) {
  const id = useId();
  const contenedor = useRef<HTMLSpanElement>(null);
  const [posicion, setPosicion] = useState<{
    top: number;
    left: number;
  } | null>(null);

  const mostrar = useCallback(() => {
    const caja = contenedor.current?.getBoundingClientRect();
    if (!caja) return;
    // Encima y centrado. `top` puede quedar negativo en la primera fila de una
    // pantalla corta; el propio tooltip se recoloca abajo en ese caso.
    setPosicion({ top: caja.top, left: caja.left + caja.width / 2 });
  }, []);

  const ocultar = useCallback(() => setPosicion(null), []);

  // Mientras se ve, cualquier desplazamiento o cambio de tamaño lo invalida:
  // la posición se calculó contra un rectángulo que ya se movió. `capture`
  // para enterarse también del scroll de la tabla, que no burbujea.
  const hayPosicion = posicion !== null;
  useEffect(() => {
    if (!hayPosicion) return;
    window.addEventListener('scroll', ocultar, { capture: true, passive: true });
    window.addEventListener('resize', ocultar, { passive: true });
    return () => {
      window.removeEventListener('scroll', ocultar, { capture: true });
      window.removeEventListener('resize', ocultar);
    };
  }, [hayPosicion, ocultar]);

  if (!texto.trim()) return children;

  const visible = posicion !== null;
  const debajo = visible && posicion.top < 40;

  return (
    <span
      // Los eventos van AQUÍ y no en el hijo: un control inerte
      // (`aria-disabled`, o con `pointer-events` retirados) puede no emitirlos,
      // y ese es justo el caso en el que la explicación más falta hace.
      ref={contenedor}
      className="relative inline-flex"
      onMouseEnter={mostrar}
      onMouseLeave={ocultar}
      onFocusCapture={mostrar}
      onBlurCapture={ocultar}
      onKeyDown={(e) => {
        // Escape lo cierra sin mover el foco: puede estar tapando lo de abajo.
        if (e.key === 'Escape' && visible) {
          e.stopPropagation();
          ocultar();
        }
      }}
    >
      {cloneElement(children, {
        'aria-describedby': visible ? id : undefined,
      })}

      {visible && (
        <span
          role="tooltip"
          id={id}
          style={{
            position: 'fixed',
            top: debajo ? posicion.top + MARGEN * 3 : posicion.top - MARGEN,
            left: posicion.left,
            transform: debajo
              ? 'translate(-50%, 0)'
              : 'translate(-50%, -100%)',
          }}
          className="pointer-events-none z-50 max-w-[16rem] whitespace-normal rounded-md bg-surface-inverse px-2 py-1 text-center text-xs font-medium text-content-inverse shadow-md"
        >
          {texto}
        </span>
      )}
    </span>
  );
}
