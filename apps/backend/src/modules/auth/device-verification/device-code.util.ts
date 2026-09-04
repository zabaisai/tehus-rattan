import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { CHALLENGE_CODE_LENGTH } from './device-verification.constants';

/**
 * Código de seis dígitos con el generador criptográfico del sistema.
 *
 * `randomInt` toma sus bytes de la misma fuente que el resto de secretos del
 * producto y descarta los valores que sesgarían el módulo. `Math.random` no
 * sirve aquí: su estado es predecible a partir de unas pocas salidas.
 *
 * Se rellena con ceros a la izquierda para que `000042` sea tan válido como
 * `421337`; recortar los ceros dejaría fuera una parte del espacio.
 */
export function generateVerificationCode(): string {
  const max = 10 ** CHALLENGE_CODE_LENGTH;
  return String(randomInt(0, max)).padStart(CHALLENGE_CODE_LENGTH, '0');
}

/** Solo dígitos y longitud exacta: lo demás no llega a compararse. */
export function isWellFormedCode(code: string): boolean {
  return new RegExp(`^\\d{${CHALLENGE_CODE_LENGTH}}$`).test(code);
}

/**
 * Huella del código con HMAC-SHA256 y un secreto exclusivo de esta función.
 *
 * Un SHA-256 a secas del código sería inútil: con un millón de combinaciones,
 * quien lea la base precalcula la tabla entera en segundos. El HMAC obliga a
 * conocer el secreto, que vive solo en la configuración del servidor. El
 * `challengeId` entra en el mensaje para que la huella de un reto no valga en
 * otro aunque el código coincida por azar.
 */
export function digestCode(
  code: string,
  challengeId: string,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update(`${challengeId}:${code}`)
    .digest('hex');
}

/**
 * Comparación en tiempo constante: comparar con `===` filtra por el tiempo de
 * respuesta cuántos caracteres iniciales coinciden.
 */
export function digestMatches(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Destino enmascarado que sí puede salir de la API: dos caracteres del buzón,
 * asteriscos y el dominio. Es lo justo para que la persona reconozca su propia
 * cuenta sin que la respuesta revele la dirección a un tercero.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}
