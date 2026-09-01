# PROCESS_MAP — Seguridad de TAKTO (mapa vivo)

Cómo fluye la seguridad por el sistema. 2026-08-27. Documento vivo: actualízalo
al cerrar cada bloque.

## Autenticación (REST)

```
Cliente ──Authorization: Bearer <access JWT (15m, HS256)>──▶ NestJS
  JwtStrategy.validate:
    - exige `sid`; consulta UserSession en cada request
    - rechaza si: no existe / userId|companyId no casan / status≠ACTIVE /
      revokedAt / loggedOutAt / inactividad
  ⇒ revocar sesión surte efecto inmediato, no al expirar el token
Algoritmo fijado: HS256 (allowlist en firma y verificación).
```

## Sesiones

```
login/refresh/onboarding ─▶ set-cookie tehus_refresh_token
  httpOnly, secure(prod), SameSite=Lax, path=/api/auth, sin Domain
  refresh token: opaco 32B, guardado como SHA-256
  rotación: updateMany CAS (status=ACTIVE + hash) ⇒ una sola gana
  revocación: por logout / password reset / panel plataforma
Deuda: sin detección de reutilización; store de throttler en memoria.
```

## Multiempresa (aislamiento)

```
companyId SIEMPRE desde req.user (JWT), nunca del body/cliente.
BusinessTenantGuard exige companyId; PlatformGuard exige SUPER_ADMIN+companyId null.
Cada servicio filtra por companyId; escrituras precedidas de findFirst scoped.
Corregido: analytics.getLeadsByStage (pipeline.companyId),
           task-suggestions.aprobar (valida assignedTo de la empresa).
Red de seguridad por debajo (RLS): PENDIENTE (control 4).
```

## RLS (plan, aún no activo)

```
Precondición: rol runtime `takto_app` sin BYPASSRLS ni propiedad de tablas,
              separado del rol de migración (propietario/DDL).
Luego: ENABLE + FORCE ROW LEVEL SECURITY por tabla multiempresa;
       política USING/WITH CHECK sobre current_setting('app.company_id', true);
       set_config('app.company_id', $id, true) por transacción (no session-scoped,
       para no filtrar entre conexiones del pool);
       $extends de Prisma que fije el contexto por petición (API, worker, jobs).
Estado: BLOQUEADO — ver USER_ACTIONS_REQUIRED.md (P1).
```

## Cifrado

```
Tokens de WhatsApp: AES-256-GCM, IV 12B único por cifrado, auth tag verificado.
  Clave: env WHATSAPP_TOKEN_ENCRYPTION_KEY (fuera de repo/BD), + PREVIOUS para
  rotación. Validada al arranque (requerida + ≥32 en prod).
Contraseñas / tokens reset / invitaciones / refresh: HASH (bcrypt / sha256).
En tránsito: HTTPS en el borde (Caddy). PostgreSQL sin TLS (red interna) — deuda.
Deuda: KDF con sal + versión de clave.
```

## Archivos

```
Subida: logos por magic bytes (no MIME/extensión), nombre por servidor,
        ruta por companyId de sesión; import de productos en streaming (solo
        texto de celda) con neutralización de fórmulas en ingesta.
Servido: /uploads estático con index:false, dotfiles:deny, nosniff,
         Content-Disposition. PÚBLICO (los <img> lo cargan sin auth) ⇒ la
         confidencialidad entre empresas depende del nombre no adivinable.
Deuda: firma ZIP/OOXML en import; servido autenticado por empresa.
```

## CSRF / CORS

```
CookieOriginGuard (allowlist de Origin) en login/refresh/logout/forgot/reset
  y ahora en onboarding/company (acuña cookie de ADMIN).
CORS: orígenes exactos, credenciales, sin comodín; allowedHeaders incluye
  Content-Type, Authorization, X-Onboarding-Invite-Code.
```

## Realtime (WebSocket)

```
Handshake: token de auth.token (no en URL). Verifica JWT (HS256) + companyId +
  VALIDA UserSession(sid) contra la base (revocación efectiva también en WS).
Salas derivadas del token (company:<id>, user:<id>, conversation con companyId).
Suscripción a conversación: comprobada contra la base por companyId.
Deuda: socket vivo no se revalida hasta expirar el token (15m).
```

## CI de seguridad

```
ci.yml: permissions: contents:read; acciones fijadas por SHA (v4.4.0);
        typecheck + lint + unit + build + migrate + e2e (Postgres+Redis reales).
security.yml (push/PR + semanal, read-only):
  - gitleaks (--all, .gitleaks.toml) ⇒ falla ante secreto confirmado
  - npm audit backend/frontend ⇒ falla en CRITICAL, reporta HIGH
  - CodeQL javascript-typescript (security-extended)
dependabot.yml: npm ×2 + github-actions + docker.
```

## Dependencias

```
0 críticas. Altas aceptadas y documentadas (sharp/libvips de Next; cadena del
CLI de Prisma) — sin arreglo no-rompedor; Dependabot al haber versión compatible.
Scripts postinstall revisados (prisma/engines/msgpackr/unrs-resolver: legítimos).
```

## Estado y bloqueos

```
CORREGIDO: 1,6(WS),7,9,15,16*,17,20   VERIFICADO: 2,3,8,10,13,14,18
PARCIAL:   5,11,19                     BLOQUEADO: 4 (RLS), 12 (antibot)
Bloqueos requieren acción humana ⇒ USER_ACTIONS_REQUIRED.md.
```
