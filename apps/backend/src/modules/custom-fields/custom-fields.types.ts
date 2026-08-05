import { CustomFieldType, Prisma } from '@prisma/client';

/**
 * Normalización y validación de valores de campo personalizado.
 *
 * VIVE APARTE DEL SERVICIO A PROPÓSITO. Estas funciones no tocan la base ni
 * conocen la empresa: reciben una definición y un valor crudo y devuelven o
 * bien las columnas que hay que escribir, o bien el motivo por el que no vale.
 * Así el mismo código valida lo que escribe una persona por la API y lo que
 * escribe un bot desde un nodo, y no hay forma de que uno de los dos caminos
 * acabe con reglas más laxas que el otro.
 */

/** Las columnas tipadas de `CustomFieldValue`. Todas menos una van nulas. */
export interface ValorNormalizado {
  valueText: string | null;
  valueNumber: Prisma.Decimal | null;
  valueBool: boolean | null;
  valueDate: Date | null;
  valueList: string[];
}

export type ResultadoValidacion =
  | { ok: true; valor: ValorNormalizado }
  | { ok: false; motivo: string };

/** Lo que necesita saber la validación. Es un subconjunto de la definición. */
export interface DefinicionParaValidar {
  key: string;
  label: string;
  type: CustomFieldType;
  isRequired: boolean;
  options: unknown;
  validation: unknown;
}

const VACIO: ValorNormalizado = {
  valueText: null,
  valueNumber: null,
  valueBool: null,
  valueDate: null,
  valueList: [],
};

/** Longitud máxima de un texto corto. Un LONG_TEXT admite mucho más. */
export const MAX_TEXTO = 500;
export const MAX_TEXTO_LARGO = 20_000;
/** Tope de opciones marcadas en una selección múltiple. */
export const MAX_SELECCIONES = 50;

/**
 * Reglas extra que puede declarar una definición. Cualquier clave que no esté
 * aquí se ignora: una regla que no entendemos no puede bloquear un dato del
 * cliente, pero tampoco puede fingir que se aplica.
 */
export interface ReglasValidacion {
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  /** Expresión regular, como cadena. Se compila con guardas de seguridad. */
  pattern?: string;
}

/** Opciones de SELECT y MULTI_SELECT tal como se guardan. */
export interface OpcionCampo {
  value: string;
  label: string;
}

export function leerOpciones(options: unknown): OpcionCampo[] {
  if (!Array.isArray(options)) return [];
  const limpias: OpcionCampo[] = [];
  for (const o of options) {
    if (!o || typeof o !== 'object') continue;
    const value = (o as Record<string, unknown>).value;
    const label = (o as Record<string, unknown>).label;
    if (typeof value !== 'string' || value.length === 0) continue;
    limpias.push({
      value,
      label: typeof label === 'string' && label ? label : value,
    });
  }
  return limpias;
}

export function leerReglas(validation: unknown): ReglasValidacion {
  if (!validation || typeof validation !== 'object') return {};
  const v = validation as Record<string, unknown>;
  const numero = (x: unknown) =>
    typeof x === 'number' && Number.isFinite(x) ? x : undefined;
  return {
    minLength: numero(v.minLength),
    maxLength: numero(v.maxLength),
    min: numero(v.min),
    max: numero(v.max),
    pattern: typeof v.pattern === 'string' ? v.pattern : undefined,
  };
}

/**
 * Compila el patrón declarado por la empresa.
 *
 * TOPE DE LONGITUD Y `RegExp` NORMAL, NUNCA `eval`. Un patrón es un dato que
 * escribe un administrador, así que se trata como entrada no confiable: si no
 * compila, la regla se ignora en vez de tumbar la escritura.
 *
 * No protege de un patrón catastróficamente lento. Se acota la longitud del
 * texto ANTES de aplicarlo, que es la mitigación que sí depende de nosotros.
 */
function compilar(pattern: string): RegExp | null {
  if (pattern.length > 200) return null;
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

/** Formato E.164 laxo: lo estricto ya lo hace `normalizePhone` al capturar. */
const TELEFONO = /^\+?[0-9][0-9\s\-().]{5,24}$/;
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Convierte un valor crudo en las columnas que hay que escribir.
 *
 * `null` y cadena vacía significan «borrar el valor». Un campo obligatorio
 * rechaza el borrado: si no, marcar algo como requerido no significaría nada.
 */
export function normalizar(
  definicion: DefinicionParaValidar,
  crudo: unknown,
): ResultadoValidacion {
  const reglas = leerReglas(definicion.validation);
  const vacio =
    crudo === null ||
    crudo === undefined ||
    (typeof crudo === 'string' && crudo.trim() === '') ||
    (Array.isArray(crudo) && crudo.length === 0);

  if (vacio) {
    if (definicion.isRequired) {
      return { ok: false, motivo: `"${definicion.label}" es obligatorio` };
    }
    return { ok: true, valor: { ...VACIO } };
  }

  switch (definicion.type) {
    case 'TEXT':
    case 'LONG_TEXT':
      return texto(definicion, crudo, reglas);

    case 'PHONE':
      return conFormato(definicion, crudo, reglas, TELEFONO, 'un teléfono');

    case 'EMAIL': {
      const r = conFormato(definicion, crudo, reglas, CORREO, 'un correo');
      // Se guarda en minúsculas para que buscar por correo encuentre lo mismo
      // sin importar cómo lo escribió quien lo capturó.
      if (r.ok && r.valor.valueText) {
        r.valor.valueText = r.valor.valueText.toLowerCase();
      }
      return r;
    }

    case 'URL':
      return url(definicion, crudo);

    case 'NUMBER':
    case 'CURRENCY':
      return numero(definicion, crudo, reglas);

    case 'BOOLEAN':
      return booleano(definicion, crudo);

    case 'DATE':
    case 'DATETIME':
      return fecha(definicion, crudo);

    case 'SELECT':
      return seleccion(definicion, crudo);

    case 'MULTI_SELECT':
      return seleccionMultiple(definicion, crudo);
  }
}

function comoTexto(crudo: unknown): string | null {
  if (typeof crudo === 'string') return crudo.trim();
  if (typeof crudo === 'number' && Number.isFinite(crudo)) return String(crudo);
  if (typeof crudo === 'boolean') return crudo ? 'true' : 'false';
  // Un objeto o un array no se convierten: `String({})` daría
  // "[object Object]" y guardaríamos basura creyendo que guardamos un dato.
  return null;
}

function texto(
  d: DefinicionParaValidar,
  crudo: unknown,
  reglas: ReglasValidacion,
): ResultadoValidacion {
  const v = comoTexto(crudo);
  if (v === null) return { ok: false, motivo: `"${d.label}" espera un texto` };

  const tope = d.type === 'LONG_TEXT' ? MAX_TEXTO_LARGO : MAX_TEXTO;
  const maximo = Math.min(reglas.maxLength ?? tope, tope);
  if (v.length > maximo) {
    return {
      ok: false,
      motivo: `"${d.label}" admite como mucho ${maximo} caracteres`,
    };
  }
  if (reglas.minLength !== undefined && v.length < reglas.minLength) {
    return {
      ok: false,
      motivo: `"${d.label}" necesita al menos ${reglas.minLength} caracteres`,
    };
  }
  if (reglas.pattern) {
    const re = compilar(reglas.pattern);
    if (re && !re.test(v)) {
      return { ok: false, motivo: `"${d.label}" no tiene el formato esperado` };
    }
  }
  return { ok: true, valor: { ...VACIO, valueText: v } };
}

function conFormato(
  d: DefinicionParaValidar,
  crudo: unknown,
  reglas: ReglasValidacion,
  formato: RegExp,
  descripcion: string,
): ResultadoValidacion {
  const base = texto({ ...d, type: 'TEXT' }, crudo, reglas);
  if (!base.ok) return base;
  const v = base.valor.valueText ?? '';
  if (!formato.test(v)) {
    return { ok: false, motivo: `"${d.label}" espera ${descripcion} válido` };
  }
  return base;
}

/**
 * URL con las mismas restricciones que el validador de nodos HTTP: solo
 * `https` y nada de destinos internos. Un campo personalizado se acaba
 * abriendo desde el panel del asesor, así que una `javascript:` guardada aquí
 * es un ataque contra su navegador.
 */
function url(d: DefinicionParaValidar, crudo: unknown): ResultadoValidacion {
  const v = comoTexto(crudo);
  if (v === null) return { ok: false, motivo: `"${d.label}" espera una URL` };
  if (v.length > 2048) {
    return { ok: false, motivo: `"${d.label}" tiene una URL demasiado larga` };
  }

  let parsed: URL;
  try {
    parsed = new URL(v);
  } catch {
    return { ok: false, motivo: `"${d.label}" no es una URL válida` };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, motivo: `"${d.label}" solo admite https` };
  }
  if (parsed.username || parsed.password) {
    return {
      ok: false,
      motivo: `"${d.label}" no puede llevar credenciales en la URL`,
    };
  }
  return { ok: true, valor: { ...VACIO, valueText: parsed.toString() } };
}

function numero(
  d: DefinicionParaValidar,
  crudo: unknown,
  reglas: ReglasValidacion,
): ResultadoValidacion {
  let n: number;
  if (typeof crudo === 'number') {
    n = crudo;
  } else if (typeof crudo === 'string') {
    // Se aceptan las dos convenciones: "1.234,56" (Colombia) y "1234.56".
    // Rechazar la primera obligaría al cliente a escribir como el servidor.
    const limpio = crudo.trim().replace(/\s/g, '');
    const colombiano = /^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(limpio);
    n = Number(
      colombiano ? limpio.replace(/\./g, '').replace(',', '.') : limpio,
    );
  } else {
    return { ok: false, motivo: `"${d.label}" espera un número` };
  }

  if (!Number.isFinite(n)) {
    return { ok: false, motivo: `"${d.label}" espera un número` };
  }
  if (reglas.min !== undefined && n < reglas.min) {
    return {
      ok: false,
      motivo: `"${d.label}" no puede ser menor que ${reglas.min}`,
    };
  }
  if (reglas.max !== undefined && n > reglas.max) {
    return {
      ok: false,
      motivo: `"${d.label}" no puede ser mayor que ${reglas.max}`,
    };
  }
  // La columna es DECIMAL(18,6): un número que no cabe se rechaza aquí en vez
  // de que PostgreSQL lo trunque o reviente a mitad de la transacción.
  if (Math.abs(n) >= 1e12) {
    return { ok: false, motivo: `"${d.label}" tiene un valor fuera de rango` };
  }

  return {
    ok: true,
    valor: { ...VACIO, valueNumber: new Prisma.Decimal(n.toFixed(6)) },
  };
}

function booleano(
  d: DefinicionParaValidar,
  crudo: unknown,
): ResultadoValidacion {
  if (typeof crudo === 'boolean') {
    return { ok: true, valor: { ...VACIO, valueBool: crudo } };
  }
  const v = comoTexto(crudo)?.toLowerCase();
  const ciertos = ['true', 'si', 'sí', '1', 'yes', 'y', 's'];
  const falsos = ['false', 'no', '0', 'n'];
  if (v && ciertos.includes(v)) {
    return { ok: true, valor: { ...VACIO, valueBool: true } };
  }
  if (v && falsos.includes(v)) {
    return { ok: true, valor: { ...VACIO, valueBool: false } };
  }
  return { ok: false, motivo: `"${d.label}" espera sí o no` };
}

/**
 * Fecha.
 *
 * ACEPTA ISO Y EL FORMATO COLOMBIANO `dd/mm/aaaa`. Interpretar "03/08/2026"
 * como 8 de marzo porque el servidor habla inglés es el error de fechas más
 * caro y más silencioso que existe.
 */
function fecha(d: DefinicionParaValidar, crudo: unknown): ResultadoValidacion {
  if (crudo instanceof Date && !Number.isNaN(crudo.getTime())) {
    return { ok: true, valor: { ...VACIO, valueDate: crudo } };
  }
  const v = comoTexto(crudo);
  if (!v) return { ok: false, motivo: `"${d.label}" espera una fecha` };

  const ddmmaaaa = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(v);
  if (ddmmaaaa) {
    const [, dia, mes, anio] = ddmmaaaa;
    const iso = `${anio}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}T00:00:00.000Z`;
    const f = new Date(iso);
    if (Number.isNaN(f.getTime())) {
      return { ok: false, motivo: `"${d.label}" no es una fecha válida` };
    }
    // Se comprueba la vuelta: "31/02/2026" produciría un 3 de marzo sin avisar.
    if (f.getUTCDate() !== Number(dia) || f.getUTCMonth() + 1 !== Number(mes)) {
      return { ok: false, motivo: `"${d.label}" no es una fecha que exista` };
    }
    return { ok: true, valor: { ...VACIO, valueDate: f } };
  }

  const f = new Date(v);
  if (Number.isNaN(f.getTime())) {
    return { ok: false, motivo: `"${d.label}" no es una fecha válida` };
  }
  return { ok: true, valor: { ...VACIO, valueDate: f } };
}

function seleccion(
  d: DefinicionParaValidar,
  crudo: unknown,
): ResultadoValidacion {
  const opciones = leerOpciones(d.options);
  const v = comoTexto(crudo);
  if (!v) return { ok: false, motivo: `"${d.label}" espera una opción` };

  // Se acepta tanto el valor como la etiqueta: quien configura un bot escribe
  // lo que ve en la pantalla, no el identificador interno.
  const elegida = opciones.find(
    (o) => o.value === v || o.label.toLowerCase() === v.toLowerCase(),
  );
  if (!elegida) {
    return {
      ok: false,
      motivo: `"${v}" no es una opción de "${d.label}"`,
    };
  }
  return { ok: true, valor: { ...VACIO, valueText: elegida.value } };
}

function seleccionMultiple(
  d: DefinicionParaValidar,
  crudo: unknown,
): ResultadoValidacion {
  const opciones = leerOpciones(d.options);
  const crudos = Array.isArray(crudo)
    ? crudo
    : String(comoTexto(crudo) ?? '').split(',');

  const elegidas: string[] = [];
  for (const c of crudos) {
    const v = comoTexto(c);
    if (!v) continue;
    const elegida = opciones.find(
      (o) => o.value === v || o.label.toLowerCase() === v.toLowerCase(),
    );
    if (!elegida) {
      return { ok: false, motivo: `"${v}" no es una opción de "${d.label}"` };
    }
    // Sin duplicados: marcar dos veces la misma casilla no es dos valores.
    if (!elegidas.includes(elegida.value)) elegidas.push(elegida.value);
  }

  if (elegidas.length === 0) {
    if (d.isRequired) {
      return { ok: false, motivo: `"${d.label}" es obligatorio` };
    }
    return { ok: true, valor: { ...VACIO } };
  }
  if (elegidas.length > MAX_SELECCIONES) {
    return {
      ok: false,
      motivo: `"${d.label}" admite como mucho ${MAX_SELECCIONES} opciones`,
    };
  }
  return { ok: true, valor: { ...VACIO, valueList: elegidas } };
}

/**
 * Representación legible de un valor, para el historial y para las plantillas
 * de mensaje. Nunca `[object Object]`.
 */
export function comoCadena(
  tipo: CustomFieldType,
  valor: Partial<ValorNormalizado> | null,
): string | null {
  if (!valor) return null;
  switch (tipo) {
    case 'NUMBER':
    case 'CURRENCY':
      return valor.valueNumber ? valor.valueNumber.toString() : null;
    case 'BOOLEAN':
      return valor.valueBool === null || valor.valueBool === undefined
        ? null
        : valor.valueBool
          ? 'sí'
          : 'no';
    case 'DATE':
      return valor.valueDate
        ? valor.valueDate.toISOString().slice(0, 10)
        : null;
    case 'DATETIME':
      return valor.valueDate ? valor.valueDate.toISOString() : null;
    case 'MULTI_SELECT':
      return valor.valueList && valor.valueList.length > 0
        ? valor.valueList.join(', ')
        : null;
    default:
      return valor.valueText ?? null;
  }
}

/** Las claves son identificadores. El CHECK de la base dice lo mismo. */
export const CLAVE_VALIDA = /^[a-z][a-z0-9_]{0,62}$/;

/**
 * Convierte una etiqueta escrita por una persona en una clave estable.
 * "Estado de crédito" → "estado_de_credito".
 */
export function claveDesdeEtiqueta(label: string): string {
  const base = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 63);
  // Una clave tiene que empezar por letra: "1_contacto" no vale.
  return /^[a-z]/.test(base) ? base : `campo_${base}`.slice(0, 63);
}
