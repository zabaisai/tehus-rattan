# Fase 4.5 — Evidencia

Estado: **PASS** (2026-09-04). Todo lo que sigue son resultados reales: pruebas
locales, CI, despliegue oficial con migración, activación controlada, QA con un
correo recibido de verdad y limpieza por ID. Sin secretos, sin códigos, sin
direcciones completas, sin IDs completos.

## Contexto

- Base: `origin/main` `32d3515` (Fase 4 cerrada). Rama
  `feat/phase-4-5-auth-experience`.
- Runtime de staging al empezar: `38c1575` (Fase 4). Producción: no existe
  (`crm.takto.online` y `api.crm.takto.online` sin DNS; no se tocan).
- Merge de implementación: PR #28 → `main` `52289a8` (merge commit).

## Pruebas locales

| Ámbito | Resultado |
| --- | --- |
| Backend: prisma validate, typecheck, lint | OK, 0 errores, 0 avisos |
| Backend: unitarias (`--runInBand`) | **158 suites / 2556 pruebas** |
| Backend: build | OK |
| Backend: e2e con PostgreSQL y Redis reales | **74 suites / 1110 pruebas** |
| Frontend: typecheck, lint | OK (2 avisos anteriores a la fase) |
| Frontend: Vitest | **116 ficheros / 1235 pruebas** |
| Frontend: build de producción | OK |

Línea base antes de tocar código: 153/2473 unitarias, 72/1065 e2e, 113/1183
frontend. QA local con el producto levantado y un servidor SMTP de pruebas: 36
comprobaciones por API y 28 por navegador, 0 fallos. Detalle en `TEST-MATRIX.md`.

## Seguridad del diff

- Escaneo de secretos sobre el diff completo (secreto HMAC, contraseña SMTP,
  hashes bcrypt, claves privadas, la dirección de QA, marcas temporales):
  **sin hallazgos**. Los ficheros de entorno reales no entran en el
  repositorio; solo se documentan los nombres en los ejemplos.
- 52 ficheros, +6864/−160. **0** ficheros fuera de `apps/`, `docs/`,
  `deploy/env/` y `.env.example`.

## CI y PR

| Elemento | Resultado |
| --- | --- |
| PR | #28 `feat/phase-4-5-auth-experience` → `main` (52 ficheros) |
| CI «Frontend (test / lint / build)» | pass, 2m57s, primer intento |
| CI «Backend (validate / test / build / e2e)» | pass, 3m11s, primer intento |
| Reintentos | ninguno |
| Merge | merge commit `52289a8`; `main` local avanzado por fast-forward |

## Despliegue en staging

Precondiciones (solo lectura): host `srv1829292`, usuario `deploy`,
`/opt/tehus-crm` en `main` `32d3515` limpio; contenedores sanos; runtime
`38c1575`; disco 12 %; sin procesos de deploy o backup en curso; 2 timers
activos, 0 unidades fallidas; repositorio cifrado verificado con 3 instantáneas
y «no errors were found»; esquema al día. Diff a desplegar: 52 ficheros, 0
fuera del alcance, **1 migración aditiva**.

Procedimiento oficial `./deploy/scripts/deploy.sh` (desatendido, log privado
`chmod 600`):

| Paso | Resultado |
| --- | --- |
| Rollback target registrado | `32d3515` |
| Pre-migration backup | DB `tehus-crm-staging-20260904-174229.sql.gz` (56K) + `.sha256`; uploads `…-uploads-20260904-174229.tar.gz` (900K) |
| `prisma migrate deploy` | 60 migraciones; **aplicada** `20260905090000_verificacion_de_dispositivo` |
| Tablas nuevas | `device_verification_challenges` y `trusted_devices` creadas |
| `compose up -d` | backend, frontend y worker recreados |
| `health-check.sh` | **All checks passed** |
| `smoke-test.sh` (`EXPECTED_RELEASE=52289a8…`) | 22 passed, 0 failed |
| Release publicado | `52289a83af2c2c1f2bbde013e652a858dd652d72` (`builtAt` 2026-09-04T22:40:16Z) |
| `/api/health/status` | database, queue, worker, outbox, realtime y flowbot en `up` |
| Producción | no tocada; sin DNS |

## Activación controlada

Antes de tocar la configuración se guardó una copia con permisos `600`
(`.env.staging.bak-antes-fase45-<marca>`). Después se añadieron tres variables
y se reinició **solo** el backend y el worker:

| Variable | Estado |
| --- | --- |
| `AUTH_DEVICE_VERIFICATION_ENABLED` | `true` |
| `AUTH_CHALLENGE_HMAC_SECRET` | generado con `openssl rand -base64 48`, 64 caracteres, distinto de `JWT_SECRET`, nunca impreso |
| `AUTH_DEVICE_VERIFICATION_ALLOWLIST` | una sola dirección de QA autorizada |

`.env.staging` conserva permisos `600`; el log del despliegue no contiene el
secreto ni la contraseña SMTP (comprobado). El arranque fue limpio y la salud
volvió a pasar completa.

**Estado final: la verificación queda encendida pero limitada a esa única
dirección**, que tras la limpieza ya no corresponde a ninguna cuenta. Ninguna
cuenta real de staging pide código. Para pasar a activación total basta con
vaciar `AUTH_DEVICE_VERIFICATION_ALLOWLIST` y reiniciar el backend; para
desactivarla, poner el interruptor en `false` (ver `ROLLBACK.md`).

## QA en staging

Empresa y usuarios temporales `QA_PHASE45_<marca>`, con el administrador en la
dirección de QA autorizada por el propietario del proyecto. La contraseña se
generó aleatoriamente en un archivo local `600`, ya eliminado, y nunca se
imprimió. **El código se leyó del buzón real**, nunca de la base de datos.

**Por API: 28 comprobaciones, 0 fallos** (14 antes de recibir el código y 14
con él).

| Bloque | Verificado |
| --- | --- |
| Despliegue controlado | La cuenta fuera de la allowlist entra sin código y recibe su sesión; la cuenta incluida sí verifica |
| Credenciales | Contraseña incorrecta y cuenta inexistente responden exactamente igual (401 genérico) |
| Origen | Origen ajeno → 403 |
| Dispositivo nuevo | `verification_required` sin token ni cookie de sesión; `/auth/me` sigue cerrado; destino enmascarado `is***@gmail.com` |
| Correo real | Recibido en el buzón con la marca, el código y la vigencia |
| Código | Incorrecto → error genérico; clave desconocida en el cuerpo → 400; reenvío antes de tiempo → 400 con los segundos que faltan |
| Verificación | El código real abre la sesión y el token sirve contra `/auth/me`; el mismo código no vale una segunda vez |
| Cookie del dispositivo | `__Host-takto_trusted_device`, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, **sin `Domain`** |
| Confianza | El segundo acceso desde ese navegador no pide código; un navegador limpio sí |
| Revocación | `trusted-devices/revoke-all` responde el conteo y el mismo navegador vuelve a pedir código |

**Por navegador (Chrome headless): 25 comprobaciones, 0 fallos, 0 errores de
consola.**

| Bloque | Verificado |
| --- | --- |
| Acceso | Un solo `h1`; panel de TAKTO con «Vista ilustrativa…»; dice `Correo`; botón `Continuar`; sin marcas del prototipo ni datos ficticios de empresas; sin promesas de seguridad falsas |
| Contraseña | El botón de ver contraseña cambia el tipo del campo |
| Verificación | Destino enmascarado, correo completo oculto, seis casillas, cuenta atrás real, «Enviar otro código» con su espera, casilla de confianza **desmarcada** y su aviso; sin «código de prueba» |
| Anchos 320 / 390 / 768 / 1024 / 1280 / 1440 / 1920 | Sin scroll horizontal, sin controles sin nombre y **ningún control por debajo de 40 px**; el panel decorativo no se monta por debajo de 1024 px |
| Red | Única respuesta ≥400: `401 /api/auth/refresh` del arranque anónimo, anterior a la fase |

**Verificación en base.** Cinco retos (uno consumido, tres revocados, uno
vivo), todos con huella hexadecimal de 64 caracteres y ninguno con el código;
un dispositivo confiable revocado por la prueba; IP truncada (`190.28.66.0`);
auditoría con los cinco eventos —creado, fallido, verificado, dispositivo
creado y dispositivo revocado— y **sin secretos**.

## Limpieza y comparación antes/después

Borrado por ID exacto, verificando el prefijo: 5 retos, 1 dispositivo, 9 filas
de auditoría, 5 eventos de acceso, 3 sesiones, 3 etapas, 1 pipeline, 2 usuarios
y 1 empresa. Además se borró un evento de acceso anónimo generado por la prueba
de no enumeración. **Residuos: 0** en todas las tablas, incluidas las nuevas.

| Métrica | Antes | Después |
| --- | --- | --- |
| companies | 4, hash `2466e01f…` | igual |
| users | 9, hash `8654ed52…` | igual |
| invitation_codes | 3, hash `9fa3d97f…` | igual |
| pipelines / stages | 4 `61068a28…` / 23 `fa39f81d…` | iguales |
| products | 3, hash `28749f20…` | igual |
| audit_logs / sessions | 204 / 27 | 204 / 27 |
| login_events | 106 | 107 (+1: fila anónima FAILED del propio `smoke-test.sh`, como en las fases 3 y 4) |
| leads / contacts / quotes | 8 / 12 / 2 | iguales |
| tehus_present | 1 | 1 (Tehus sin cambios) |
| migrations_applied | 59 | 60 (la migración aditiva de esta fase) |
| `device_verification_challenges` / `trusted_devices` | — | 0 / 0 |

Post-limpieza: `health-check.sh` **All checks passed**, release sigue en
`52289a8`, contenedores sanos, 2 timers activos, 0 unidades fallidas.

## Hallazgo de entrega de correo

El primer código salió y el proveedor lo aceptó (queda registrado como
despachado), pero no apareció en la bandeja de entrada: el dominio remitente
publica SPF y DMARC (`p=none`) pero **no publica DKIM**, y Gmail desvía esos
mensajes. El segundo envío se localizó en la carpeta de spam y el recorrido se
completó con él.

No se tocó ningún DNS: queda como deuda operativa publicar el selector DKIM del
dominio remitente para que el código llegue a la bandeja principal. Es un
cambio de DNS del dominio, fuera del alcance autorizado de esta fase.

## Cierre

- Producción, DNS, Meta/WhatsApp: no tocados.
- Ninguna contraseña de cuentas reales se cambió; no se envió correo a ninguna
  dirección que no fuera la de QA autorizada.
- Worktree principal, stash y worktrees de otras fases: intactos.
- Archivos locales temporales (credenciales, semillas, perfiles): eliminados.
- Veredicto: **FASE 4.5 CERRADA — PASS**.
