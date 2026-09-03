# Fase 1 — Rollback

Cada bloque de la fase se puede deshacer sin tocar datos. Ningún cambio de
esta fase incluye migraciones Prisma ni escribe sobre empresas existentes.

## Código (staging)

- **Antes de desplegar:** no hay nada que revertir; el PR se cierra o se
  revierte en `main` con `git revert` (nunca `reset --hard` ni force push).
- **Después de desplegar:** `./deploy/scripts/rollback-code.sh <SHA_ANTERIOR>`
  (el `deploy.sh` imprime «Previous (rollback) commit»). Reconstruye las
  imágenes del commit anterior en un worktree aislado y verifica la release;
  no toca la base de datos. Como no hay migración, no hace falta restaurar
  ningún backup.

## Variables de entorno (`.env.staging`)

Antes de editar: `cp -p .env.staging .secrets/.env.staging.bak-<timestamp>`
(modo `600`). Volver atrás = copiar la copia sobre el archivo vivo y
`docker compose --env-file .env.staging -f docker-compose.staging.yml up -d`
(recrea backend, worker y frontend; el frontend se reconstruye con la URL
antigua de la API mediante `deploy.sh` o `compose build frontend`).

## Caddy / dominios

- El Caddyfile vive en Git y se monta en el contenedor: volver al commit
  anterior y recrear `caddy` (`compose up -d caddy`) restaura el archivo
  antiguo. Los certificados ya emitidos quedan en el volumen `caddy_data` y
  no estorban.
- La redirección del frontend antiguo es **302** (temporal): al retirarla, los
  navegadores no la recuerdan.
- DNS: eliminar los registros A `crm-staging` y `api.crm-staging` de
  `takto.online`. Ningún otro registro cambia en esta fase.

## Cookies y canal entre pestañas

Los nombres nuevos y los antiguos conviven: si se vuelve al código anterior,
las cookies `takto_*` no se leen pero las `tehus_*` que aún existan siguen
funcionando; quien ya rotó a `takto_*` inicia sesión de nuevo. No hay estado
del lado del servidor ligado al nombre de la cookie (la sesión se identifica
por el token rotado, no por el nombre).

## Códigos de invitación

Los códigos `TAKTO-…` emitidos con el código nuevo se validan por hash; el
código anterior también los validaría por hash (el prefijo forma parte del
código normalizado), así que siguen siendo utilizables tras un rollback. Los
`TEHUS-…` nunca dejaron de serlo.

## Settings v2

Una empresa creada con settings v2 sigue funcionando con el código anterior:
ese código no leía `settings` en ningún consumidor (solo lo escribía en el
onboarding), y `Company.settings` es `Json`. Las empresas v1 no se han tocado.
Si alguna empresa editó categorías (v1 → v2) y se vuelve al código anterior,
el catálogo vuelve a mostrar la lista fija de aquel código; no se pierde
ningún dato.

## Pipelines y etapas

Las etapas creadas por el onboarding nuevo llevan `type` e `isInitial`,
columnas que ya existían. Un rollback de código no las altera.

## Documentación

`git revert` del commit de documentación correspondiente.
