// Trust boundary: req.ip is resolved by Express using `trust proxy: 1`
// (see main.ts) — with a hop count of 1, Express's underlying `proxy-addr`
// walks back exactly one entry from the right end of X-Forwarded-For. That
// is safe ONLY because Caddy is the sole reverse proxy allowed to reach
// this service (the backend container publishes no port of its own — see
// docker-compose.staging.yml), so the rightmost hop Caddy appends is
// guaranteed to be the real client IP, never a value the client itself
// could have injected. Reading `x-forwarded-for` directly here instead
// would trust whatever the client sent, which is exactly what must not
// happen.
export interface TrustedIpSource {
  ip?: string;
  socket?: { remoteAddress?: string };
}

// The precise IP is resolved only transiently, in-memory, for the single
// call to truncateIp() below — it is never itself logged, stored, or
// returned from any endpoint. See truncateIp for the only form that is
// ever persisted.
export function getTrustedClientIp(req: TrustedIpSource): string | null {
  return normalizeIp(req.ip ?? req.socket?.remoteAddress ?? null);
}

const IPV4_MAPPED_IPV6 = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;

// Collapses IPv4-mapped IPv6 ("::ffff:181.60.12.24") down to plain IPv4, so
// the same physical client never shows up as two different-looking
// addresses depending on which socket family accepted the connection.
function normalizeIp(rawIp: string | null | undefined): string | null {
  if (!rawIp) return null;
  const trimmed = rawIp.trim();
  if (!trimmed) return null;

  const mapped = trimmed.match(IPV4_MAPPED_IPV6);
  if (mapped) return mapped[1];

  return trimmed;
}

// The ONLY IP representation this app ever writes to the database or
// returns from an API — the precise address is discarded immediately
// after this runs. IPv4 loses its last octet (181.60.12.24 ->
// 181.60.12.0); IPv6 is truncated to its first 3 hextets / 48 bits
// (2001:db8:1234:5678::1 -> 2001:db8:1234::), the common privacy-safe
// anonymization granularity (roughly ISP-allocation-sized, not
// individual-device-sized). There is no separate "full IP" column
// anywhere in the schema — this single truncated value is both what gets
// stored and what the panel displays.
export function truncateIp(rawIp: string | null | undefined): string | null {
  const normalized = normalizeIp(rawIp);
  if (!normalized) return null;

  if (normalized.includes('.')) {
    const parts = normalized.split('.');
    if (parts.length !== 4) return null;
    return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  }

  if (normalized.includes(':')) {
    // Expand a "::" shorthand run just enough to reliably take the first
    // 3 groups — a raw split on ':' would otherwise grab empty strings
    // from the collapsed run instead of real hextets.
    const expanded = expandIpv6(normalized);
    const groups = expanded.split(':').filter((g) => g.length > 0);
    if (groups.length < 3) return `${groups.join(':')}::`;
    return `${groups.slice(0, 3).join(':')}::`;
  }

  return null;
}

function expandIpv6(address: string): string {
  if (!address.includes('::')) return address;
  const [head, tail] = address.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const missing = 8 - headParts.length - tailParts.length;
  const zeros = Array(Math.max(missing, 0)).fill('0');
  return [...headParts, ...zeros, ...tailParts].join(':');
}
