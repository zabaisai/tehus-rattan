import { Injectable } from '@nestjs/common';
import { PeticionIa, ProveedorIa, RespuestaIa } from './flowbot.ia.provider';

/**
 * Proveedor de IA FALSO, contractual.
 *
 * Implementa el mismo `ProveedorIa` que implementaría uno real y devuelve el
 * mismo `RespuestaIa`, así que todo lo que envuelve al proveedor —redacción de
 * PII, topes de gasto, prompt del sistema, validación de la salida, decisión
 * de reserva— se ejercita exactamente igual. Lo único que no ocurre es la
 * petición HTTP y el cargo en la factura.
 *
 * ES EL ÚNICO REGISTRADO HOY, y es deliberado: sin credenciales reales no se
 * puede implementar uno de verdad, y fingir que existe sería peor que decir
 * que falta. Añadir el real es registrar otra clase; no se toca ni un nodo.
 *
 * ELIGE DE FORMA DETERMINISTA. Un doble que responde al azar convierte cada
 * prueba en una moneda al aire: si el nodo se reintenta, tiene que caer por la
 * misma rama, igual que exige el reparto por porcentaje del motor.
 */
@Injectable()
export class ProveedorIaFalso implements ProveedorIa {
  readonly nombre = 'simulado';

  /** Respuesta fija que puede imponer una prueba. */
  private forzada: Partial<RespuestaIa> | null = null;
  private fallo = false;

  readonly peticiones: PeticionIa[] = [];

  forzar(respuesta: Partial<RespuestaIa>): void {
    this.forzada = respuesta;
    this.fallo = false;
  }

  forzarFallo(): void {
    this.fallo = true;
    this.forzada = null;
  }

  limpiar(): void {
    this.forzada = null;
    this.fallo = false;
    this.peticiones.length = 0;
  }

  async completar(peticion: PeticionIa): Promise<RespuestaIa> {
    // La petición se guarda TAL COMO LLEGA, ya redactada por el adaptador. Es
    // lo que permite a una prueba comprobar que el teléfono no salió.
    this.peticiones.push(peticion);

    if (this.fallo) {
      return {
        ok: false,
        confianza: 0,
        tokens: 0,
        costMillis: 0,
        errorCode: 'ia-simulada-fallo',
      };
    }
    if (this.forzada) {
      return {
        ok: true,
        confianza: 0.9,
        tokens: 10,
        costMillis: 0,
        ...this.forzada,
      };
    }

    if (peticion.opciones && peticion.opciones.length > 0) {
      // Determinista: la elección depende del texto, no del azar. La misma
      // pregunta da siempre la misma rama, que es lo que un motor con
      // reintentos necesita.
      const indice = huella(peticion.usuario) % peticion.opciones.length;
      return {
        ok: true,
        eleccion: peticion.opciones[indice],
        confianza: 0.85,
        tokens: 12,
        costMillis: 0,
      };
    }

    return {
      ok: true,
      texto: `[respuesta simulada de ${peticion.modelo}]`,
      confianza: 0.85,
      tokens: 12,
      costMillis: 0,
    };
  }
}

/** Huella estable de una cadena. No es criptográfica: solo determinista. */
function huella(texto: string): number {
  let h = 0;
  for (let i = 0; i < texto.length; i += 1) {
    h = (h * 31 + texto.charCodeAt(i)) >>> 0;
  }
  return h;
}
