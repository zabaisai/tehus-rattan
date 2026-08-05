'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { flowbots, type GrafoFlow, type ResultadoValidacion } from '@/lib/flowbots';

const ESPERA_MS = 800;

/**
 * Validación contra el servidor.
 *
 * SE VALIDA EN EL SERVIDOR Y NO AQUÍ. Reimplementar las reglas en el editor
 * daría un segundo validador que se queda corto justo donde importa: el
 * servidor rechazaría al publicar algo que el editor daba por bueno, y la
 * persona no tendría forma de saber cuál de los dos miente.
 *
 * LAS PETICIONES VIEJAS SE CANCELAN. Sin eso, tras varios cambios seguidos
 * quedan tres validaciones en vuelo y la última en responder no tiene por qué
 * ser la del grafo actual: se acaba enseñando el error de un grafo que ya no
 * existe, y desaparece al tocar cualquier cosa, lo que parece un fantasma.
 */
export function useValidacion(grafo: GrafoFlow | null, activo: boolean) {
  const [resultado, setResultado] = useState<ResultadoValidacion | null>(null);
  const [validando, setValidando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const aborto = useRef<AbortController | null>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  const validar = useCallback(
    async (objetivo?: GrafoFlow): Promise<ResultadoValidacion | null> => {
      const g = objetivo ?? grafo;
      if (!g) return null;

      aborto.current?.abort();
      const control = new AbortController();
      aborto.current = control;

      setValidando(true);
      setError(null);
      try {
        const r = await flowbots.validar(g, control.signal);
        // Si mientras tanto se lanzó otra, esta ya no manda.
        if (control.signal.aborted) return null;
        setResultado(r);
        return r;
      } catch {
        if (control.signal.aborted) return null;
        setError('No se pudo revisar el flujo. Inténtalo otra vez.');
        return null;
      } finally {
        if (!control.signal.aborted) setValidando(false);
      }
    },
    [grafo],
  );

  useEffect(() => {
    if (!activo || !grafo) return;
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => void validar(grafo), ESPERA_MS);
    return () => {
      if (temporizador.current) clearTimeout(temporizador.current);
    };
  }, [grafo, activo, validar]);

  useEffect(() => () => aborto.current?.abort(), []);

  return { resultado, validando, error, validar };
}
