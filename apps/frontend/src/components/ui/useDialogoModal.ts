'use client';

import { useEffect, useRef } from 'react';

/**
 * Comportamiento compartido de todo diálogo modal: bloqueo del fondo, Escape,
 * foco atrapado y foco devuelto.
 *
 * EXISTE PORQUE HABÍA CUATRO IMPLEMENTACIONES Y NINGUNA COMPLETA. `Modal`
 * bloqueaba el fondo y escuchaba Escape pero dejaba escapar el foco al cuerpo
 * de la página; el cajón lateral movía el fondo pero no el foco;
 * `EliminarContactoDialog` y `RetirarEmbudoDialog` se anunciaban con
 * `aria-modal="true"` sin bloquear el fondo, sin Escape y sin tocar el foco.
 *
 * `aria-modal="true"` le dice al lector de pantalla que el resto de la página
 * no existe. Si el tabulador sí puede salir, la promesa es falsa: el usuario se
 * pierde fuera de un diálogo que su lector sigue describiendo como el único
 * contenido. Por eso el atrapado no es un adorno.
 *
 * LA PILA. Escape se escuchaba en `document` desde cada diálogo, así que con
 * uno anidado —«Agregar producto» dentro de la oportunidad— una sola pulsación
 * disparaba los dos `onCerrar`. Aquí solo responde el último de la pila.
 */

const SELECTOR_ENFOCABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),' +
  'select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

interface Entrada {
  onCerrar: () => void;
  panel: () => HTMLElement | null;
}

const pila: Entrada[] = [];
let scrollPrevio: string | null = null;

function enfocables(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(SELECTOR_ENFOCABLE)].filter(
    // `offsetParent` nulo = oculto. Un campo invisible en el orden de
    // tabulación es peor que no tenerlo: el foco desaparece de la vista.
    (el) => el.offsetParent !== null || el === panel,
  );
}

function alPulsarTecla(e: KeyboardEvent) {
  const cima = pila[pila.length - 1];
  if (!cima) return;

  if (e.key === 'Escape') {
    e.stopPropagation();
    cima.onCerrar();
    return;
  }

  if (e.key !== 'Tab') return;

  const panel = cima.panel();
  if (!panel) return;

  const lista = enfocables(panel);
  if (lista.length === 0) {
    // Sin nada enfocable dentro, el foco se queda en el panel y no sale.
    e.preventDefault();
    panel.focus();
    return;
  }

  const primero = lista[0];
  const ultimo = lista[lista.length - 1];
  const activo = document.activeElement as HTMLElement | null;

  // Fuera del panel (o en el panel mismo): el ciclo vuelve a entrar.
  if (!activo || !panel.contains(activo) || activo === panel) {
    e.preventDefault();
    (e.shiftKey ? ultimo : primero).focus();
    return;
  }

  if (e.shiftKey && activo === primero) {
    e.preventDefault();
    ultimo.focus();
  } else if (!e.shiftKey && activo === ultimo) {
    e.preventDefault();
    primero.focus();
  }
}

export function useDialogoModal({
  activo,
  onCerrar,
  refPanel,
}: {
  /** El diálogo está abierto. Para modales que se montan/desmontan, `true`. */
  activo: boolean;
  onCerrar: () => void;
  refPanel: React.RefObject<HTMLElement | null>;
}) {
  // El manejador vive en una ref para que la pila no dependa de la identidad
  // de la función: si no, cada render la reemplazaría y el registro bailaría.
  // Se actualiza en un efecto, no durante el render: escribir una ref mientras
  // se renderiza rompe el renderizado concurrente de React.
  const cerrarRef = useRef(onCerrar);
  useEffect(() => {
    cerrarRef.current = onCerrar;
  }, [onCerrar]);

  useEffect(() => {
    if (!activo) return;

    const disparador = document.activeElement as HTMLElement | null;

    const entrada: Entrada = {
      onCerrar: () => cerrarRef.current(),
      panel: () => refPanel.current,
    };
    pila.push(entrada);

    if (pila.length === 1) {
      scrollPrevio = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      // `capture`: así el diálogo ve Escape antes que cualquier campo que lo
      // use para otra cosa (un desplegable nativo, por ejemplo).
      document.addEventListener('keydown', alPulsarTecla, true);
    }

    // Foco inicial: el primer elemento útil, y el panel solo si no hay ninguno.
    const panel = refPanel.current;
    if (panel) {
      const lista = enfocables(panel);
      (lista[0] ?? panel).focus();
    }

    return () => {
      const i = pila.indexOf(entrada);
      if (i !== -1) pila.splice(i, 1);

      if (pila.length === 0) {
        document.body.style.overflow = scrollPrevio ?? '';
        scrollPrevio = null;
        document.removeEventListener('keydown', alPulsarTecla, true);
      }

      // Devolver el foco a quien abrió. Sin esto, quien navega con teclado
      // vuelve al principio de la página cada vez que cierra algo.
      if (disparador && document.contains(disparador)) disparador.focus();
    };
  }, [activo, refPanel]);
}
