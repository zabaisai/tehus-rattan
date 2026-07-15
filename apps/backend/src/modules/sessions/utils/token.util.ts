import { randomBytes, createHash } from 'crypto';

// Both the deviceId cookie value and the refresh token are opaque,
// cryptographically random secrets — crypto.randomBytes, never Math.random
// and never derived from any client-supplied or device-derived data.
export function generateOpaqueToken(byteLength = 32): string {
  return randomBytes(byteLength).toString('hex');
}

export function hashToken(plainToken: string): string {
  return createHash('sha256').update(plainToken).digest('hex');
}
