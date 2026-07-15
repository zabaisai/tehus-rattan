import { getTrustedClientIp, maskIp, normalizeIp } from './ip.util';

describe('normalizeIp', () => {
  it('returns null for null/undefined/empty input', () => {
    expect(normalizeIp(null)).toBeNull();
    expect(normalizeIp(undefined)).toBeNull();
    expect(normalizeIp('   ')).toBeNull();
  });

  it('leaves a plain IPv4 address unchanged', () => {
    expect(normalizeIp('181.60.12.24')).toBe('181.60.12.24');
  });

  it('leaves a plain IPv6 address unchanged', () => {
    expect(normalizeIp('2001:db8::1a2b')).toBe('2001:db8::1a2b');
  });

  it('collapses an IPv4-mapped IPv6 address down to plain IPv4', () => {
    expect(normalizeIp('::ffff:181.60.12.24')).toBe('181.60.12.24');
    expect(normalizeIp('::FFFF:181.60.12.24')).toBe('181.60.12.24');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeIp('  181.60.12.24  ')).toBe('181.60.12.24');
  });
});

describe('maskIp', () => {
  it('returns null for null input', () => {
    expect(maskIp(null)).toBeNull();
  });

  it('masks the two middle octets of an IPv4 address', () => {
    expect(maskIp('181.60.12.24')).toBe('181.***.***.24');
  });

  it('masks the middle groups of an IPv6 address, keeping first and last', () => {
    expect(maskIp('2001:db8:0:0:0:0:0:1a2b')).toBe('2001:****:****:1a2b');
  });

  it('never contains enough of the original address to reconstruct it', () => {
    const masked = maskIp('181.60.12.24');
    expect(masked).not.toContain('60');
    expect(masked).not.toContain('12');
  });
});

describe('getTrustedClientIp', () => {
  it('uses req.ip — the value Express already resolved via `trust proxy: 1` behind Caddy', () => {
    expect(getTrustedClientIp({ ip: '181.60.12.24' })).toBe('181.60.12.24');
  });

  it('never reads a raw x-forwarded-for header itself — only req.ip/socket.remoteAddress', () => {
    // A raw header on the request object (as if a client tried to spoof
    // it) must never be consulted by this function — only trust-proxy-
    // resolved req.ip, or the raw socket as a last resort.
    const spoofed: any = {
      ip: undefined,
      headers: { 'x-forwarded-for': '1.2.3.4' },
      socket: { remoteAddress: '203.0.113.9' },
    };
    expect(getTrustedClientIp(spoofed)).toBe('203.0.113.9');
  });

  it('returns null when no IP source is available', () => {
    expect(getTrustedClientIp({})).toBeNull();
  });
});
