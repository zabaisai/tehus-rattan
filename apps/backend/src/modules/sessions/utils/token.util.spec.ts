import { generateOpaqueToken, hashToken } from './token.util';

describe('generateOpaqueToken', () => {
  it('generates a hex string of the expected length', () => {
    const token = generateOpaqueToken(32);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is random — two calls never collide', () => {
    const tokens = new Set(
      Array.from({ length: 50 }, () => generateOpaqueToken()),
    );
    expect(tokens.size).toBe(50);
  });
});

describe('hashToken', () => {
  it('is deterministic — the same input always hashes the same way', () => {
    const token = generateOpaqueToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it('never returns the plaintext token itself', () => {
    const token = generateOpaqueToken();
    expect(hashToken(token)).not.toBe(token);
  });

  it('produces a 64-character sha256 hex digest', () => {
    expect(hashToken('anything')).toMatch(/^[0-9a-f]{64}$/);
  });
});
