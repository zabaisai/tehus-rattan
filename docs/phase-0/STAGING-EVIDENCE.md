# Fase 0 — Evidencia de staging

Evidencia sanitizada de las sesiones de cierre de la Fase 0 (2026-09-02 y 2026-09-03). Todo lo que contenga
identificadores internos, nombres de clientes, correos, códigos o rutas
sensibles vive en el directorio de evidencia privada fuera de Git (ver
[README](README.md#evidencia-privada)).

## Contexto

| Dato | Valor |
|------|-------|
| Fecha (UTC) | 2026-09-02, 16:51Z – 16:59Z |
| Commit `origin/main` | `d42102103a8659969bc886870ce1c7c1ae28d24f` |
| Commit desplegado (`/opt/tehus-crm`, rama `main`, worktree limpio) | `d42102103a8659969bc886870ce1c7c1ae28d24f` |
| `/api/health/version` | `release` = mismo commit, `builtAt` 2026-09-01T21:38:19Z |
| Servidor | host `srv1829292`, usuario `deploy`, remoto `zabaisai/tehus-rattan` |
| Producción | no existe todavía como entorno separado; no se ejecutó ningún comando fuera de staging |

## Estado de servicios

Antes y después de todas las operaciones (`health-check.sh`, 12/12 OK):

| Servicio | Antes | Después |
|----------|-------|---------|
| postgres | running (healthy) | running (healthy) |
| redis | running (healthy) | running (healthy) |
| backend | running (healthy) | running (healthy), nunca detenido |
| worker | running (healthy) | running (healthy) |
| frontend | running (healthy) | running (healthy) |
| caddy | running | running |
| `/api/health`, `/ready`, `/status`, `/queue` | `ok` / `up` | `ok` / `up` |
| HTTPS público (API y frontend) | 200 | 200 |

## Inventario agregado (solo lectura, `BEGIN TRANSACTION READ ONLY … ROLLBACK`)

Consulta: [staging-inventory.sql](staging-inventory.sql). Base: PostgreSQL 16.14,
58 migraciones Prisma aplicadas (última: 2026-08-18).

| Métrica | Valor |
|---------|-------|
| Empresas | 4 (4 ACTIVE, 0 SUSPENDED, 0 DELETED, 1 demo) |
| Empresas sin `slug` / sin `settings` / sin `businessType` | 1 / 2 / 2 |
| Usuarios | 9 (9 activos, 0 inactivos, 1 SUPER_ADMIN sin empresa) |
| Roles | 1 SUPER_ADMIN, 3 ADMIN, 5 AGENT |
| Usuarios por empresa | 2, 1, 2, 3 |
| Pipelines por empresa | 1 cada una (todas con `isDefault`) |
| Etapas por pipeline | 5, 6, 5, 7 (total 23) |
| Filas en `company_lead_settings` | 0 (ninguna empresa tiene configuración propia de leads) |
| Definiciones de campos personalizados | 0 |
| Productos | 3 en total (una sola empresa, la demo); la empresa Tehus tiene 0 |
| Categorías de producto en BD | 0 distintas |
| Categorías en `Company.settings.categories` | solo una empresa las tiene (2), ambas dentro de la lista fija de muebles |
| Contactos / leads / conversaciones / mensajes | 12 / 8 (7 OPEN, 1 WON) / 9 / 37 |
| Tareas / cotizaciones / flowbots | 3 / 2 / 5 |
| Integraciones WhatsApp | 3 (2 en una empresa, 1 en otra) |
| Códigos de invitación | 1 USED, 0 ACTIVE, 0 REVOKED (ni código ni preview impresos) |
| Controles de aislamiento multiempresa | 16 comprobaciones cruzadas, todas en 0 |

Hallazgos funcionales derivados del inventario (sin identificar empresas):

- Solo 1 de 4 empresas tiene etapas tipadas WON/LOST; en las demás, las
  etapas "Cerrado ganado/perdido" son de tipo OPEN. Una empresa no tiene
  etapa inicial marcada.
- Ninguna empresa tiene fila en `company_lead_settings`: todas operan con
  los defaults implícitos del código.
- Una empresa no tiene `slug` ni `settings` (creada fuera del onboarding).
- Los colores por defecto del formulario de onboarding coinciden con los
  colores de marca guardados de un tenant existente (ver
  [TECHNICAL-INVENTORY](TECHNICAL-INVENTORY.md#dependencias-globales-de-un-tenant)).

## Backup nuevo (mecanismo oficial local)

Comando: `RETENTION_DAYS=3650 ./deploy/scripts/backup-postgres.sh` (el mismo
script que entonces ejecutaba el cron diario de las 03:00, retirado más tarde ese día; la retención se elevó por
variable de entorno para no borrar ningún respaldo previo durante la sesión).

| Artefacto | Resultado |
|-----------|-----------|
| Dump PostgreSQL `tehus-crm-staging-20260902-115652.sql.gz` | 49 729 bytes, `600 deploy:deploy`, gzip íntegro, 58 `CREATE TABLE`, 58 bloques `COPY` |
| Sidecar `.sha256` del dump | `600 deploy:deploy`, `sha256sum -c` OK |
| Uploads `tehus-crm-staging-uploads-20260902-115652.tar.gz` | 917 642 bytes, 6 entradas, tar íntegro, **`644 root:root`** (ver hallazgo B-02) |
| Sidecar `.sha256` de uploads | `600 deploy:deploy`, `sha256sum -c` OK |
| Mismo ciclo | dump y uploads comparten el timestamp `20260902-115652` |
| `backup-verify.sh` sobre el dump | PASS (checksum + gzip) |
| Directorio `backups/` | `700 deploy:deploy` |

## Snapshot cifrado off-site

| Comprobación | Resultado |
|--------------|-----------|
| Herramientas | restic 0.16.4 y rclone instalados; `flock`, `sha256sum` presentes |
| Secretos (`.env.backup`, `restic-password`, `rclone.conf`) | existen, `600 deploy:deploy`, ignorados por Git; contenido no leído |
| Backend configurado | `rclone:` (Google Drive), host `tehus-crm-staging`, tag `takto-staging` |
| Acceso al repositorio Restic | **FAIL**: `unauthorized_client` al refrescar el token OAuth de rclone; `restic snapshots` no puede abrir el repositorio |
| Unidades systemd `tehus-backup*`, `tehus-backup-drill*`, `tehus-backup-init` | instaladas (`static`/`disabled`), **sin ninguna ejecución registrada en journal** |
| Timers | deshabilitados, 0 timers listados |
| Existencia y fecha de un snapshot remoto | **no verificable** (no hay acceso) |

Conclusión en ese momento (16:59Z, superada ese mismo día; ver las
actualizaciones siguientes): no existía evidencia de ninguna copia cifrada
fuera del VPS y el respaldo diario era únicamente local (cron +
`backup-postgres.sh`).

## Restore drill aislado

El drill oficial (`backup-restore-drill.sh`) descarga el último snapshot
Restic; al no haber acceso al repositorio no puede ejecutarse. Se ejecutó en
su lugar la ruta oficial de restauración aislada del mismo tooling,
`restore-postgres.sh --target-db`, con el respaldo recién creado.

Precondiciones demostradas antes de restaurar:

- Nombre destino `tehus_restore_drill_phase0`: distinto de la base viva,
  cumple el patrón reservado `^tehus_restore_drill(_…)?$`, no existía antes.
- El script exige el sidecar `.sha256` y verifica checksum + gzip antes de
  tocar cualquier base; en la ruta `--target-db` no detiene el backend ni
  toca el volumen de uploads; sin `--replace-target` se niega a sobreescribir
  una base existente.
- Bases presentes antes: `postgres`, `tehus_crm_staging`.

| Comprobación | Resultado |
|--------------|-----------|
| Checksum + gzip verificados por el script | PASS |
| `CREATE DATABASE` + restauración con `ON_ERROR_STOP=1` | PASS (exit 0) |
| Esquema (`public.users` presente) | PASS |
| Conteo de filas en las 58 tablas, origen vs restaurada | idéntico (diff vacío) |
| Claves foráneas / índices / migraciones | 139 / 201 / 58 en ambas |
| Relaciones esenciales (leads↔pipelines↔contactos, etapas↔pipelines, usuarios↔empresas, mensajes↔conversaciones) | 0 huérfanos en ambas |
| Backend durante la prueba | nunca detenido, `healthy` |
| Eliminación de la base temporal | `dropdb tehus_restore_drill_phase0` exit 0; bases después: `postgres`, `tehus_crm_staging` |
| Base viva tras la limpieza | mismos conteos (4 empresas, 9 usuarios, 8 leads, 37 mensajes, 58 migraciones) |
| Directorio temporal / uploads activos | no se extrajo el tar; el volumen de uploads no se tocó |

Nota: el script tuvo que invocarse como `bash ./deploy/scripts/restore-postgres.sh`
porque el archivo no tiene bit de ejecución (ver hallazgo B-03).

## Actualización 2026-09-02 17:24Z–17:31Z — parche B-02/B-03 desplegado

| Dato | Valor |
|------|-------|
| PR | #16 `fix/phase0-backup-automation` → `main`, CI verde (backend, frontend, backup-safety) |
| Commit de rama / merge en `main` | `dd87a9a` / `a95da7e5d73e535652032f43ae42186b6583d436` |
| Deploy | `deploy/scripts/deploy.sh` oficial, 17:24:28Z–17:28:46Z, "No pending migrations", solo backend/frontend/worker recreados |
| Health check final de `deploy.sh` | falló por el gotcha conocido (corre ~2 s tras recrear el backend); `health-check.sh` a los 30 s: 12/12 OK |
| `/api/health/version` | `release` = `a95da7e…`, `builtAt` 2026-09-02T17:24:29Z |
| `smoke-test.sh` contra el dominio público | 22/22 PASS, release verificada |
| Modos en el VPS | `restore-postgres.sh`, `backup-postgres.sh`, `backup-verify.sh` → `775` (Git `100755`); `restore-postgres.sh` invocable por ruta |
| Backup previo del deploy (`…-122828`) y backup controlado (`…-123015`, `RETENTION_DAYS=3650`) | dump, uploads y ambos sidecars `600 deploy:deploy`, mismo ciclo, `backup-verify.sh` OK, `sha256sum -c` OK en uploads, 6 entradas |
| Artefactos anteriores al parche | 17 tarballs de uploads siguen `644 root:root` dentro del directorio `700`; expiran por retención (7 días). No se tocaron |

Controles 6 (backup de uploads) y B-03 pasan a **PASS** sin hallazgo. B-01 seguía abierto en ese momento (cerrado en las actualizaciones siguientes).

### B-01 — diagnóstico sanitizado (solo lectura)

- rclone 1.60.1 (paquete del sistema). Remotes configurados: `takto-drive` (cliente OAuth propio: `client_id`/`client_secret` presentes) y `takto-drive-legacy` (cliente por defecto de rclone). Ambos apuntan a la misma unidad compartida.
- `takto-drive`: token caducado el 2026-08-20; el refresco falla con `oauth2: unauthorized_client`. Ese error lo devuelve Google cuando el **cliente OAuth** no es válido (eliminado, deshabilitado o credenciales que no coinciden), no cuando solo caduca el token (`invalid_grant`).
- `takto-drive-legacy`: responde, refresca su token y lista `TAKTO_BACKUPS/staging`.
- A través del remote legacy (solo lectura, sin cambiar configuración) el repositorio Restic existe (`config`, `data/`, `index/`, `keys/`, `snapshots/`), la contraseña Restic lo descifra y contiene **1 snapshot** (2026-08-20 15:30, host y tag esperados). No hay que inicializar otro repositorio.
- `.env.backup` sigue apuntando a `rclone:takto-drive`. Los servicios systemd nunca han corrido (journal vacío); el snapshot existente se creó manualmente.

Opciones evaluadas en ese momento (resueltas en la actualización de las 19:03Z): reparar el cliente OAuth en Google Cloud y reconectar `takto-drive`, o cambiar `RESTIC_REPOSITORY` al remote legacy. En ambos casos, después: `tehus-backup.service` y `tehus-backup-drill.service` bajo observación; timers sin habilitar hasta autorización separada.

## Actualización 2026-09-02 19:03Z–19:12Z — B-01: repositorio off-site nuevo, primer backup y drill

Reautorización OAuth del remote `takto-drive` realizada manualmente por el
operador (cliente propio, ámbito `drive.file`, token renovado). Con
`drive.file` el cliente propio no ve la carpeta creada por el cliente por
defecto de rclone, así que el repositorio histórico queda como archivo de solo
lectura y se creó un repositorio nuevo en una carpeta propia.

| Paso | Resultado |
|------|-----------|
| Precondiciones | host/usuario/ruta/`main` a95da7e limpios, 12/12 OK, sin backup ni drill en curso, locks libres; conjunto local ~950 KB frente a 2,4 GiB libres en Drive; ruta nueva ausente en ambos remotes |
| Copia de `.env.backup` | con timestamp, `600 deploy:deploy`, hash idéntico; movida al directorio `.secrets` ignorado por Git |
| Cambio atómico | solo `RESTIC_REPOSITORY` → `rclone:takto-drive:TAKTO_BACKUPS_V2/staging` (archivo temporal + `mv`); diff de 1 línea, claves y permisos intactos |
| `tehus-backup-init.service` | `Result=success` (la unidad estaba `active/exited` desde el 2026-08-20 por `RemainAfterExit`, así que `start` fue no-op y se usó `restart` de la misma unidad). Repositorio v2 creado; `restic cat config` abre con la contraseña actual; 1 clave; 0 snapshots; estructura visible vía `takto-drive`; blob `config` cifrado |
| `tehus-backup.service` | `Result=success`, 45 s. Conjunto local `20260902-140712`: dump, uploads y sidecars `600 deploy:deploy`, checksums OK, gzip/tar íntegros, 6 entradas de uploads. Snapshot `937a…` 14:07:14 (hora VPS), host `tehus-crm-staging`, tag `takto-staging`, 4 archivos, 947 KiB. `forget --prune` aplicado solo al repositorio nuevo (1 snapshot conservado). `restic check`: "no errors were found". 0 secretos en el journal. Retención local oficial (7 días) borró el conjunto de uploads del 2026-08-25 |
| `tehus-backup-drill.service` | `Result=success`, 32 s. `restic check --read-data` 2/2 packs sin errores; snapshot `937a…` restaurado y descifrado; sidecars OK; tar validado; base reservada `tehus_restore_drill` creada (no existía) y eliminada al final; backend nunca reiniciado; sin directorios temporales residuales |
| Coherencia de conteos | restauración aislada del mismo dump (idéntico por checksum al del snapshot) en `tehus_restore_drill_phase0`: 58 tablas idénticas al origen, 139 FKs, 201 índices, 58 migraciones, 0 huérfanos; base temporal eliminada; quedan solo `postgres` y `tehus_crm_staging` |
| Verificaciones finales | `health-check.sh` 12/12 OK, release a95da7e sin cambios, 6 contenedores healthy; repositorio nuevo con 1 snapshot; histórico vía legacy sin cambios (1 snapshot 2026-08-20, mismos objetos); `.env.backup`, `rclone.conf` y `restic-password` en `600 deploy:deploy` |
| Timers | `tehus-backup.timer` y `tehus-backup-drill.timer` siguen `disabled`/`inactive`; próximas ejecuciones teóricas según `OnCalendar`: 2026-09-03 03:00 y 2026-10-01 04:30 (Bogotá). No se habilitaron |

Control 8 (snapshot cifrado off-site) y control 9 (drill Restic) pasaron en
ese momento a PASS condicionado a activar los timers con autorización separada
y a observar el primer ciclo automático. Ambas condiciones se cumplieron:
timers habilitados a las 19:21Z (actualización siguiente) y primer ciclo
automático exitoso el 2026-09-03 (ver más abajo). Hoy son PASS definitivo.

## Actualización 2026-09-02 19:21Z — timers off-site habilitados

| Paso | Resultado |
|------|-----------|
| Cron redundante | El crontab de `deploy` tenía una sola entrada: `0 3 * * *` → `backup-postgres.sh` con redirección a `backup.log`. `tehus-backup.service` ya ejecuta ese mismo script (vía `backup-offsite.sh`), así que la entrada era redundante y a la misma hora que el timer, con riesgo de que el off-site viera dos dumps nuevos y abortara |
| Copia del crontab | `/opt/tehus-crm/.secrets/crontab.bak-<timestamp>`, `600 deploy:deploy`, hash registrado en evidencia privada, ignorada por Git |
| Retiro | Archivo temporal, diff exactamente `1 eliminada / 0 añadidas`, reinstalado y releído: 0 entradas a las 03:00 |
| `systemctl enable --now` ambos timers | Symlinks creados; ningún servicio arrancó de inmediato (sin stamp previo, `Persistent=true` no tenía referencia) |
| Estado | `tehus-backup.timer` y `tehus-backup-drill.timer`: `enabled`, `active (waiting)`; archivos stamp creados por systemd |
| Próximas ejecuciones | Backup: 2026-09-03 03:00 Colombia (08:00 UTC), diario. Drill: 2026-10-01 04:41 Colombia (09:41 UTC), ventana 04:30–04:45 (09:30–09:45 UTC), mensual |
| Comprobaciones | sin unidades `failed`, sin procesos ni locks bloqueados, `RESTIC_REPOSITORY` en la ruta v2, snapshot nuevo accesible, histórico intacto vía remote legacy (1 snapshot), `health-check.sh` 12/12 OK, release a95da7e y contenedores sin cambios, repo del VPS limpio |

Con esto B-01 pasó a **PASS** y la parte operativa de la Fase 0 quedó en
**PASS**. La alineación de `deploy/env/backup.env.example` y
`docs/OFFSITE_BACKUPS.md` con la ruta v2 y el retiro del cron se hizo en este
mismo PR (#17), y el primer ciclo automático del 2026-09-03 se verificó en la
sección siguiente.

## Primer ciclo automático (2026-09-03, solo lectura)

Revisión estrictamente de lectura del primer disparo de `tehus-backup.timer`:
sin ejecutar backups, sin comandos de escritura de Restic o rclone, sin
reinicios ni cambios de configuración. Contexto: VPS `srv1829292`, usuario
`deploy`, `/opt/tehus-crm` en `main` a95da7e (worktree limpio),
`/api/health/version` con `release` a95da7e… y `builtAt`
2026-09-02T17:24:29Z, reloj sincronizado por NTP en `America/Bogota` (-05).
No había despliegues, migraciones, backups ni drills en curso. Producción no
fue tocada.

| Control | Evidencia sanitizada | Resultado |
|---------|----------------------|-----------|
| Timer habilitado | `tehus-backup.timer`: `loaded`, `active`, `waiting`, `enabled`, `Persistent=yes`, `OnCalendar=*-*-* 03:00:00 America/Bogota`, `AccuracySec=1m`, sin retardo aleatorio | PASS |
| Disparo automático 03:00 | `LastTriggerUSec` = 2026-09-03 03:00:18 -05; journal de systemd "Starting tehus-backup.service"; `TriggeredBy=tehus-backup.timer`; ningún arranque manual ese día | PASS |
| Servicio success | `Result=success`, `ExecMainCode=exited`, `ExecMainStatus=0`, inicio 03:00:18, fin 03:01:10 (hora de Colombia), duración 52 s, `NRestarts=0` | PASS |
| Próxima ejecución | 2026-09-04 03:00:00 -05 (calendario efectivo `America/Bogota`) | PASS |
| Repositorio V2 correcto | `RESTIC_REPOSITORY=rclone:takto-drive:TAKTO_BACKUPS_V2/staging`; `restic cat config --no-lock` abre el repositorio (formato v2); contraseña vía `RESTIC_PASSWORD_FILE`, nunca impresa | PASS |
| Snapshot automático nuevo | `c0c2d8e4…`, 2026-09-03 03:00:34 Colombia (08:00:34 UTC), host `tehus-crm-staging`, tag `takto-staging`, 4 rutas; objetos `snapshots/`, `index/` y `data/` creados 03:00:43–03:00:48 en `TAKTO_BACKUPS_V2/staging`. Total V2: 2 snapshots (`937a…` manual del 2026-09-02 y `c0c2d8e4…` automático) | PASS |
| Artefactos locales | Ciclo `20260903-030028`: dump 52 177 bytes, uploads 917 642 bytes (6 entradas), dos sidecars `.sha256`; todos `600 deploy:deploy`; dump con cabecera pg_dump 16.14 y marcador de fin | PASS |
| Checksums | `sha256sum -c` OK en dump y uploads; `gzip -t` OK; `tar -tzf` OK; `backup-verify.sh` OK | PASS |
| Restic check | Journal de la invocación: `forget --prune` conservó 2/2 snapshots; `restic check`: "check all packs", "2 / 2 snapshots", "no errors were found" | PASS |
| Histórico intacto | `rclone:takto-drive-legacy:TAKTO_BACKUPS/staging`: 1 snapshot `57f35a26…` del 2026-08-20, 6 objetos todos con fecha 2026-08-20, ningún objeto posterior, sin locks | PASS |
| Salud de staging | `health-check.sh` 12/12 OK; `/api/health` ok; `/api/health/status` ok con `database`, `queue`, `worker`, `outbox`, `realtime` y `flowbot` en `up`; 6 contenedores en ejecución (5 `healthy`, caddy sin healthcheck definido); backend, worker y frontend con el mismo `StartedAt` del deploy de PR #16; release a95da7e sin cambios | PASS |
| Sin residuos | Sin procesos restic, rclone ni pg_dump; `restic list locks` vacío en V2 e histórico; sin `*.partial` ni temporales; solo las bases `postgres` y `tehus_crm_staging`; 0 unidades `failed` | PASS |
| Cron redundante ausente | `crontab -l` de `deploy` vacío; sin referencias a `backup-postgres` en `/etc/cron*` | PASS |
| PR #17 y CI | Abierto sobre `docs/phase-0-closure`, HEAD `8523bf3`, `MERGEABLE`/`CLEAN`; workflows `CI` (backend y frontend) y `Backup safety` en verde | PASS |

Resultado: 14/14 controles en PASS. Los controles 8 y 9 pasan a PASS
definitivo y B-01 queda cerrado de forma definitiva.

### Observaciones no bloqueantes

- Docker Compose avisa de que `NEXT_PUBLIC_API_URL` no está definida en el
  entorno del host cuando lo invocan el script de backup y `health-check.sh`.
  No afecta a los contenedores ni al respaldo.
- La política de retención (7 diarias, 4 semanales, 6 mensuales) todavía no ha
  eliminado ningún snapshot porque solo existen dos; su efecto se observará de
  forma natural después de los primeros siete ciclos diarios.
- Los archivos vacíos `.tehus-offsite-backup.lock` y
  `.tehus-restore-drill.lock` en `backups/` son los descriptores de `flock`
  del diseño de los scripts; sin ningún proceso sosteniéndolos no representan
  locks activos.
- `backup-offsite.sh` descargó la imagen `alpine:latest` durante el ciclo
  porque no estaba en la caché local. Es una dependencia de red no bloqueante
  que conviene fijar en una fase posterior.

## Resultado por control

| # | Control | Resultado |
|---|---------|-----------|
| 1 | Commit desplegado y salud actual confirmados | PASS |
| 2 | Inventario agregado de todas las empresas | PASS |
| 3 | Settings y slug actuales de Tehus identificados | PASS (detalle en evidencia privada) |
| 4 | Dependencias globales de muebles identificadas | PASS |
| 5 | Backup nuevo de base de datos | PASS |
| 6 | Backup nuevo de uploads | PASS (hallazgo B-02 corregido y desplegado, PR #16) |
| 7 | Checksums correctos | PASS |
| 8 | Snapshot cifrado off-site confirmado | PASS (repositorio v2, snapshot cifrado verificado, timers habilitados, primer ciclo automático 2026-09-03 exitoso) |
| 9 | Restore drill aislado exitoso | PASS (ruta local y drill Restic oficial completado) |
| 10 | Conteos de origen y restauración coincidentes | PASS |
| 11 | Base temporal eliminada | PASS |
| 12 | Staging continúa saludable | PASS |
| 13 | Evidencia pública sanitizada | PASS |
| 14 | Evidencia privada fuera de Git | PASS |
| 15 | Ningún secreto expuesto | PASS |
| 16 | Producción no tocada | PASS |

**FASE 0 CERRADA — PASS.** Fecha de cierre: 2026-09-03. Los 16 controles
tienen evidencia en PASS y el primer ciclo automático del 2026-09-03 03:00 hora
de Colombia (08:00 UTC) se verificó con éxito (sección anterior).
`deploy/env/backup.env.example` y `docs/OFFSITE_BACKUPS.md` reflejan la ruta
V2, el ámbito `drive.file` y el retiro del cron.

## Bloqueadores

| ID | Estado | Acción pendiente |
|----|--------|------------------|
| B-01 | PASS definitivo: remote reautorizado, repositorio v2, primer backup cifrado y drill oficial exitosos, timers habilitados y cron redundante retirado el 2026-09-02; primer ciclo automático exitoso el 2026-09-03 (snapshot `c0c2d8e4…`) | — |
| B-02 | PASS definitivo (PR #16, desplegado en a95da7e): el contenedor entrega el tarball al usuario invocante (`chown` + `chmod 600`) y el script falla cerrado si el propietario no coincide | — |
| B-03 | PASS definitivo (PR #16): `restore-postgres.sh`, `backup-postgres.sh` y `backup-verify.sh` en Git como `100755`; prueba de regresión sobre todo script alcanzado desde un `ExecStart` | — |
