import { randomBytes, createHash } from 'crypto';

const GROUP_COUNT = 4;
const GROUP_LENGTH = 4;
const PREFIX = 'TEHUS';

// crypto.randomBytes (not Math.random) — 8 bytes = 64 bits of entropy,
// encoded as 16 uppercase hex characters split into 4 groups of 4:
// TEHUS-XXXX-XXXX-XXXX-XXXX.
export function generateInvitationCode(): string {
  const hex = randomBytes(8).toString('hex').toUpperCase();
  const groups: string[] = [];
  for (let i = 0; i < GROUP_COUNT; i++) {
    groups.push(hex.slice(i * GROUP_LENGTH, (i + 1) * GROUP_LENGTH));
  }
  return `${PREFIX}-${groups.join('-')}`;
}

// Accepts the code with or without dashes, in any case, with surrounding
// whitespace — returns the canonical form used for hashing/comparison.
// "tehus-ab12-cd34-ef56-7890" and "TEHUSAB12CD34EF567890" normalize to the
// same value.
export function normalizeInvitationCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]/g, '');
}

export function hashInvitationCode(normalizedCode: string): string {
  return createHash('sha256').update(normalizedCode).digest('hex');
}

// Never logged, never persisted — only used to build the one-time
// create-response and, from the stored codeHash's last 4 hex chars
// (fixed length regardless of input), the masked panel preview.
export function buildCodePreview(plainCode: string): string {
  const normalized = normalizeInvitationCode(plainCode);
  const last4 = normalized.slice(-4);
  const maskedGroups = Array(GROUP_COUNT - 1).fill('****');
  return `${PREFIX}-${maskedGroups.join('-')}-${last4}`;
}
