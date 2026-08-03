/**
 * Variables de FlowBot.
 *
 * SIN `eval`, SIN `new Function`, SIN EXPRESIONES. Una plantilla solo puede
 * hacer una cosa: sustituir `{{ruta.al.dato}}` por un valor del contexto. No
 * hay operadores, ni llamadas, ni acceso a nada que no esté en el contexto que
 * el motor construye explícitamente.
 *
 * Es deliberado. En cuanto una plantilla puede evaluar código, quien edita un
 * flujo puede leer variables de entorno del worker, y el flujo lo edita el
 * cliente, no nosotros.
 */

/** Delimitador. Se admite `{{ x }}` con espacios alrededor. */
const PATRON = /\{\{\s*([a-zA-Z][\w.]*)\s*(?:\|\s*([^}]*?))?\s*\}\}/g;

/**
 * Variables que el motor siempre pone en el contexto.
 *
 * Lista cerrada a propósito: es lo que permite al validador decir «esa
 * variable no existe» antes de publicar, en vez de mandar la palabra
 * `undefined` a un cliente.
 */
export const VARIABLES_SISTEMA: readonly string[] = [
  'contact.name',
  'contact.phone',
  'contact.email',
  'contact.id',
  'company.name',
  'conversation.id',
  'conversation.status',
  'lead.id',
  'lead.title',
  'lead.value',
  'lead.stage',
  'agent.id',
  'agent.name',
  'message.text',
  'message.choice',
  'task.id',
  'ai.intent',
  'ai.confidence',
  'ai.reply',
  'ai.summary',
  'now.date',
  'now.time',
];

/** Contexto de sustitución. Solo datos planos: nada de funciones. */
export type ContextoVariables = Record<string, unknown>;

/**
 * Variables usadas dentro de una configuración, para que el validador pueda
 * comprobar que existen. Recorre textos, listas y objetos anidados.
 */
export function variablesDe(
  valor: unknown,
  encontradas = new Set<string>(),
): Set<string> {
  if (typeof valor === 'string') {
    for (const m of valor.matchAll(PATRON)) encontradas.add(m[1]);
    return encontradas;
  }
  if (Array.isArray(valor)) {
    for (const v of valor) variablesDe(v, encontradas);
    return encontradas;
  }
  if (valor && typeof valor === 'object') {
    for (const v of Object.values(valor as Record<string, unknown>)) {
      variablesDe(v, encontradas);
    }
  }
  return encontradas;
}

/**
 * Lee una ruta con puntos del contexto.
 *
 * Solo baja por objetos planos y NUNCA por claves heredadas: sin ese filtro,
 * `{{constructor.prototype}}` daría acceso a la cadena de prototipos.
 */
function leer(contexto: ContextoVariables, ruta: string): unknown {
  let actual: unknown = contexto;
  for (const parte of ruta.split('.')) {
    if (actual === null || typeof actual !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(actual, parte)) return undefined;
    actual = (actual as Record<string, unknown>)[parte];
  }
  return actual;
}

/**
 * Convierte a texto SOLO lo que tiene representación legible.
 *
 * `String({})` es "[object Object]", y mandarle eso a un cliente por WhatsApp
 * es peor que dejar el hueco. Es el mismo criterio que ya se aplicó al
 * interpolar del chatbot v1 y a la importación de productos.
 */
function aTexto(valor: unknown): string | null {
  if (typeof valor === 'string') return valor;
  if (typeof valor === 'number' || typeof valor === 'boolean')
    return String(valor);
  if (valor instanceof Date) return valor.toISOString();
  return null;
}

export interface OpcionesInterpolacion {
  /**
   * Qué hacer con una variable sin valor:
   *  - `hueco`: deja `{{x}}` tal cual (el validador ya avisó al publicar).
   *  - `vacio`: la sustituye por nada.
   */
  ausente?: 'hueco' | 'vacio';
}

/**
 * Sustituye variables en un texto.
 *
 * Admite un valor por defecto con `{{variable|por defecto}}`, que es lo que
 * evita tener que duplicar el flujo entero solo porque un dato sea opcional.
 */
export function interpolar(
  texto: string,
  contexto: ContextoVariables,
  opciones: OpcionesInterpolacion = {},
): string {
  const ausente = opciones.ausente ?? 'hueco';

  return texto.replace(PATRON, (completo, ruta: string, defecto?: string) => {
    const valor = aTexto(leer(contexto, ruta));
    if (valor !== null && valor !== '') return valor;
    if (defecto !== undefined) return defecto.trim();
    return ausente === 'vacio' ? '' : completo;
  });
}

/**
 * Interpola recursivamente una configuración entera, respetando su forma:
 * los números siguen siendo números y las listas, listas.
 */
export function interpolarConfig<T>(valor: T, contexto: ContextoVariables): T {
  if (typeof valor === 'string') {
    return interpolar(valor, contexto) as unknown as T;
  }
  if (Array.isArray(valor)) {
    return valor.map((v) => interpolarConfig(v, contexto)) as unknown as T;
  }
  if (valor && typeof valor === 'object') {
    const salida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
      salida[k] = interpolarConfig(v, contexto);
    }
    return salida as unknown as T;
  }
  return valor;
}

// ── comparaciones ─────────────────────────────────────────────

export type Operador =
  | 'igual'
  | 'distinto'
  | 'contiene'
  | 'no_contiene'
  | 'empieza'
  | 'termina'
  | 'mayor'
  | 'menor'
  | 'mayor_igual'
  | 'menor_igual'
  | 'existe'
  | 'no_existe'
  | 'vacio'
  | 'no_vacio';

export const OPERADORES: readonly Operador[] = [
  'igual',
  'distinto',
  'contiene',
  'no_contiene',
  'empieza',
  'termina',
  'mayor',
  'menor',
  'mayor_igual',
  'menor_igual',
  'existe',
  'no_existe',
  'vacio',
  'no_vacio',
];

export function esOperador(v: string): v is Operador {
  return (OPERADORES as readonly string[]).includes(v);
}

/**
 * Evalúa una condición.
 *
 * Cada operador es una función concreta. No hay intérprete: añadir un operador
 * exige añadirlo aquí y en la lista, que es justo la barrera que impide que
 * una condición acabe ejecutando algo.
 *
 * Las comparaciones de texto son insensibles a mayúsculas y a acentos: quien
 * escribe «Bogotá» y quien escribe «bogota» quieren decir lo mismo, y en un
 * chat esa diferencia no puede cambiar la rama.
 */
export function evaluarCondicion(
  izquierda: unknown,
  operador: Operador,
  derecha?: unknown,
): boolean {
  switch (operador) {
    case 'existe':
      return izquierda !== undefined && izquierda !== null;
    case 'no_existe':
      return izquierda === undefined || izquierda === null;
    case 'vacio':
      return normalizar(izquierda) === '';
    case 'no_vacio':
      return normalizar(izquierda) !== '';
    case 'igual':
      return normalizar(izquierda) === normalizar(derecha);
    case 'distinto':
      return normalizar(izquierda) !== normalizar(derecha);
    case 'contiene':
      return normalizar(izquierda).includes(normalizar(derecha));
    case 'no_contiene':
      return !normalizar(izquierda).includes(normalizar(derecha));
    case 'empieza':
      return normalizar(izquierda).startsWith(normalizar(derecha));
    case 'termina':
      return normalizar(izquierda).endsWith(normalizar(derecha));
    case 'mayor':
    case 'menor':
    case 'mayor_igual':
    case 'menor_igual': {
      const a = aNumero(izquierda);
      const b = aNumero(derecha);
      // Comparar «abc» con 5 no es ni mayor ni menor: es una condición mal
      // configurada. Devolver `false` es lo único honesto.
      if (a === null || b === null) return false;
      if (operador === 'mayor') return a > b;
      if (operador === 'menor') return a < b;
      if (operador === 'mayor_igual') return a >= b;
      return a <= b;
    }
  }
}

function normalizar(valor: unknown): string {
  const texto = aTexto(valor);
  if (texto === null) return '';
  return texto.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function aNumero(valor: unknown): number | null {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor === 'string') {
    // Admite «1.234,56» y «1234.56»: en Colombia se escriben las dos.
    const limpio = valor.trim().replace(/\./g, '').replace(',', '.');
    const n = Number(limpio);
    return Number.isFinite(n) ? n : null;
  }
  if (valor instanceof Date) return valor.getTime();
  return null;
}

/**
 * Escapa lo que va a mostrarse en la interfaz del CRM (notas, resúmenes).
 *
 * Lo que llega de un cliente por WhatsApp es texto ajeno: si acaba pintado
 * como HTML en el panel del asesor, un mensaje puede convertirse en un ataque
 * contra quien lo lee.
 */
export function escaparParaInterfaz(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
