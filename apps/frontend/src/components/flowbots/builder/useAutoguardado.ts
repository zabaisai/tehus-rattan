'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  flowbots,
  esConflictoDeBorrador,
  type ConflictoBorrador,
  type GrafoFlow,
} from '@/lib/flowbots';

export type EstadoGuardado =
  | 'limpio'
  | 'pendiente'
  | 'guardando'
  | 'guardado'
  | 'sin-conexion'
  | 'error'
  | 'conflicto';

const ESPERA_MS = 1_200;

/**
 * Guardado automático del borrador.
 *
 * NO SE GUARDA EN CADA TECLA. Escribir un mensaje de dos líneas dispararía
 * cuarenta peticiones, cada una subiendo la revisión, y bastaría con que dos
 * se cruzaran para provocar un conflicto contra uno mismo.
 *
 * «HAY CAMBIOS SIN GUARDAR» SE DEDUCE, no se apunta. Es exactamente «el grafo
 * en pantalla no es el último que confirmó el servidor», así que guardarlo
 * aparte solo abre la puerta a que las dos versiones de la verdad discrepen y
 * el indicador diga «Guardado» con cambios pendientes encima.
 *
 * LA REVISIÓN SOLO AVANZA CUANDO EL SERVIDOR CONFIRMA. Darla por buena al
 * enviar haría que un guardado fallido dejara al editor creyendo una revisión
 * que no existe, y a partir de ahí todo daría 409 sin que nadie tocara nada.
 *
 * UN 409 NO PISA NADA. No se recarga el grafo remoto por las bravas ni se
 * intenta mezclar los dos: fusionar dos grafos sin una estrategia segura puede
 * producir un flujo que nadie escribió y que además parece correcto. Se para,
 * se avisa y decide la persona.
 */
export function useAutoguardado({
  botId,
  grafo,
  revisionInicial,
  activo,
}: {
  botId: string;
  grafo: GrafoFlow | null;
  revisionInicial: number;
  activo: boolean;
}) {
  // `null` significa «todavía no se ha guardado nada en esta sesión», que no
  // es lo mismo que «no hay cambios».
  const [confirmado, setConfirmado] = useState<GrafoFlow | null>(grafo);
  const [enCurso, setEnCurso] = useState(false);
  const [fallo, setFallo] = useState<'error' | 'sin-conexion' | null>(null);
  const [conflicto, setConflicto] = useState<ConflictoBorrador | null>(null);
  const [guardadoEn, setGuardadoEn] = useState<string | null>(null);

  const revision = useRef(revisionInicial);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const grafoRef = useRef<GrafoFlow | null>(grafo);
  const enVuelo = useRef(false);

  // La ref se actualiza en un efecto y no durante el render: escribir en una
  // ref mientras se dibuja hace que lo leído dependa de en qué momento se
  // interrumpió el render, y React puede interrumpirlo.
  useEffect(() => {
    grafoRef.current = grafo;
  }, [grafo]);

  const guardar = useCallback(async (): Promise<boolean> => {
    const actual = grafoRef.current;
    if (!actual || enVuelo.current) return false;

    enVuelo.current = true;
    setEnCurso(true);
    setFallo(null);
    try {
      const r = await flowbots.guardarBorrador(botId, actual, revision.current);
      revision.current = r.revision;
      setConfirmado(actual);
      setGuardadoEn(r.actualizadoEn);
      setConflicto(null);
      return true;
    } catch (e) {
      const choque = esConflictoDeBorrador(e);
      if (choque) {
        setConflicto(choque);
        return false;
      }
      // Sin red el navegador no distingue «servidor caído» de «wifi malo»,
      // pero para quien edita sí cambia: uno se arregla solo.
      setFallo(
        typeof navigator !== 'undefined' && navigator.onLine === false
          ? 'sin-conexion'
          : 'error',
      );
      return false;
    } finally {
      enVuelo.current = false;
      setEnCurso(false);
    }
  }, [botId]);

  const pendiente = grafo !== null && grafo !== confirmado;

  useEffect(() => {
    if (!activo || !pendiente) return;
    // Un conflicto sin resolver NO se reintenta solo: cada reintento
    // devolvería otro 409 y el aviso parpadearía sin parar.
    if (conflicto) return;

    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => void guardar(), ESPERA_MS);

    return () => {
      if (temporizador.current) clearTimeout(temporizador.current);
    };
  }, [grafo, activo, pendiente, conflicto, guardar]);

  /** Guardar ya, sin esperar el rebote. Para el botón y antes de publicar. */
  const guardarAhora = useCallback(async () => {
    if (temporizador.current) clearTimeout(temporizador.current);
    return guardar();
  }, [guardar]);

  /**
   * Aceptar lo que hay en el servidor.
   *
   * Antes de llamarla, la interfaz ofrece descargar el trabajo local: aceptar
   * lo remoto sin esa salida es perder lo escrito sin poder recuperarlo.
   */
  const aceptarRemoto = useCallback(() => {
    if (!conflicto) return null;
    revision.current = conflicto.revisionActual;
    setConfirmado(conflicto.graphActual);
    setConflicto(null);
    setFallo(null);
    return conflicto.graphActual;
  }, [conflicto]);

  const estado: EstadoGuardado = conflicto
    ? 'conflicto'
    : enCurso
      ? 'guardando'
      : fallo
        ? fallo
        : pendiente
          ? 'pendiente'
          : guardadoEn
            ? 'guardado'
            : 'limpio';

  return {
    estado,
    guardadoEn,
    conflicto,
    guardarAhora,
    aceptarRemoto,
  };
}

/** Aviso del navegador al cerrar con cambios sin guardar. */
export function useAvisoAlSalir(hayPendiente: boolean) {
  useEffect(() => {
    if (!hayPendiente) return;
    const alSalir = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // El texto lo pone el navegador; lo único que se puede hacer es pedir
      // que pregunte.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', alSalir);
    return () => window.removeEventListener('beforeunload', alSalir);
  }, [hayPendiente]);
}
