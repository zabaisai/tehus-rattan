# Respaldos cifrados fuera del VPS

Este procedimiento implementa el control técnico necesario para cerrar el
hallazgo **H-01**: la pérdida del disco o del VPS deja de eliminar
simultáneamente la base de datos y todas sus copias, y un tercero con acceso al
almacenamiento externo no obtiene volcados en claro. H-01 solo se considera
cerrado después de cumplir los criterios auditables del final de este runbook.

## Diseño

La protección tiene dos niveles:

1. `backup-postgres.sh` conserva la copia local atómica y verificada para una
   restauración rápida.
2. `backup-offsite.sh` exige el par completo (PostgreSQL y `backend_uploads`),
   verifica SHA-256/gzip/tar y lo sube con **cifrado del lado del cliente** a un
   repositorio Restic externo.

La copia local de recuperación rápida conserva el formato existente
`.sql.gz`/`.tar.gz` con permisos restrictivos; el cifrado criptográfico de este
control se aplica al nivel **off-site**. Si una auditoría exige que las copias
locales sean también criptográficamente ilegibles ante lectura forense del
disco del VPS, ese endurecimiento debe implementarse y validarse por separado.

Restic cifra contenido y metadatos antes de transmitirlos. El proveedor nunca
recibe la clave de cifrado. La contraseña de Restic es irrecuperable: debe
guardarse en el gestor de contraseñas corporativo y en una copia offline bajo
custodia distinta al VPS.

La política remota es **7 copias diarias, 4 semanales y 6 mensuales**. La copia
diaria la ejecuta `tehus-backup.timer` a las 03:00 de Bogotá (08:00 UTC). El
primer día de cada mes, entre las 04:30 y las 04:45 de Bogotá (09:30–09:45
UTC), `tehus-backup-drill.timer` lee todo el repositorio, restaura el último
dump en `tehus_restore_drill`, verifica el esquema, extrae los uploads en un
directorio temporal y elimina la base aislada.

El respaldo local diario ya no se programa por cron: `tehus-backup.service`
ejecuta `backup-postgres.sh` como primer paso, así que una entrada de cron a la
misma hora sería redundante y podría hacer abortar al off-site (que exige
exactamente un dump nuevo por ciclo). La entrada de cron antigua se retiró en
staging el 2026-09-02, con copia del crontab en `.secrets` para rollback.

## Estado en staging (2026-09-03)

| Elemento | Valor |
|----------|-------|
| Remote rclone | `takto-drive`, cliente OAuth propio, ámbito **`drive.file`** (mínimo privilegio) |
| Repositorio activo | `rclone:takto-drive:TAKTO_BACKUPS_V2/staging` |
| Repositorio histórico | `TAKTO_BACKUPS/staging`, creado con el cliente OAuth por defecto de rclone; se conserva **solo lectura**, no se reutiliza ni se borra |
| Primer backup manual (`tehus-backup.service`) | exitoso: DB + uploads + sidecars, `restic check` sin errores |
| Restauración aislada (`tehus-backup-drill.service`) | exitosa: `check --read-data`, restauración en `tehus_restore_drill`, base eliminada al final |
| Timers | `tehus-backup.timer` y `tehus-backup-drill.timer` habilitados y activos |
| Primer ciclo automático (`tehus-backup.timer`, 2026-09-03 03:00 Bogotá) | exitoso: `Result=success`, `ExecMainStatus=0`, 52 s, snapshot cifrado `c0c2d8e4…`, checksums y `restic check` sin errores; 2 snapshots en el repositorio activo, histórico intacto con 1 snapshot |

Con `drive.file` cada cliente OAuth solo ve las carpetas que él mismo creó.
Por eso el repositorio histórico no es visible desde el cliente propio y se
inicializó un repositorio nuevo en una carpeta propia. **No se debe ampliar el
permiso al ámbito completo `auth/drive`** para "ver" el histórico: ese ámbito
concede acceso a todos los archivos de la cuenta y contradice el principio de
mínimo privilegio. Cada entorno usa una ruta exclusiva; producción usará además
remote, contraseña Restic y latidos distintos.

Una URL de latido externa recibe `/start`, éxito o `/fail`. El monitor diario
se configura con periodo de 24 horas y gracia de 2 horas; así alerta si no hay
un respaldo confirmado en **26 horas**, incluso si el VPS entero desaparece.

## Almacenamiento externo

La implementación admite dos familias de backend:

- **Google Drive mediante rclone**, que es la opción elegida para staging.
- **S3 compatible** (por ejemplo Cloudflare R2) como alternativa.

En ambos casos Restic mantiene el cifrado del lado del cliente, por lo que el
almacenamiento remoto recibe únicamente datos cifrados por Restic.

### Google Drive via rclone

Para staging se usa un remote de rclone llamado `takto-drive` y la ruta
`TAKTO_BACKUPS_V2/staging`. El remote usa un cliente OAuth propio (tipo
"aplicación de escritorio") con el ámbito `drive.file`.

Requisitos operativos:

1. Usar una cuenta de Google controlada por la organización y protegida con MFA.
2. No compartir públicamente `TAKTO_BACKUPS_V2` (ni la carpeta histórica
   `TAKTO_BACKUPS`) ni su contenido.
3. Guardar el OAuth/config de rclone solamente en
   `/opt/tehus-crm/.secrets/rclone.conf`.
4. Mantener `rclone.conf` con propietario `deploy:deploy` y permisos `600`.
5. Guardar fuera del VPS la contraseña de Restic. El token OAuth de rclone no
   sustituye esa contraseña de cifrado.
6. Ámbito OAuth `drive.file` únicamente. Está prohibido configurar el remote
   con el ámbito completo `drive`.
7. Antes de reautorizar o editar el remote, copiar `rclone.conf` con timestamp
   dentro de `.secrets` (modo `600`) para poder volver atrás.
8. Nunca ejecutar `rclone config show`, imprimir `rclone.conf` ni pegar
   `client_id`, `client_secret` o tokens en chats, tickets o logs. Para
   diagnosticar, comparar hashes o comprobar solo la presencia de claves.

Cuando exista producción debe usar un destino lógico separado y secretos
distintos; no se debe reutilizar el mismo repositorio Restic de staging.

### Alternativa S3 compatible

S3 continúa soportado. En ese caso usar un bucket privado exclusivo,
credenciales de mínimo privilegio limitadas al destino de backups y reglas del
proveedor que no contradigan la retención administrada por Restic.

## Preparación en staging

Todos estos pasos son deliberadamente manuales. Fusionar el código no activa
el respaldo ni toca datos.

```bash
sudo apt-get update
sudo apt-get install -y restic rclone

cd /opt/tehus-crm
sudo install -d -m 0700 -o deploy -g deploy /opt/tehus-crm/.secrets
sudo -u deploy sh -c 'umask 077; openssl rand -base64 48 > /opt/tehus-crm/.secrets/restic-password'

sudo -u deploy rclone config --config /opt/tehus-crm/.secrets/rclone.conf
sudo chown deploy:deploy /opt/tehus-crm/.secrets/rclone.conf
sudo chmod 600 /opt/tehus-crm/.secrets/rclone.conf

sudo install -m 0600 -o deploy -g deploy \
  deploy/env/backup.env.example /opt/tehus-crm/.env.backup
sudoedit /opt/tehus-crm/.env.backup
```

Durante `rclone config`, crear o autorizar el remote con el nombre exacto
`takto-drive`. Si el VPS no puede abrir un navegador, seguir el flujo de
autorización que rclone muestre y completar el OAuth desde una estación de
trabajo confiable.

Para Google Drive, confirmar en `.env.backup` únicamente:

- `RESTIC_REPOSITORY=rclone:takto-drive:TAKTO_BACKUPS_V2/staging`
- `RCLONE_CONFIG=/opt/tehus-crm/.secrets/rclone.conf`
- `BACKUP_HEARTBEAT_URL`
- `BACKUP_DRILL_HEARTBEAT_URL`

`AWS_ACCESS_KEY_ID` y `AWS_SECRET_ACCESS_KEY` solo son necesarios si se elige
un backend `s3:`.

No pegar secretos, tokens OAuth, contraseñas ni el contenido de `rclone.conf`
en GitHub, tickets, chats, capturas o logs.

Confirmar permisos sin imprimir secretos:

```bash
sudo stat -c '%a %U %G %n' \
  /opt/tehus-crm/.env.backup \
  /opt/tehus-crm/.secrets/restic-password \
  /opt/tehus-crm/.secrets/rclone.conf
```

El resultado esperado es `600 deploy deploy` para los tres archivos.

Los secretos viven dentro del árbol de trabajo del VPS y están excluidos por
Git:

```bash
git check-ignore -v \
  .env.backup \
  .secrets/restic-password \
  .secrets/rclone.conf

git status --short
```

Ninguno de esos archivos debe aparecer como rastreable o pendiente de commit.

Comprobar el remote sin mostrar contenido sensible:

```bash
sudo -u deploy rclone lsd \
  --config /opt/tehus-crm/.secrets/rclone.conf \
  takto-drive:
```

## Inicialización y primera prueba

Instalar las unidades versionadas. El instalador deliberadamente **no habilita
ni inicia** los temporizadores: un `Persistent=true` habilitado antes de la
primera prueba podría ejecutarse tras un reinicio o al activarse después de una
hora omitida.

```bash
cd /opt/tehus-crm
sudo REPO_ROOT=/opt/tehus-crm deploy/scripts/install-backup-systemd.sh
systemctl is-enabled tehus-backup.timer tehus-backup-drill.timer || true
systemctl is-active tehus-backup.timer tehus-backup-drill.timer || true
```

En una instalación nueva ambos deben permanecer `disabled` e `inactive` hasta
terminar las pruebas observadas.

Inicializar una sola vez y ejecutar el primer respaldo observado. La unidad de
inicialización es `oneshot` con `RemainAfterExit=yes`: si ya figura como
`active (exited)` por una inicialización anterior, `start` no hace nada y hay
que usar `restart` de esa misma unidad. El script comprueba primero con
`restic cat config` y solo inicializa si el repositorio no existe; nunca se
ejecuta `restic init` a mano ni dos veces sobre la misma ruta.

```bash
sudo systemctl start tehus-backup-init.service
sudo systemctl status tehus-backup-init.service --no-pager

sudo systemctl start tehus-backup.service
sudo systemctl status tehus-backup.service --no-pager
sudo journalctl -u tehus-backup.service --since today --no-pager
```

Verificar desde una máquina distinta o desde Google Drive que el destino remoto
contiene objetos del repositorio. También puede comprobarse con rclone:

```bash
sudo -u deploy rclone lsf \
  --config /opt/tehus-crm/.secrets/rclone.conf \
  takto-drive:TAKTO_BACKUPS_V2/staging
```

No basta con que el comando local de backup diga éxito. Luego ejecutar el
primer ejercicio de recuperación:

```bash
sudo systemctl start tehus-backup-drill.service
sudo systemctl status tehus-backup-drill.service --no-pager
sudo journalctl -u tehus-backup-drill.service --since today --no-pager
```

El cierre de H-01 requiere evidencia de los dos servicios exitosos, el latido
verde y la existencia de objetos fuera del VPS. No habilitar el esquema para
producción hasta completar una restauración de prueba.

Solo después de esas comprobaciones, retirar el cron de respaldo local de la
misma hora. El procedimiento exige una coincidencia literal exacta de la línea
completa esperada, elimina únicamente esa línea, conserva el resto del crontab
(incluidos comentarios) y se detiene o restaura la copia ante cualquier
diferencia inesperada. Nunca filtrar por un fragmento (`grep -v`): podría
borrar más entradas de las previstas.

```bash
set -euo pipefail
umask 077
ts="$(date -u +%Y%m%dT%H%M%SZ)"
copia="/opt/tehus-crm/.secrets/crontab.bak-$ts"
actual="$(mktemp)"; nuevo="$(mktemp)"
esperada='0 3 * * * cd /opt/tehus-crm && ./deploy/scripts/backup-postgres.sh >> /opt/tehus-crm/backups/backup.log 2>&1'

# 1) Exportar el crontab completo y guardar la copia (600, sin sobrescribir).
crontab -l > "$actual"
[ ! -e "$copia" ] || { echo "la copia $copia ya existe"; exit 1; }
cp "$actual" "$copia"; chmod 600 "$copia"
sha256sum "$actual" "$copia"          # ambos hashes deben coincidir

# 2) Exigir exactamente UNA coincidencia literal de la línea completa.
coincidencias="$(grep -cFx -- "$esperada" "$actual" || true)"
[ "$coincidencias" -eq 1 ] || { echo "se esperaba 1 coincidencia exacta, hay $coincidencias; nada cambiado"; exit 1; }

# 3) Eliminar solo esa línea exacta (grep -v -F -x) y comparar antes/después.
grep -vFx -- "$esperada" "$actual" > "$nuevo" || true
eliminadas="$(diff "$actual" "$nuevo" | grep -c '^<' || true)"
anadidas="$(diff "$actual" "$nuevo" | grep -c '^>' || true)"
[ "$eliminadas" -eq 1 ] && [ "$anadidas" -eq 0 ] || { echo "diff inesperado ($eliminadas eliminadas, $anadidas añadidas); nada cambiado"; exit 1; }

# 4) Instalar, releer y verificar; ante cualquier diferencia, restaurar la copia.
crontab "$nuevo"
if ! crontab -l | diff -q - "$nuevo" >/dev/null; then
  crontab "$copia"; echo "crontab restaurado desde $copia"; exit 1
fi
echo "cron retirado; rollback disponible: crontab $copia"
rm -f "$actual" "$nuevo"

sudo systemctl enable --now tehus-backup.timer tehus-backup-drill.timer
systemctl list-timers --all tehus-backup.timer tehus-backup-drill.timer
systemctl is-active tehus-backup.service tehus-backup-drill.service
```

`enable --now` arma los temporizadores, no los servicios. Aun así, con
`Persistent=true` conviene comprobar que ningún servicio arrancó de inmediato
y, si lo hizo, observarlo hasta el final sin interrumpirlo.

## Operación normal

```bash
systemctl list-timers --all tehus-backup.timer tehus-backup-drill.timer
sudo journalctl -u tehus-backup.service -n 100 --no-pager
sudo journalctl -u tehus-backup-drill.service -n 100 --no-pager

sudo -u deploy bash -lc '
  set -a
  . /opt/tehus-crm/.env.backup
  set +a
  restic snapshots --host tehus-crm-staging --tag takto-staging
'
```

Nunca registrar el entorno completo ni ejecutar `set -x` en estos comandos.

## Recuperación real desde el almacenamiento externo

Usar este procedimiento únicamente durante una recuperación autorizada. Primero
restaurar el snapshot cifrado a un directorio temporal sin tocar la base viva:

```bash
cd /opt/tehus-crm
sudo -u deploy bash -lc '
  set -a
  . /opt/tehus-crm/.env.backup
  set +a
  target="$(mktemp -d /tmp/takto-offsite-restore.XXXXXX)"
  printf "%s\n" "$target" > /tmp/takto-offsite-restore.path
  restic restore latest \
    --host tehus-crm-staging \
    --tag takto-staging \
    --target "$target"
'
```

Leer la ruta temporal y localizar el conjunto exacto DB + uploads del mismo
timestamp:

```bash
RECOVERY_ROOT="$(cat /tmp/takto-offsite-restore.path)"
RECOVERY_BACKUPS="$RECOVERY_ROOT/opt/tehus-crm/backups"
find "$RECOVERY_BACKUPS" -maxdepth 1 -type f -print | sort
```

Antes de tocar datos reales, verificar el `.sql.gz`, su sidecar y el tar de
uploads correspondiente. Después usar los scripts de restauración existentes
con `BACKUP_DIR` apuntando a ese directorio. El nombre del dump y el del tar
deben compartir exactamente el mismo timestamp:

```bash
BACKUP_DIR="$RECOVERY_BACKUPS" \
  ./deploy/scripts/backup-verify.sh tehus-crm-staging-YYYYMMDD-HHMMSS.sql.gz

BACKUP_DIR="$RECOVERY_BACKUPS" \
  ./deploy/scripts/restore-postgres.sh \
    tehus-crm-staging-YYYYMMDD-HHMMSS.sql.gz

BACKUP_DIR="$RECOVERY_BACKUPS" \
  ./deploy/scripts/restore-uploads.sh \
    tehus-crm-staging-uploads-YYYYMMDD-HHMMSS.tar.gz
```

No sustituir `YYYYMMDD-HHMMSS` por un valor adivinado: copiar el timestamp de
los archivos restaurados. Tras validar aplicación, datos y uploads, eliminar el
directorio temporal y `/tmp/takto-offsite-restore.path`.

## Rotación y recuperación de credenciales

- Para Google Drive/rclone, reautorizar o rotar el acceso de `takto-drive`,
  probar `restic snapshots` y conservar `rclone.conf` con modo `600`.
- Para S3, rotar la credencial sin cambiar la contraseña de Restic, probar
  `restic snapshots`, actualizar `.env.backup` y revocar la anterior.
- Si se sospecha exposición de la contraseña de Restic, crear un repositorio
  nuevo con contraseña nueva y copiar mediante una estación confiable. Cambiar
  únicamente la credencial del proveedor no vuelve a cifrar snapshots
  anteriores.
- La contraseña Restic no tiene recuperación. Verificar trimestralmente que dos
  custodios autorizados pueden localizarla sin revelarla.

## Desactivación y rollback

Detener programación sin borrar copias:

```bash
sudo systemctl disable --now tehus-backup.timer tehus-backup-drill.timer
```

Esto no elimina datos locales, snapshots de Restic, el destino externo ni
credenciales. La eliminación de respaldos es una acción destructiva separada y
requiere una autorización explícita.

Rollback de configuración: cada cambio de `.env.backup`, `rclone.conf` o del
crontab deja una copia con timestamp y modo `600` en `/opt/tehus-crm/.secrets/`
(`.env.backup.bak-*`, `rclone.conf.bak-*`, `crontab.bak-*`). Volver atrás es
copiar la versión anterior sobre el archivo vivo (o `crontab <copia>`),
conservando modo y propietario, y volver a comprobar `restic snapshots` y
`systemctl list-timers`. Al volver a un repositorio anterior no se pierde nada:
los snapshots del repositorio abandonado siguen existiendo en Drive.

## Criterios auditables de cierre

- [x] Almacenamiento externo independiente, privado y con acceso de mínimo privilegio (staging, `drive.file`, 2026-09-02).
- [ ] Contraseña Restic almacenada fuera del VPS y recuperable por dos custodios.
- [x] Primera copia DB + uploads verificada fuera del VPS (manual 2026-09-02; automática 2026-09-03).
- [ ] Retención 7/4/6 visible en `restic snapshots` tras ciclos suficientes.
- [x] Temporizadores `systemd` habilitados desde archivos versionados (2026-09-02; primer disparo automático 2026-09-03).
- [ ] Monitor diario con 24 h + 2 h de gracia y alertas probadas.
- [ ] Restauración mensual exitosa y documentada.
- [ ] Procedimiento repetido para producción con destino externo y secretos distintos.
