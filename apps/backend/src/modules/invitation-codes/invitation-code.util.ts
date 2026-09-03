import { randomBytes, createHash } from 'crypto';

const GROUP_COUNT = 4;
const GROUP_LENGTH = 4;

// Prefijo de los códigos NUEVOS. TAKTO es la plataforma; el prefijo antiguo
// `TEHUS` pertenecía al primer tenant. Cambiarlo NO invalida ningún código
// existente: la validación compara el hash SHA-256 del código normalizado
// (prefijo incluido) con `InvitationCode.codeHash`, y decide por estado,
// vencimiento y uso — nunca por el prefijo. Un código `TEHUS-…` activo sigue
// siendo utilizable; uno usado, revocado o vencido sigue rechazándose.
export const INVITATION_CODE_PREFIX = 'TAKTO';
export const LEGACY_INVITATION_CODE_PREFIX = 'TEHUS';

// Entropía: 8 bytes de crypto.randomBytes = 64 bits, codificados como 16
// caracteres hexadecimales en mayúsculas repartidos en 4 grupos de 4:
// TAKTO-XXXX-XXXX-XXXX-XXXX. El prefijo es público y fijo; la parte secreta
// es solo la aleatoria, así que cambiar el prefijo no la hace predecible.
export const INVITATION_CODE_SECRET_BITS = 64;

export function generateInvitationCode(): string {
  const hex = randomBytes(INVITATION_CODE_SECRET_BITS / 8)
    .toString('hex')
    .toUpperCase();
  const groups: string[] = [];
  for (let i = 0; i < GROUP_COUNT; i++) {
    groups.push(hex.slice(i * GROUP_LENGTH, (i + 1) * GROUP_LENGTH));
  }
  return `${INVITATION_CODE_PREFIX}-${groups.join('-')}`;
}

// Accepts the code with or without dashes, in any case, with surrounding
// whitespace — returns the canonical form used for hashing/comparison.
// "takto-ab12-cd34-ef56-7890" and "TAKTOAB12CD34EF567890" normalize to the
// same value (and so do legacy "tehus-…" codes, which keep their own hash).
export function normalizeInvitationCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]/g, '');
}

export function hashInvitationCode(normalizedCode: string): string {
  return createHash('sha256').update(normalizedCode).digest('hex');
}

// Never logged, never persisted beyond `codePreview` — only used to build the
// one-time create-response and the masked panel preview (last 4 hex chars,
// fixed length regardless of input). The preview keeps the prefix the code
// was generated with, so legacy rows keep showing `TEHUS-****-…`.
export function buildCodePreview(plainCode: string): string {
  const normalized = normalizeInvitationCode(plainCode);
  const prefix = normalized.startsWith(LEGACY_INVITATION_CODE_PREFIX)
    ? LEGACY_INVITATION_CODE_PREFIX
    : INVITATION_CODE_PREFIX;
  const last4 = normalized.slice(-4);
  const maskedGroups = Array(GROUP_COUNT - 1).fill('****');
  return `${prefix}-${maskedGroups.join('-')}-${last4}`;
}
