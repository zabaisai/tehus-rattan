// The access token (JWT) lives ONLY here: a module-scoped variable, i.e. plain
// tab memory. It is intentionally never written to localStorage, sessionStorage,
// cookies, IndexedDB, the URL, a persisted store, logs, or BroadcastChannel.
// A full page reload wipes it; the app re-obtains a fresh one via /auth/refresh
// (see auth-bootstrap.ts). Each browser tab keeps its own copy.

let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function clearAccessToken(): void {
  accessToken = null;
}
