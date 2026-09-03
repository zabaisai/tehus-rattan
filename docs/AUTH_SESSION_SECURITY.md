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
- **Rotación atómica (compare-and-swap):** cada `/auth/refresh` genera un token
  nuevo. La escritura es un `updateMany` condicionado a `id` + `status ACTIVE` +
  `refreshTokenHash` **todavía igual** al presentado; si `count !== 1` la rotación
  perdió la carrera (otra petición ya rotó ese token) y devuelve fallo genérico
  **sin** sobrescribir el hash ganador ni revocar la sesión. Esto elimina la
  condición de carrera en la que dos refresh concurrentes con el mismo token
  ambos tenían éxito y desincronizaban la cookie del hash final en BD. No requiere
  cambios de modelo Prisma ni migración: Postgres (READ COMMITTED) bloquea la fila
  en el `UPDATE ... WHERE`, serializando los dos intentos. El token anterior deja
  de resolver (rechazado).
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

- `BroadcastChannel('takto-auth')` (durante la transición también se escucha el legacy `tehus-auth`; nunca se emite en él) solo transmite **tipos de evento**
  (`logout`, `session-invalidated`) — nunca tokens ni credenciales.
- Cada pestaña mantiene su propio access token en memoria y lo deriva por
  refresh. Al recibir un evento de otra pestaña, limpia su sesión y va a
  `/login`. Degrada a no-op si `BroadcastChannel` no está disponible.
- **Serialización de refresh entre pestañas (Web Locks API):** además del
  single-flight `refreshPromise` por pestaña, `refreshWithCrossTabLock`
  (`lib/axios.ts`) toma el lock exclusivo con nombre estable `takto-auth-refresh`
  (`navigator.locks.request`) para que dos pestañas no roten el mismo token en el
  mismo instante. El lock **solo ordena** los refresh: cada pestaña hace su propia
  petición y guarda su propio access token en memoria — nunca se comparte un token
  por el canal ni por el lock.
- **Fallback seguro:** si Web Locks no está disponible, o si adquirir el lock
  excede `LOCK_TIMEOUT_MS` (5 s, vía `AbortController`), se degrada a un refresh
  sin lock. Ese fallback sigue siendo seguro y sin bucles gracias a dos capas:
  (a) `attemptRefresh` reintenta **una sola vez** ante un 401 recuperable (otra
  pestaña ya rotó la cookie compartida, así que el reintento usa la cookie ya
  vigente y tiene éxito); (b) la rotación atómica del backend (§3) garantiza que
  solo una de las dos peticiones concurrentes consuma el token. Un 401
  recuperable **no** emite `session-invalidated`; solo dos fallos seguidos (sesión
  realmente inválida) limpian la sesión y redirigen.

## 5b. Clasificación de fallos de refresh (solo una sesión inválida cierra sesión)

`attemptRefresh` (`lib/axios.ts`) ya no colapsa todos los errores en
`string | null`. Devuelve un resultado tipado (`RefreshResult`) y cada llamador
ramifica según el caso — así un 429 o un corte de red temporal **nunca** se
confunden con una sesión realmente inválida (el bug que provocaba un logout
global ante cualquier dos fallos seguidos):

| Situación | Clasificación | Efecto |
| --- | --- | --- |
| 200 | `success` | nuevo access token en memoria |
| 1er 401 | (carrera CAS recuperable) | **exactamente un** segundo intento con la cookie ya rotada |
| 2º 401 | `invalid-session` | **único** caso que limpia memoria, emite `session-invalidated` y redirige a `/login` |
| 429 | `transient-error` | sin logout, sin broadcast, sin redirección; **no** hay reintento inmediato que empeore el límite (se anota `Retry-After` si viene) |
| 5xx (500/502/503) | `transient-error` | sin logout; sesión conservada |
| Error de red / timeout (sin `response`) | `transient-error` | sin logout; sesión conservada; sin bucle |
| 403 | `configuration-error` | sin logout, sin tormenta de reintentos; se registra una vez para diagnóstico (Origin/config) |
| Otro 4xx inesperado | `transient-error` | conservador: nunca fuerza un logout falso |

El interceptor de Axios reintenta la petición original **solo** en `success`; en
`transient-error`/`configuration-error` rechaza el error original **conservando**
la sesión. La propagación cross-tab (`session-invalidated`) ocurre únicamente en
`invalid-session`.

## 5c. Bootstrap indisponible (estado `unavailable`)

Durante una recarga, el bootstrap (`auth-bootstrap.ts`) llama a refresh antes de
que exista un access token en memoria. Si ese refresh falla de forma **transitoria**
(429 / red / timeout / 5xx) o por configuración (403), el estado del store pasa a
`unavailable` (no a `anonymous`): la sesión podría seguir viva y no podemos
confirmarlo, así que **no** se muestra el formulario de login como si hubiera
expirado. `AuthGate` y `/login` renderizan `ConnectionUnavailable`:

- mensaje "No pudimos conectar con el servidor" + botón **Reintentar**;
- **no** muestra contenido privado ni el login incorrectamente;
- **no** hay reintento automático ni bucle — el usuario decide (`retryBootstrap`
  reinicia el single-flight y vuelve a `bootstrapping`);
- un reintento exitoso continúa el bootstrap → `authenticated` sin reingresar
  credenciales; un 401 realmente inválido termina en `anonymous`.

## 6. Protección Origin / CSRF

- Defensa principal: `SameSite=lax` en la cookie de refresh (bloquea POST
  cross-site con la cookie). En staging, frontend (`crm-staging.*`) y backend
  (`api.crm-staging.*`) comparten el dominio registrable → son **same-site**, así
  que la cookie viaja en fetch entre ellos; un sitio atacante (cross-site) no la
  envía.
- Defensa en profundidad: `CookieOriginGuard` valida el header `Origin` en
  `POST /auth/login|refresh|logout`. Allowlist: `FRONTEND_URL`
  (+ `http://localhost:3000` en no-producción, o `CSRF_ALLOWED_ORIGINS`).
  - Origin presente y no permitido (incluido el literal `"null"` de un origen
    opaco/sandbox) → **403**.
  - Origin **ausente**: en `NODE_ENV=production` **falla cerrado** (403) porque
    login/refresh/logout son endpoints de navegador y un navegador siempre envía
    Origin en estos POST; en no-producción (dev / E2E) se permite para clientes no
    browser (curl, supertest) de forma controlada.
  - En producción, si no hay ningún origen configurado (sin `FRONTEND_URL` ni
    `CSRF_ALLOWED_ORIGINS`) la allowlist queda vacía y **toda** petición se rechaza
    — fail-closed deliberado ante mala configuración.
- `secure` está condicionado a `NODE_ENV === 'production'`: **staging debe
  correr con `NODE_ENV=production`** para que la cookie nunca viaje por HTTP.

## 6b. Rate limiting de refresh (por dispositivo, no por IP compartida)

- El rate limiting global (`@nestjs/throttler`) es **por IP** en todas las rutas,
  **excepto** `POST /auth/refresh`, que `AppThrottlerGuard` agrupa **por
  dispositivo** usando la cookie httpOnly `takto_device_id` (fallback temporal de lectura: `tehus_device_id`; ver `docs/phase-1/IDENTITY-CONTRACT.md` § Namespace técnico).
- **Por qué:** con un único bucket por IP, toda una oficina detrás de un NAT/IP
  pública compartía un solo presupuesto de refresh, y varios compañeros recargando
  a la vez podían agotarlo y expulsarse entre sí (429). Con bucket por dispositivo,
  cada navegador real tiene su propio presupuesto (`THROTTLE_REFRESH_LIMIT`, 30/min
  por defecto — muy holgado para un dispositivo honesto; la oficina completa es
  ≈ `N_dispositivos × límite`).
- **Antiabuso:**
  - la clave se deriva del device-id que el cliente **envió**, no del que el
    middleware pudo acabar de emitir; un cliente sin cookie de device-id (curl,
    script, atacante) cae al bucket por **IP**, así que el límite por dispositivo
    no se elude simplemente omitiendo la cookie. La cookie es httpOnly → el JS de
    la página no puede rotarla por petición;
  - un único dispositivo (honesto o abusivo) mapea a exactamente un bucket y sigue
    acotado al límite por dispositivo;
  - **login no se ve afectado**: sigue siendo estrictamente **por IP**, para no
    diluir la protección contra fuerza bruta de credenciales.
  - el device-id se **hashea (SHA-256)** antes de ser clave de bucket; nunca se
    almacena en crudo ni se registra en logs (tampoco el refresh token ni hashes).
- Un 429 de refresh es **transitorio** en el cliente (§5b): no expulsa.

## 7. Comportamiento por entorno

| | Desarrollo | Staging / Producción |
| --- | --- | --- |
| `secure` en cookie | off (`NODE_ENV != production`) | on |
| Origins permitidos | `FRONTEND_URL` + `localhost:3000` | `FRONTEND_URL` (+ `CSRF_ALLOWED_ORIGINS`) |
| Origin ausente en POST de auth | permitido (curl / supertest) | **403** (fail-closed) |
| Frontend/backend | mismo host `localhost` (puertos distintos) | subdominios `crm-*` / `api.crm-*` (same-site) |

## 8. Variables de entorno

- `CSRF_ALLOWED_ORIGINS` (opcional): lista separada por comas de orígenes extra
  permitidos en los endpoints de cookie. Si no se define, se usa `FRONTEND_URL`.
- `FRONTEND_URL`: ya existente (CORS + allowlist de Origin).
- `NODE_ENV=production` en staging/producción (activa `secure`).
- `THROTTLE_REFRESH_LIMIT` (opcional, 30): tope de refresh **por dispositivo** por
  ventana `THROTTLE_TTL` (§6b). `THROTTLE_AUTH_LIMIT` (login) permanece por IP.

Ningún ejemplo contiene secretos reales.

## 9. Limitaciones conocidas (pendientes)

- **Reuse-detection del refresh token:** hoy un token ya rotado (robado) que se
  reintenta devuelve 401 genérico; no mata la cadena de sesión como señal de
  robo. La rotación atómica (§3) ya distingue al ganador del perdedor de forma
  determinista, así que una fase posterior puede construir sobre ella la detección
  de reuse (matar la cadena) sin reintroducir la condición de carrera.
- **Errores transitorios de refresh** (429 / red / 5xx): ya **no** provocan un
  logout falso — se clasifican como recuperables y el bootstrap muestra
  `unavailable` con reintento (§5b/§5c). Resuelto en esta rama.
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
11. **Refresh concurrente entre pestañas:** con dos pestañas autenticadas,
    forzar refresh casi simultáneo (recargar ambas a la vez, o dejar caducar el
    access token en ambas). Resultado esperado: **ambas** siguen autenticadas, sin
    expulsión ni bucle de refresh; un refresh adicional en cualquiera funciona
    (cookie y hash en BD siguen sincronizados). Un refresh **genuinamente**
    inválido (sesión revocada) sí expulsa. En `Network`, la carrera recuperable no
    debe disparar redirección a `/login`.
12. **Errores transitorios de refresh (§5b/§5c):** provocar en `Network` un
    refresh con 429 (o cortar el backend un momento) durante una recarga. Esperado:
    pantalla "No pudimos conectar con el servidor" + **Reintentar**, **sin** caer al
    login ni mostrar contenido privado; al restaurar el backend, **Reintentar**
    recupera la sesión **sin** reingresar credenciales. Solo dos 401 reales (sesión
    revocada/expirada) expulsan a `/login`.
13. **Rate limit por dispositivo (§6b):** dos navegadores/dispositivos distintos
    detrás de la misma IP no deben agotarse el presupuesto de refresh entre sí; un
    único dispositivo que abuse sí recibe 429. `login` permanece limitado por IP.
