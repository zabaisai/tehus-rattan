import { getTrustedClientIp, truncateIp } from './ip.util';

describe('truncateIp', () => {
  it('returns null for null/undefined/empty input', () => {
    expect(truncateIp(null)).toBeNull();
    expect(truncateIp(undefined)).toBeNull();
    expect(truncateIp('   ')).toBeNull();
  });

  it('zeroes the last octet of an IPv4 address — never the full address', () => {
    expect(truncateIp('181.60.12.24')).toBe('181.60.12.0');
  });

  it('collapses an IPv4-mapped IPv6 address to IPv4 before truncating', () => {
    expect(truncateIp('::ffff:181.60.12.24')).toBe('181.60.12.0');
  });

  it('truncates an IPv6 address to its first 3 hextets', () => {
    expect(truncateIp('2001:db8:1234:5678:0:0:0:1')).toBe('2001:db8:1234::');
  });

  it('truncates a "::" shorthand IPv6 address correctly', () => {
    expect(truncateIp('2001:db8::1a2b')).toBe('2001:db8:0::');
  });

  it('never contains enough of the original address to reconstruct it', () => {
    const truncated = truncateIp('181.60.12.24');
    // The precise last octet must never survive.
    expect(truncated).not.toContain('.24');
    expect(truncated).not.toMatch(/24$/);
  });

  it('is deterministic — the same input always truncates the same way', () => {
    expect(truncateIp('181.60.12.24')).toBe(truncateIp('181.60.12.24'));
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
