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
diaria se ejecuta a las 03:00 de Bogotá. El primer día de cada mes se lee todo
el repositorio, se restaura el último dump en `tehus_restore_drill`, se verifica
el esquema, se extraen los uploads en un directorio temporal y se elimina la
base aislada.

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
`TAKTO_BACKUPS/staging`.

Requisitos operativos:

1. Usar una cuenta de Google controlada por la organización y protegida con MFA.
2. No compartir públicamente `TAKTO_BACKUPS` ni su contenido.
3. Guardar el OAuth/config de rclone solamente en
   `/opt/tehus-crm/.secrets/rclone.conf`.
4. Mantener `rclone.conf` con propietario `deploy:deploy` y permisos `600`.
5. Guardar fuera del VPS la contraseña de Restic. El token OAuth de rclone no
   sustituye esa contraseña de cifrado.

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

- `RESTIC_REPOSITORY=rclone:takto-drive:TAKTO_BACKUPS/staging`
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

Inicializar una sola vez y ejecutar el primer respaldo observado:

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
  takto-drive:TAKTO_BACKUPS/staging
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

Solo después de esas comprobaciones, iniciar la programación y verificar la
próxima ejecución calculada:

```bash
sudo systemctl enable --now tehus-backup.timer tehus-backup-drill.timer
systemctl list-timers --all tehus-backup.timer tehus-backup-drill.timer
```

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

## Criterios auditables de cierre

- [ ] Almacenamiento externo independiente, privado y con acceso de mínimo privilegio.
- [ ] Contraseña Restic almacenada fuera del VPS y recuperable por dos custodios.
- [ ] Primera copia DB + uploads verificada fuera del VPS.
- [ ] Retención 7/4/6 visible en `restic snapshots` tras ciclos suficientes.
- [ ] Temporizadores `systemd` habilitados desde archivos versionados.
- [ ] Monitor diario con 24 h + 2 h de gracia y alertas probadas.
- [ ] Restauración mensual exitosa y documentada.
- [ ] Procedimiento repetido para producción con destino externo y secretos distintos.
