# Despliegue en VPS — Tehus Rattan CRM (Staging)

Este documento cubre el despliegue del stack en un VPS Ubuntu para el
entorno **STAGING**. Producción definitiva requiere pasos adicionales — ver
el checklist al final de este documento.

## Arquitectura

```
Internet
   │
   ├── crm-staging.tehusrattan.com      (443/80)
   └── api.crm-staging.tehusrattan.com  (443/80)
   │
   ▼
┌─────────────────────────────────────────────────────────┐
│ Caddy (reverse proxy, HTTPS automático)                  │
│  red: proxy                                              │
└──────────────┬───────────────────────────┬───────────────┘
               │                           │
        ┌──────▼──────┐            ┌───────▼───────┐
        │  frontend    │            │   backend     │
        │  Next.js     │            │   NestJS      │
        │  :3000       │            │   :3001       │
        │  red: proxy  │            │  redes: proxy,│
        └──────────────┘            │   internal    │
                                     └───────┬────────┘
                                             │
                                      ┌──────▼──────┐
                                      │  postgres    │
                                      │  red:internal│
                                      │  (sin acceso │
                                      │   público)   │
                                      └──────────────┘
```

- Ningún servicio publica 3000, 3001 o 5432 al host/Internet — solo Caddy
  publica 80/443.
- `postgres` vive en la red Docker `internal` (marcada `internal: true`, sin
  ruta de salida), inalcanzable desde `proxy` o desde el host.
- `backend` está en ambas redes: `internal` (para hablar con Postgres) y
  `proxy` (para que Caddy lo alcance y para peticiones salientes, p. ej. a la
  API de WhatsApp).

## Requisitos

- VPS Ubuntu (22.04/24.04) con al menos 2 vCPU, 4GB RAM, 40GB disco
  recomendado para staging.
- Acceso root inicial por SSH (contraseña o llave del proveedor).
- Dos registros DNS tipo A apuntando a la IP del VPS (ver más abajo).
- Docker Engine + Docker Compose plugin (`docker compose`, sin guion).

## Dominios

| Servicio | Dominio |
|---|---|
| Frontend | `https://crm-staging.tehusrattan.com` |
| Backend  | `https://api.crm-staging.tehusrattan.com/api` |

## Configuración DNS

Crear dos registros **A**:

```
crm-staging.tehusrattan.com       A    <IP_DEL_VPS>
api.crm-staging.tehusrattan.com   A    <IP_DEL_VPS>
```

Verificar propagación:

```bash
dig +short crm-staging.tehusrattan.com
dig +short api.crm-staging.tehusrattan.com
```

Ambos deben devolver la IP del VPS antes de que Caddy pueda emitir
certificados HTTPS válidos (usa el reto HTTP-01 de Let's Encrypt, que
requiere que el dominio resuelva a este servidor y que el puerto 80 sea
alcanzable).

## Instalación de Docker

Usar el repositorio oficial de Docker (no el script `curl | sh`):

```bash
sudo apt update
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

sudo usermod -aG docker deploy

docker version
docker compose version
docker run --rm hello-world
```

## Conexión SSH

Primera conexión (root, para configurar el servidor):

```bash
ssh -p 22 root@<IP_DEL_VPS>
```

Tras crear el usuario `deploy` y su llave (ver checklist de seguridad),
verificar en una **segunda sesión** (sin cerrar la primera) antes de
restringir SSH:

```bash
ssh -i "~/.ssh/tehus_vps_ed25519" deploy@<IP_DEL_VPS>
```

Solo después de confirmar el acceso con `deploy` se desactivan
`PermitRootLogin` y `PasswordAuthentication`.

## Primer despliegue

```bash
cd /opt/tehus-crm
docker compose -f docker-compose.staging.yml config      # valida el archivo
docker compose -f docker-compose.staging.yml up -d postgres
# esperar a que el healthcheck de postgres marque "healthy"
docker compose -f docker-compose.staging.yml run --rm backend npx prisma migrate deploy
docker compose -f docker-compose.staging.yml up -d
docker compose -f docker-compose.staging.yml ps
```

O, de forma equivalente y recomendada, usar el script que automatiza estos
mismos pasos con validaciones adicionales:

```bash
./deploy/scripts/deploy.sh
```

Verificar:

```bash
curl -I https://api.crm-staging.tehusrattan.com/api/health
curl -I https://crm-staging.tehusrattan.com/login
```

Ambos deben responder `200` con un certificado válido.

## Actualizaciones (desplegar una nueva versión)

`deploy.sh` siempre despliega desde `main` (nunca desde `develop`):

```bash
cd /opt/tehus-crm
./deploy/scripts/deploy.sh
```

Esto hace `git pull --ff-only origin main`, reconstruye las imágenes,
ejecuta `prisma migrate deploy` y reinicia los servicios sin tocar los
volúmenes de datos.

## Confirmar qué commit está desplegado

```bash
cd /opt/tehus-crm
git log -1 --oneline
```

o, sin depender del checkout local:

```bash
docker compose -f docker-compose.staging.yml exec backend cat /app/dist/../.git 2>/dev/null || true
# más simple y confiable: el propio git log de arriba, ya que el backend se
# construye siempre desde el working tree que acaba de hacer pull.
```

## Migraciones

- Producción/staging usan **únicamente** `npx prisma migrate deploy`.
- **Nunca** ejecutar en el VPS: `prisma migrate dev`, `prisma migrate reset`,
  `prisma db push`.
- El paso de migración corre como un contenedor `run --rm` independiente,
  antes de levantar el resto del stack (ver `deploy.sh` paso 7).

## Logs

```bash
docker compose -f docker-compose.staging.yml logs --tail 100 backend
docker compose -f docker-compose.staging.yml logs --tail 100 frontend
docker compose -f docker-compose.staging.yml logs --tail 100 caddy
docker compose -f docker-compose.staging.yml logs --tail 100 postgres
docker compose -f docker-compose.staging.yml logs -f backend    # seguir en vivo
```

Los logs de cada servicio están limitados (`max-size: 10m`, `max-file: 3`) para
no llenar el disco.

## Reiniciar servicios

```bash
docker compose -f docker-compose.staging.yml restart            # todos
docker compose -f docker-compose.staging.yml restart backend    # uno solo
```

Esto **no** borra volúmenes ni datos. No es necesario reiniciar el VPS
completo para esto.

## Rollback

Si un despliegue introduce un problema:

```bash
cd /opt/tehus-crm
git log --oneline -10          # identificar el commit bueno anterior
git checkout <commit-bueno>
docker compose -f docker-compose.staging.yml build
docker compose -f docker-compose.staging.yml up -d
git checkout main              # volver a main una vez estabilizado
```

Si el rollback requiere revertir una migración de base de datos, **no**
existe downgrade automático de Prisma — restaurar desde el backup más
reciente anterior al cambio (ver "Restauración") es el camino seguro.

## Backups

```bash
./deploy/scripts/backup-postgres.sh
```

- Genera `/opt/tehus-crm/backups/tehus-crm-staging-<fecha>-<hora>.sql.gz`.
- Permisos `600`, directorio `700`.
- Borra automáticamente backups locales de más de 7 días (retención de
  staging).
- Nunca imprime la contraseña de PostgreSQL.

Programar backup diario a las 3:00 a.m. hora Colombia (`America/Bogota`,
zona horaria ya configurada en el VPS) con `crontab -e` como usuario
`deploy`:

```
0 3 * * * cd /opt/tehus-crm && ./deploy/scripts/backup-postgres.sh >> /opt/tehus-crm/backups/backup.log 2>&1
```

## Restauración

```bash
./deploy/scripts/restore-postgres.sh <archivo-de-backup.sql.gz>
```

- Requiere el **nombre exacto** del archivo — nunca elige automáticamente
  "el más reciente".
- Pide confirmación explícita (escribir el nombre de la base de datos
  destino) antes de tocar cualquier dato.
- Restaurar sobre la base viva **detiene temporalmente el backend** durante
  la restauración y lo reinicia al finalizar.
- Nunca se ejecuta automáticamente durante `deploy.sh`.

Para **probar** un backup sin arriesgar la base de staging activa:

```bash
./deploy/scripts/restore-postgres.sh <archivo-de-backup.sql.gz> --target-db tehus_restore_test
# validar los datos con psql/consultas según se necesite
docker compose -f docker-compose.staging.yml exec postgres dropdb -U <POSTGRES_USER> tehus_restore_test
```

## Verificación de uploads

Los uploads (imágenes de productos, logos) se guardan en el volumen
`backend_uploads`, montado en `/app/uploads` dentro del contenedor backend.

```bash
docker compose -f docker-compose.staging.yml exec backend ls -la /app/uploads
docker volume inspect tehus-crm-staging_backend_uploads
```

Para confirmar persistencia tras un reinicio: subir un archivo de prueba,
`docker compose restart backend`, y verificar que el archivo sigue presente
y accesible por su URL pública.

## Renovación HTTPS automática

Caddy gestiona la emisión y renovación de certificados Let's Encrypt de
forma automática mientras:

- los dominios resuelvan a este VPS;
- los puertos 80/443 sigan abiertos y alcanzables;
- el volumen `caddy_data` (donde se guardan certificados) no se borre.

No se requiere cron ni intervención manual. Verificar el estado con:

```bash
docker compose -f docker-compose.staging.yml logs caddy | grep -i certificate
```

## Comandos de diagnóstico

```bash
docker compose -f docker-compose.staging.yml ps
docker compose -f docker-compose.staging.yml config
docker stats --no-stream
./deploy/scripts/health-check.sh
```

## Uso de disco

```bash
df -h
docker system df
du -sh /opt/tehus-crm/backups
```

Limpiar imágenes/capas Docker no usadas (nunca usar `-a` sin revisar antes):

```bash
docker image prune
```

## Checklist de seguridad

- [ ] Acceso SSH solo con llave (`deploy`), root y password deshabilitados.
- [ ] `sshd -t` validado antes de recargar SSH.
- [ ] UFW activo: solo OpenSSH, 80/tcp, 443/tcp, 443/udp permitidos.
- [ ] Fail2ban activo.
- [ ] `unattended-upgrades` configurado.
- [ ] PostgreSQL sin puerto publicado, solo red `internal`.
- [ ] pgAdmin **no** desplegado en el stack de staging/producción.
- [ ] `.env.staging` con permisos `600`, fuera de Git.
- [ ] Ningún secreto (JWT_SECRET, POSTGRES_PASSWORD, WHATSAPP_*, tokens)
      commiteado ni impreso en logs/reportes.
- [ ] HTTPS válido en ambos dominios.

## Checklist antes de producción

No declarar producción lista mientras falte:

- [ ] Validación visual completa del frontend en navegador real (este
      despliegue fue validado por API/HTTP, no visualmente pixel a pixel).
- [ ] Copia de backups **fuera** del mismo VPS (S3 u otro proveedor/host).
- [ ] Integración de WhatsApp definitiva (token real, verify token real).
- [ ] Corrección de los bugs comerciales pendientes conocidos (ver reportes
      de QA: eliminación de cotizaciones `SENT` sin restricción, etc.).
- [ ] Prueba con datos reales controlados (no solo cuentas de staging).
- [ ] Capacitación del equipo que administrará el CRM en producción.
- [ ] Definir dominio y credenciales definitivos de producción (distintos a
      los de staging).
