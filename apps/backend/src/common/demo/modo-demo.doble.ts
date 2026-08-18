import type { ModoDemoService } from './modo-demo.service';
import { ModoDemoError } from './modo-demo.service';

/**
 * Doble del guardarraíl de modo demo para pruebas.
 *
 * Vive junto al servicio y no en `test/` porque lo necesitan tanto las
 * unitarias de `src/` como las e2e de `test/`, y duplicarlo en los dos sitios
 * es como acaban divergiendo. No se importa desde código de producto: no
 * aparece en ningún módulo de Nest.
 *
 * Por defecto NO es demo, que es lo que era el mundo antes de este
 * incremento: así una prueba existente sigue midiendo lo que medía.
 */
export function dobleModoDemo(esDemo = false): ModoDemoService {
  return {
    esDemo: async () => esDemo,
    bloquearSiDemo: async (_companyId: string, accion: string) => {
      if (esDemo) throw new ModoDemoError(accion);
    },
  } as unknown as ModoDemoService;
}
