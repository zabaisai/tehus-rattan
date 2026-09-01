// Guards for URLs/paths that originate outside the component — query params
// (?volverA=…), API-supplied fields (notification actionUrl), or free-text
// user input. Centralized so every navigation/render sink validates the same
// way.

// A safe internal path is an absolute app path ("/dashboard/...") — never a
// protocol-relative URL ("//evil.com"), a backslash-escaped one ("/\evil"),
// a full URL, or a javascript:/data: scheme. Prevents open-redirect and
// off-site navigation from attacker-influenced values.
export function isSafeInternalPath(url: string | null | undefined): url is string {
  if (!url) return false;
  return /^\/(?![/\\])/.test(url);
}

// Returns the value only when it is a safe internal path, otherwise a fallback.
export function safeInternalPath(
  url: string | null | undefined,
  fallback: string,
): string {
  return isSafeInternalPath(url) ? url : fallback;
}

// Only plain http(s) URLs are acceptable for user-provided external resources
// (e.g. product image URLs). javascript:, data:, blob:, protocol-relative and
// unparsable values are rejected.
export function isSafeHttpUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}
