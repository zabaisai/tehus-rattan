# Fase 0 — Runbook de staging (solo lectura + respaldo + restore aislado)

Procedimiento reproducible usado el 2026-09-02. Todo se ejecuta como el
usuario `deploy` en el VPS de staging, dentro de `/opt/tehus-crm`, sin sudo
salvo lectura del journal. Ningún paso modifica datos de la base viva.

## 0. Precondiciones (detenerse si alguna falla)

```bash
hostname; whoami                       # host de staging, usuario deploy
cd /opt/tehus-crm && git rev-parse --show-toplevel
git remote -v | sed -E 's#(https?://)[^@]*@#\1***@#'
git branch --show-current               # main
git rev-parse HEAD                      # debe coincidir con origin/main
git status --porcelain | wc -l          # 0
docker compose -f docker-compose.staging.yml ps
for p in health health/ready health/status health/queue health/version; do
  docker compose -f docker-compose.staging.yml exec -T backend \
    wget -qO- "http://127.0.0.1:3001/api/$p"; echo
done
./deploy/scripts/health-check.sh
```

`release` de `/api/health/version` debe ser igual al HEAD del VPS.

## 1. Inventario de solo lectura

```bash
u="$(grep -m1 '^POSTGRES_USER=' .env.staging | cut -d= -f2-)"   # nunca echo
docker compose -f docker-compose.staging.yml exec -T postgres \
  psql -U "$u" -d tehus_crm_staging \
  -v target_company_id='<Company.id bajo revisión>' \
  -f - < docs/phase-0/staging-inventory.sql > /ruta/privada/inventario.txt
```

El archivo abre con `BEGIN TRANSACTION READ ONLY` y cierra con `ROLLBACK`.
Las secciones 0–8 son publicables; la sección 9 se queda en evidencia
privada. No pasar el `Company.id` por ningún archivo rastreado.

## 2. Pruebas locales de seguridad (en la estación de trabajo)

```bash
for s in deploy/scripts/*.sh deploy/tests/*.sh; do bash -n "$s"; done
bash deploy/tests/backup-safety.test.sh
```

## 3. Respaldo nuevo (mecanismo oficial local)

```bash
RETENTION_DAYS=3650 ./deploy/scripts/backup-postgres.sh
```

`RETENTION_DAYS` alto evita que la sesión borre respaldos previos. Verificar:

```bash
db=$(ls -t backups/tehus-crm-staging-*.sql.gz | head -1)
stamp=$(basename "$db"); stamp=${stamp#tehus-crm-staging-}; stamp=${stamp%.sql.gz}
up="backups/tehus-crm-staging-uploads-$stamp.tar.gz"
stat -c '%a %U %G %s %y %n' "$db" "$db.sha256" "$up" "$up.sha256"
./deploy/scripts/backup-verify.sh "$(basename "$db")"
(cd backups && sha256sum -c "$(basename "$up").sha256")
tar -tzf "$up" | wc -l
gunzip -c "$db" | grep -cE '^CREATE TABLE'    # 58 al commit d421021
```

Dump y tarball deben compartir `stamp`. Esperado desde PR #16: los cuatro
artefactos `600 deploy:deploy` (antes el tarball quedaba `644 root:root`,
hallazgo B-02, ya corregido).

## 4. Off-site cifrado (lectura, sin imprimir configuración)

Desde el 2026-09-02 el repositorio activo es `rclone:takto-drive:TAKTO_BACKUPS_V2/staging`
(remote con ámbito `drive.file`); el anterior `TAKTO_BACKUPS/staging` es
histórico y solo se lee vía el remote `takto-drive-legacy`. Los ciclos los
programan `tehus-backup.timer` (03:00 Colombia) y `tehus-backup-drill.timer`
(día 1, 04:30–04:45); el cron local de las 03:00 fue retirado.

```bash
bash -c 'set -a; . /opt/tehus-crm/.env.backup; set +a;
  restic snapshots --host "$RESTIC_HOST" --tag "$BACKUP_RESTIC_TAG" --compact'
sudo -n journalctl -u tehus-backup.service -u tehus-backup-drill.service --no-pager -o short-iso
systemctl list-timers --all tehus-backup.timer tehus-backup-drill.timer
```

Si `restic` no abre el repositorio (p. ej. `unauthorized_client` de rclone),
el control off-site está en FAIL y el drill oficial no puede ejecutarse.
No intentar `backup-offsite.sh` a mano: enviaría un latido de fallo al monitor.
Para un ciclo manual usar las unidades `tehus-backup.service` y
`tehus-backup-drill.service` (ver `docs/OFFSITE_BACKUPS.md`).

## 5. Restore drill aislado (ruta local)

Solo con estas condiciones demostradas:

```bash
live="$(grep -m1 '^POSTGRES_DB=' .env.staging | cut -d= -f2-)"
T=tehus_restore_drill_phase0
[ "$T" != "$live" ]                                             # distinto de la base viva
printf '%s' "$T" | grep -qE '^tehus_restore_drill(_[A-Za-z0-9_]+)?$'  # patrón reservado
docker compose -f docker-compose.staging.yml exec -T postgres \
  psql -U "$u" -d postgres -tAc "SELECT count(*) FROM pg_database WHERE datname='$T'"   # 0
```

Restaurar (el script exige el sidecar `.sha256`, verifica checksum y gzip
antes de tocar nada, no detiene el backend en la ruta `--target-db` y no toca
uploads). Sin `--replace-target` se niega a sobreescribir:

```bash
printf '%s\n' "$T" | RESTORE_SKIP_APP_CHECKS=1 \
  bash ./deploy/scripts/restore-postgres.sh "$(basename "$db")" --target-db "$T"
```

Comparar conteos (origen en transacción de solo lectura):

```sql
SELECT table_name,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I', table_name), false, true, '')))[1]::text::bigint AS rows
FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1;
SELECT count(*) FROM information_schema.table_constraints WHERE constraint_schema='public' AND constraint_type='FOREIGN KEY';
SELECT count(*) FROM pg_indexes WHERE schemaname='public';
```

Ejecutar sobre `tehus_crm_staging` (envuelto en `BEGIN TRANSACTION READ
ONLY; … ROLLBACK;`) y sobre `$T`; `diff` debe estar vacío.

## 6. Limpieza (solo la base temporal de esta prueba)

```bash
docker compose -f docker-compose.staging.yml exec -T postgres psql -U "$u" -d postgres -tAc \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$T' AND pid<>pg_backend_pid()"
docker compose -f docker-compose.staging.yml exec -T postgres dropdb -U "$u" "$T"
docker compose -f docker-compose.staging.yml exec -T postgres psql -U "$u" -d postgres -tAc \
  "SELECT datname FROM pg_database WHERE datname NOT IN ('template0','template1')"
./deploy/scripts/health-check.sh
git status --porcelain | wc -l     # 0: el repo del VPS no se tocó
```

## Condiciones de detención

- Host, usuario, ruta, rama o remoto distintos de los esperados.
- Worktree del VPS con cambios.
- Un servicio caído antes de empezar.
- La base destino no cumple el patrón reservado o ya existía.
- Checksum o gzip fallan.
- Para continuar habría que cambiar configuración, reautorizar credenciales
  o borrar datos reales.
