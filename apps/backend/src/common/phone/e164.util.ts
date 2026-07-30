// Normalización telefónica a E.164, en un único sitio.
//
// Por qué existe: Meta entrega `wa_id` sin `+` (573001112233) y el CRM lo
// guardaba tal cual, de modo que "+573001112233" y "573001112233" eran dos
// contactos distintos para el índice único (phone, companyId). Este utilitario
// es la fuente única de verdad para decidir cuándo dos números son el mismo.
//
// Deliberadamente SIN dependencias: no se añade libphonenumber para esto. El
// alcance real es Colombia más números que ya llegan con indicativo, y una
// librería de 500 kB para eso es peor negocio que 60 líneas explícitas y
// probadas. Si algún día hace falta validar plan de numeración por país, ese
// es el momento de reconsiderarlo, no ahora.

// Indicativo por defecto cuando el número no trae uno. Colombia.
const DEFAULT_COUNTRY_CODE = '57';

// Longitud del número nacional colombiano (móvil y fijo con indicativo de
// área). Se usa solo para decidir si un número SIN prefijo es nacional.
const CO_NATIONAL_LENGTH = 10;

// E.164 admite hasta 15 dígitos incluyendo el indicativo de país.
const E164_MAX_DIGITS = 15;
const E164_MIN_DIGITS = 8;

export interface NormalizedPhone {
  /** Forma canónica `+<dígitos>`, o null si no se pudo normalizar. */
  e164: string | null;
  /** Solo dígitos, sin `+`. Útil para comparar con el `wa_id` de Meta. */
  digits: string;
  /** true si la entrada ya venía en forma canónica. */
  wasAlreadyE164: boolean;
}

/**
 * Normaliza un teléfono a E.164.
 *
 * Reglas, en orden:
 *  1. Se descarta todo lo que no sea dígito, salvo un `+` inicial.
 *  2. Un `00` inicial es el prefijo internacional de marcación: equivale a `+`.
 *  3. Si venía con `+`, se respeta su indicativo: NUNCA se reinterpreta como
 *     nacional. Asumir país sobre un número que ya lo declara es la forma más
 *     fácil de romper un contacto internacional.
 *  4. Sin `+`, se aplica el indicativo por defecto solo si la longitud
 *     corresponde a un número nacional. Si ya parece traer indicativo (es más
 *     largo), se respeta tal cual.
 *  5. Fuera del rango de E.164 → no normalizable.
 *
 * Nunca lanza: un número inválido devuelve `e164: null` para que el llamador
 * decida (rechazar, registrar conflicto, conservar el original).
 */
export function normalizePhone(
  input: string | null | undefined,
  defaultCountryCode: string = DEFAULT_COUNTRY_CODE,
): NormalizedPhone {
  const raw = (input ?? '').trim();
  if (!raw) return { e164: null, digits: '', wasAlreadyE164: false };

  const hadPlus = raw.startsWith('+');
  let digits = raw.replace(/\D/g, '');

  // `00` como prefijo internacional equivale a `+`, pero solo si no había ya
  // un `+` explícito.
  let treatAsInternational = hadPlus;
  if (!hadPlus && digits.startsWith('00')) {
    digits = digits.slice(2);
    treatAsInternational = true;
  }

  if (!digits) return { e164: null, digits: '', wasAlreadyE164: false };

  let normalized: string;
  if (treatAsInternational) {
    // Ya declara indicativo: se respeta sin reinterpretar.
    normalized = digits;
  } else if (digits.length === CO_NATIONAL_LENGTH) {
    // Número nacional sin indicativo.
    normalized = `${defaultCountryCode}${digits}`;
  } else {
    // Más largo que un nacional: se asume que ya trae indicativo (es el caso
    // del `wa_id` de Meta, que llega sin `+` pero con país).
    normalized = digits;
  }

  if (
    normalized.length < E164_MIN_DIGITS ||
    normalized.length > E164_MAX_DIGITS
  ) {
    return { e164: null, digits: normalized, wasAlreadyE164: false };
  }

  return {
    e164: `+${normalized}`,
    digits: normalized,
    wasAlreadyE164: hadPlus && digits === normalized,
  };
}

/**
 * ¿Son el mismo número? Compara por forma canónica, de modo que
 * `573001112233`, `+573001112233` y `300 111 2233` son el mismo contacto.
 * Dos números no normalizables solo son iguales si su texto crudo coincide.
 */
export function isSamePhone(
  a: string | null | undefined,
  b: string | null | undefined,
  defaultCountryCode: string = DEFAULT_COUNTRY_CODE,
): boolean {
  const na = normalizePhone(a, defaultCountryCode);
  const nb = normalizePhone(b, defaultCountryCode);
  if (na.e164 && nb.e164) return na.e164 === nb.e164;
  return (a ?? '').trim() === (b ?? '').trim();
}

/**
 * Variantes con las que un mismo número pudo haberse guardado antes de la
 * normalización. Permite que la búsqueda siga encontrando contactos
 * históricos mientras el backfill no haya pasado por todos.
 */
export function phoneLookupVariants(
  input: string | null | undefined,
  defaultCountryCode: string = DEFAULT_COUNTRY_CODE,
): string[] {
  const { e164, digits } = normalizePhone(input, defaultCountryCode);
  const raw = (input ?? '').trim();

  const variants = new Set<string>();
  if (raw) variants.add(raw);
  if (e164) variants.add(e164);
  if (digits) variants.add(digits);

  // Forma nacional (sin indicativo por defecto), por si se guardó así.
  if (digits.startsWith(defaultCountryCode)) {
    const national = digits.slice(defaultCountryCode.length);
    if (national.length === CO_NATIONAL_LENGTH) variants.add(national);
  }

  return [...variants];
}
