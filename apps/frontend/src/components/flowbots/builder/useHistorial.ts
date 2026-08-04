'use client';

import { useCallback, useState } from 'react';
import type { GrafoFlow } from '@/lib/flowbots';

const MAXIMO = 50;

interface Historia {
  pasado: GrafoFlow[];
  presente: GrafoFlow | null;
  futuro: GrafoFlow[];
}

/**
 * Deshacer y rehacer.
 *
 * LOS TRES MONTONES VIVEN EN UN SOLO ESTADO, no en refs. Si «se puede
 * deshacer» se leyera de una ref, el botón no se volvería a dibujar al primer
 * cambio: seguiría gris justo cuando ya hay algo que deshacer, que es el
 * momento exacto en el que alguien lo busca.
 *
 * MOVER UN NODO NO ES UN PASO POR SÍ SOLO. Arrastrar produce decenas de
 * posiciones intermedias; si cada una entrara, pulsar Ctrl+Z veinte veces
 * devolvería el nodo píxel a píxel en vez de deshacer lo último que se hizo de
 * verdad. Por eso el editor apunta al historial cuando EMPIEZA el arrastre y
 * mueve sin historial mientras dura.
 *
 * REHACER SE PIERDE AL EDITAR, que es lo que espera todo el mundo: si se
 * deshace y luego se cambia otra cosa, la rama vieja ya no lleva a ninguna
 * parte.
 */
export function useHistorial(inicial: GrafoFlow | null) {
  const [historia, setHistoria] = useState<Historia>({
    pasado: [],
    presente: inicial,
    futuro: [],
  });

  /** Reemplaza el grafo apuntando el anterior en el historial. */
  const aplicar = useCallback(
    (siguiente: GrafoFlow | ((previo: GrafoFlow) => GrafoFlow)) => {
      setHistoria((h) => {
        if (!h.presente) return h;
        const nuevo =
          typeof siguiente === 'function' ? siguiente(h.presente) : siguiente;
        if (nuevo === h.presente) return h;
        return {
          pasado: [...h.pasado, h.presente].slice(-MAXIMO),
          presente: nuevo,
          futuro: [],
        };
      });
    },
    [],
  );

  /** Cambia el grafo SIN tocar el historial: arrastres en curso. */
  const aplicarSinHistorial = useCallback(
    (siguiente: GrafoFlow | ((previo: GrafoFlow) => GrafoFlow)) => {
      setHistoria((h) => {
        if (!h.presente) return h;
        const nuevo =
          typeof siguiente === 'function' ? siguiente(h.presente) : siguiente;
        return nuevo === h.presente ? h : { ...h, presente: nuevo };
      });
    },
    [],
  );

  /** Apunta el estado actual como punto al que volver. */
  const marcar = useCallback(() => {
    setHistoria((h) =>
      h.presente
        ? {
            pasado: [...h.pasado, h.presente].slice(-MAXIMO),
            presente: h.presente,
            futuro: [],
          }
        : h,
    );
  }, []);

  const deshacer = useCallback(() => {
    setHistoria((h) => {
      const anterior = h.pasado[h.pasado.length - 1];
      if (!anterior || !h.presente) return h;
      return {
        pasado: h.pasado.slice(0, -1),
        presente: anterior,
        futuro: [h.presente, ...h.futuro].slice(0, MAXIMO),
      };
    });
  }, []);

  const rehacer = useCallback(() => {
    setHistoria((h) => {
      const siguiente = h.futuro[0];
      if (!siguiente || !h.presente) return h;
      return {
        pasado: [...h.pasado, h.presente].slice(-MAXIMO),
        presente: siguiente,
        futuro: h.futuro.slice(1),
      };
    });
  }, []);

  /**
   * Sustituye todo y BORRA el historial.
   *
   * Se usa al cargar otro grafo o al aceptar el del servidor tras un
   * conflicto: dejar el historial vivo permitiría «deshacer» hasta un estado
   * que mezcla el flujo de otra persona con el propio.
   */
  const reiniciar = useCallback((grafo: GrafoFlow | null) => {
    setHistoria({ pasado: [], presente: grafo, futuro: [] });
  }, []);

  return {
    grafo: historia.presente,
    aplicar,
    aplicarSinHistorial,
    marcar,
    deshacer,
    rehacer,
    reiniciar,
    puedeDeshacer: historia.pasado.length > 0,
    puedeRehacer: historia.futuro.length > 0,
  };
}
