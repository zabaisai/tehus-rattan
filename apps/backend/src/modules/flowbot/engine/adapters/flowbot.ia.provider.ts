/**
 * Proveedor de IA.
 *
 * EL MOTOR NO CONOCE NINGUNO. No importa OpenAI, ni Anthropic, ni ninguna
 * librería de cliente: solo esta interfaz. Cambiar de proveedor —o quitarlo—
 * es registrar otra implementación, no tocar los nodos ni el intérprete.
 *
 * Es la misma razón por la que el CRM y WhatsApp son puertos: el día que la
 * empresa cambie de proveedor, el flujo que un cliente diseñó hace un año
 * tiene que seguir funcionando igual.
 */

/** Lo que se le pide al proveedor. Ya redactado y acotado. */
export interface PeticionIa {
  /** Instrucciones de la EMPRESA, no del nodo. */
  sistema: string;
  /** Lo que pide el nodo, con las variables ya sustituidas. */
  usuario: string;
  /**
   * Si viene, la respuesta tiene que ser UNA de estas.
   *
   * Es lo que convierte un modelo de lenguaje en algo que un motor
   * determinista puede usar: sin opciones cerradas, la salida es texto libre y
   * el flujo no puede ramificar sobre ella sin adivinar.
   */
  opciones?: string[];
  modelo: string;
  maxTokens: number;
  timeoutMs: number;
}

export interface RespuestaIa {
  ok: boolean;
  /** La opción elegida, cuando se pidieron opciones. */
  eleccion?: string | null;
  /** Texto libre, cuando no. */
  texto?: string;
  /** 0–1. Por debajo del umbral del nodo se sale por la rama de reserva. */
  confianza: number;
  tokens: number;
  /** Milésimas de la moneda, como `FlowBotMetric`. Nunca coma flotante. */
  costMillis: number;
  /** Clasificador ya redactado. Nunca la respuesta cruda del proveedor. */
  errorCode?: string;
}

export interface ProveedorIa {
  /** Identificador estable: el que guarda `FlowBotSettings.aiProvider`. */
  readonly nombre: string;
  completar(peticion: PeticionIa, apiKey: string): Promise<RespuestaIa>;
}

export const REGISTRO_IA = Symbol('RegistroProveedoresIa');

/**
 * Registro de proveedores disponibles.
 *
 * HOY SOLO CONTIENE EL FALSO, y eso es deliberado: sin credenciales reales no
 * se puede implementar un proveedor de verdad, y fingir que existe sería peor
 * que decir que falta. El validador impide publicar un flujo con IA cuando el
 * proveedor configurado no está registrado, así que el autor lo ve en el
 * editor y no en el silencio de un bot que dejó de contestar.
 */
export class RegistroProveedoresIa {
  private readonly proveedores = new Map<string, ProveedorIa>();

  registrar(proveedor: ProveedorIa): void {
    this.proveedores.set(proveedor.nombre, proveedor);
  }

  obtener(nombre: string | null | undefined): ProveedorIa | null {
    if (!nombre) return null;
    return this.proveedores.get(nombre) ?? null;
  }

  disponibles(): string[] {
    return [...this.proveedores.keys()].sort();
  }
}

// ── redacción de PII ──────────────────────────────────────────

/**
 * Quita del texto lo que no debe salir del CRM.
 *
 * LO QUE SALE NO VUELVE. Un proveedor de IA guarda las peticiones para
 * depuración, a veces las usa para entrenar, y siempre las almacena en otra
 * jurisdicción. Un teléfono o una cédula que se le manda deja de estar bajo el
 * control del CRM para siempre.
 *
 * Se sustituye por un marcador y no se borra: el modelo necesita saber que
 * había un dato ahí para entender la frase. «Mi cédula es [DOCUMENTO]» sigue
 * siendo comprensible; «Mi cédula es» parece una frase cortada.
 *
 * NO ES PERFECTO y no se promete que lo sea: cubre los formatos habituales en
 * Colombia. Por eso existe también el tope de longitud y la posibilidad de
 * apagar la IA entera.
 *
 * HAY AMBIGÜEDADES REALES Y SE RESUELVEN HACIA LA PRIVACIDAD. Un número de
 * diez dígitos en Colombia puede ser un móvil o una cédula, y no hay forma de
 * saber cuál sin contexto. Se marca como teléfono —el patrón va primero— y el
 * dato queda igualmente fuera de la petición, que es lo único que importa
 * aquí. Etiquetarlo mal es un problema de legibilidad; dejarlo pasar sería una
 * fuga.
 */
export function redactarPii(texto: string): string {
  return (
    texto
      // Correos.
      .replace(/[^\s@]+@[^\s@]+\.[^\s@]{2,}/g, '[CORREO]')
      // Teléfonos en E.164 o con separadores. Antes que los documentos: un
      // teléfono sin prefijo se parece a una cédula.
      .replace(/\+\d{1,3}[\s-]?\d[\d\s\-().]{6,20}\d/g, '[TELEFONO]')
      .replace(/\b\d{3}[\s-]?\d{3}[\s-]?\d{4}\b/g, '[TELEFONO]')
      // Documentos: 6 a 12 dígitos seguidos, con o sin puntos de miles.
      .replace(/\b\d{1,3}(?:\.\d{3}){2,3}\b/g, '[DOCUMENTO]')
      .replace(/\b\d{6,12}\b/g, '[DOCUMENTO]')
      // Tarjetas: 13 a 19 dígitos con separadores.
      .replace(/\b(?:\d[ -]?){13,19}\b/g, '[TARJETA]')
  );
}

/** Tope de texto que se manda al proveedor, en caracteres. */
export const MAX_TEXTO_IA = 4000;
