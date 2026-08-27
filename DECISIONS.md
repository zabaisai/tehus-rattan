# DECISIONS — Endurecimiento de seguridad (20 controles)

Decisiones de diseño tomadas durante este trabajo y su porqué. 2026-08-27.

## Base del trabajo: `main`, no `develop`

`origin/main` va ~269 commits por delante de `origin/develop` y contiene la
arquitectura real (Redis + BullMQ + worker, Socket.IO, PDF, flowbot, backups
offsite). Una primera auditoría sobre el checkout inicial (`develop`) resultó
obsoleta. Todo el trabajo se rebasó sobre `origin/main`.

## Realtime: validar la sesión en el handshake, no revalidar el socket vivo

El fallo NEW-1 era que un token con sesión revocada podía abrir un canal WS
nuevo. Se corrige validando la `UserSession` (`sid`) en el handshake, igual que
`JwtStrategy` en REST. **No** se añadió revalidación periódica del socket ya
conectado: un socket vivo sigue hasta expirar el access token (15 min). Cerrar
el canal nuevo es el 90% del riesgo y es un cambio contenido y probado; la
revalidación continua se deja como mejora para evitar complejidad y riesgo de
regresión en un camino crítico bien cubierto.

## Enumeración de onboarding: mensaje genérico y validar invitación primero

Se colapsan los mensajes invalid/revoked/used/expired del código de invitación
en uno genérico (elimina el oráculo de estado) y se valida la invitación ANTES
de consultar los emails (un código inválido ya no permite sondear cuentas). Se
acepta la pequeña pérdida de detalle para el usuario legítimo: es el compromiso
estándar anti-enumeración. Se actualizaron 4 tests para el nuevo contrato — no
se debilitó ninguno; el nuevo comportamiento es más seguro.

## Validación de entorno: gating por producción

`JWT_SECRET` (≥32), `DATABASE_URL` y `WHATSAPP_TOKEN_ENCRYPTION_KEY` se exigen y
se comprueban en longitud **solo en producción**. Motivo: dev/test/CI usan
fixtures cortos (p. ej. `ci-dummy-...`) y romperlos habría tumbado toda la suite
sin ganar seguridad. En producción el arranque falla si faltan o son débiles.

## `sslmode=require` NO se puso en la plantilla de staging

Postgres del stack corre sin certificados TLS; poner `sslmode=require` en
`staging.env.example` rompería la conexión. La topología actual (red Docker
`internal`, sin puerto publicado) hace aceptable el texto plano en tránsito. Se
documenta para el momento en que Postgres salga del host, sin romper hoy.

## Cifrado de tokens: no cambiar la derivación de clave ahora

La derivación es `sha256(raw)` sin sal. Migrar a scrypt/HKDF rompería todos los
ciphertexts existentes de tokens de WhatsApp. Se mitiga exigiendo longitud
mínima de clave y se deja la migración de KDF (con prefijo de versión, en una
ventana de rotación) como deuda. No se tocó AES-256-GCM, que es correcto.

## RLS: no fingirlo

RLS con el propietario de tablas como usuario runtime sería omitido. En vez de
activar políticas que no protegen, se documenta la precondición (separar roles)
como acción humana P1 y se deja el plan exacto. Los filtros por `companyId` de
aplicación siguen siendo la barrera activa.

## CI: bloquear solo en críticas de dependencias

`npm audit` en CI falla en CRITICAL y reporta HIGH. Los altos actuales
(sharp/libvips de Next, cadena del CLI de Prisma) no tienen arreglo no-rompedor y
no son explotables con input de usuario en runtime; Dependabot los resolverá
cuando haya versión compatible. Bloquear en HIGH dejaría el CI rojo de forma
permanente sin ganar seguridad real.

## Acciones fijadas por SHA al mismo major (v4)

`actions/checkout`/`setup-node` se fijaron a SHAs de v4.4.0 (no v7) para cumplir
"versiones fijadas" sin un upgrade mayor a ciegas. Dependabot (github-actions)
las mantendrá.

## Alcance: no tocar la topología de red del worker

La auditoría señaló que el `worker` de staging está solo en la red `internal`
(sin salida a `graph.facebook.com`). Es una cuestión funcional/infra a verificar
en el VPS, no uno de los 20 controles de seguridad, y cambiar la topología a
ciegas reduciría aislamiento. Se deja anotado, sin editar el compose de staging.
