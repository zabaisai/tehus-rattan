# Seguridad de sesión en el navegador

Fase de endurecimiento de autenticación para staging privado. Objetivo: que el
access token JWT nunca se persista en mecanismos accesibles o duraderos del
navegador. La autoridad de autorización sigue siendo el backend.

## 1. Ciclo de vida del access token (solo en memoria)

- El access token vive **únicamente** en `apps/frontend/src/lib/auth-token.ts`:
  una variable de módulo (memoria de la pestaña). `getAccessToken` /
  `setAccessToken` / `clearAccessToken`.
- **Nunca** se guarda en: `localStorage`, `sessionStorage`, cookies, IndexedDB,
  store de Zustand persistido, URL/query/hash, HTML del servidor, logs ni
  `BroadcastChannel`.
- Una recarga completa borra el token; la app obtiene uno nuevo por
  `/auth/refresh` (bootstrap). Cada pestaña mantiene su propia copia.
- El store (`auth.store.ts`) guarda solo `user` y `status`
  (`bootstrapping` | `authenticated` | `anonymous`), nunca el JWT.

## 2. Bootstrap tras recargar

`AuthProvider` (envuelve la app) corre una vez al cargar:

1. Estado inicial `bootstrapping`.
2. `POST /auth/refresh` (usa la cookie httpOnly de refresh) — single-flight
   compartido con el interceptor de Axios (no hay tormenta de refresh).
3. Éxito → access token nuevo en memoria + `GET /auth/me` → `authenticated`.
4. Fallo (401) → `anonymous`.

`AuthGate` (rutas protegidas) muestra un loader mientras `bootstrapping`,
redirige a `/login` si `anonymous`, y solo renderiza contenido privado cuando
`authenticated`. Así no hay parpadeo de contenido privado ni bucles
login↔dashboard. La página `/login` redirige a `/dashboard` si ya está
autenticado.

## 3. Cookie de refresh y rotación

- El refresh token es **opaco** (32 bytes aleatorios), se guarda en BD solo como
  **hash SHA-256** (`UserSession.refreshTokenHash`, `@unique`). El texto plano
  vive únicamente en la cookie httpOnly y se elimina de todo JSON de respuesta.
- Cookie: `httpOnly: true`, `secure: NODE_ENV === 'production'`,
  `sameSite: 'lax'`, `path: '/api/auth'`, `maxAge` 90 días, sin `domain`
  (host-only). `set` y `clear` usan el mismo `path` → el navegador la borra.
- **Rotación:** cada `/auth/refresh` genera un token nuevo y sobrescribe el hash;
  el token anterior deja de resolver (rechazado).
- **Revocación inmediata:** `JwtStrategy` valida la `UserSession` por `sid` en
  **cada** request (status ACTIVE, no revocada, no cerrada, no expirada por
  inactividad). Revocar una sesión la invalida al instante.
- **Logout:** cierra la sesión del servidor (esa cookie) y borra la cookie.
  El frontend limpia la memoria aunque el backend falle.
- Access token de vida corta (**15 min**) como defensa en profundidad.

## 4. Modelo de autorización

- El **backend es la autoridad**: rol, `companyId`, sesión activa, revocación y
  permisos multiempresa se validan server-side en cada request (JWT `sid` +
  guards de tenant/roles).
- El middleware de Next fue **eliminado**: no puede leer un token en memoria y,
  en staging, la cookie httpOnly de refresh está en el subdominio `api.*`, no en
  el del frontend. El routing de auth es 100% cliente (AuthGate/bootstrap) y
  **no** es una barrera de autorización.

## 5. Múltiples pestañas

- `BroadcastChannel('tehus-auth')` solo transmite **tipos de evento**
  (`logout`, `session-invalidated`) — nunca tokens ni credenciales.
- Cada pestaña mantiene su propio access token en memoria y lo deriva por
  refresh. Al recibir un evento de otra pestaña, limpia su sesión y va a
  `/login`. Degrada a no-op si `BroadcastChannel` no está disponible.

## 6. Protección Origin / CSRF

- Defensa principal: `SameSite=lax` en la cookie de refresh (bloquea POST
  cross-site con la cookie). En staging, frontend (`crm-staging.*`) y backend
  (`api.crm-staging.*`) comparten el dominio registrable → son **same-site**, así
  que la cookie viaja en fetch entre ellos; un sitio atacante (cross-site) no la
  envía.
- Defensa en profundidad: `CookieOriginGuard` valida el header `Origin` en
  `POST /auth/login|refresh|logout`. Allowlist: `FRONTEND_URL`
  (+ `http://localhost:3000` en no-producción, o `CSRF_ALLOWED_ORIGINS`). Origin
  presente y no permitido → **403**; Origin ausente (curl/servidor) → permitido
  (un navegador siempre envía Origin en un POST CSRF-relevante).
- `secure` está condicionado a `NODE_ENV === 'production'`: **staging debe
  correr con `NODE_ENV=production`** para que la cookie nunca viaje por HTTP.

## 7. Comportamiento por entorno

| | Desarrollo | Staging / Producción |
| --- | --- | --- |
| `secure` en cookie | off (`NODE_ENV != production`) | on |
| Origins permitidos | `FRONTEND_URL` + `localhost:3000` | `FRONTEND_URL` (+ `CSRF_ALLOWED_ORIGINS`) |
| Frontend/backend | mismo host `localhost` (puertos distintos) | subdominios `crm-*` / `api.crm-*` (same-site) |

## 8. Variables de entorno

- `CSRF_ALLOWED_ORIGINS` (opcional): lista separada por comas de orígenes extra
  permitidos en los endpoints de cookie. Si no se define, se usa `FRONTEND_URL`.
- `FRONTEND_URL`: ya existente (CORS + allowlist de Origin).
- `NODE_ENV=production` en staging/producción (activa `secure`).

Ningún ejemplo contiene secretos reales.

## 9. Limitaciones conocidas (pendientes)

- **Reuse-detection del refresh token:** hoy un token ya rotado (robado) que se
  reintenta devuelve 401 genérico; no mata la cadena de sesión como señal de
  robo. Recomendado para una fase posterior (con guardia atómica de rotación).
- **SameSite=strict** opcional para el refresh (más estricto que `lax`); se
  mantuvo `lax` por compatibilidad, con Origin como defensa adicional.
- CSP / Helmet / security headers: **fase separada** (no en esta rama).
- Store de rate limiting compartido (Redis) para multi-instancia (fase previa).

## 10. QA para staging

Con un usuario ADMIN, AGENT y SUPER_ADMIN, verificar en DevTools (sin copiar
valores de tokens):

1. Login → `Application > Local Storage` / `Session Storage`: **sin** JWT (ni
   clave `token`).
2. `Cookies`: la de refresh es `HttpOnly` (no visible en `document.cookie`); no
   hay cookie `token` con JWT.
3. `IndexedDB`: sin bases con tokens.
4. Recarga completa → sigue autenticado (bootstrap).
5. Abrir directamente una ruta protegida → carga sin flash de contenido privado.
6. Abrir `/login` autenticado → redirige a `/dashboard`.
7. Logout → `/login`, storage limpio.
8. Dos pestañas: logout en una expulsa a la otra.
9. Revocar la sesión (panel de plataforma) → la siguiente acción/recarga expulsa
   a `/login`.
10. `Network`: `Authorization: Bearer` presente; el refresh token nunca aparece
    en cuerpos JSON.
