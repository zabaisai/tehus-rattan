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

export function getTrustedClientIp(req: TrustedIpSource): string | null {
  return normalizeIp(req.ip ?? req.socket?.remoteAddress ?? null);
}

const IPV4_MAPPED_IPV6 = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;

// Collapses IPv4-mapped IPv6 ("::ffff:181.60.12.24") down to plain IPv4, so
// the same physical client never shows up as two different-looking
// addresses depending on which socket family accepted the connection.
export function normalizeIp(rawIp: string | null | undefined): string | null {
  if (!rawIp) return null;
  const trimmed = rawIp.trim();
  if (!trimmed) return null;

  const mapped = trimmed.match(IPV4_MAPPED_IPV6);
  if (mapped) return mapped[1];

  return trimmed;
}

// Partial, display-safe form — e.g. "181.***.***.24" for IPv4 or
// "2001:****:****:1a2b" for IPv6. Never returns enough to reconstruct the
// full address.
export function maskIp(normalizedIp: string | null): string | null {
  if (!normalizedIp) return null;

  if (normalizedIp.includes('.')) {
    const parts = normalizedIp.split('.');
    if (parts.length !== 4) return normalizedIp;
    return `${parts[0]}.***.***.${parts[3]}`;
  }

  if (normalizedIp.includes(':')) {
    const parts = normalizedIp.split(':').filter((p) => p.length > 0);
    if (parts.length < 2) return normalizedIp;
    return `${parts[0]}:****:****:${parts[parts.length - 1]}`;
  }

  return normalizedIp;
}
