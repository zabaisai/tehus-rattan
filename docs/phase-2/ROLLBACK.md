# Fase 2 — Rollback

## Código (staging)

- **Antes de desplegar:** cerrar o revertir el PR en `main` con `git revert`
  (nunca `reset --hard` ni force push).
- **Después de desplegar:** `./deploy/scripts/rollback-code.sh <SHA_ANTERIOR>`
  (el `deploy.sh` imprime «Previous (rollback) commit»; el anterior a esta fase
  es el runtime `5cb991f`). Reconstruye las imágenes del commit anterior en un
  worktree aislado y verifica la release. **No toca la base de datos.**

## Base de datos

La migración es aditiva (enum, columna nullable con default para inserciones
nuevas, índice). **No se revierte**: el código anterior funciona con la columna
presente (no la lee ni la escribe; sus inserciones reciben `PRODUCT`). Borrar
el enum o la columna como «rollback de emergencia» está prohibido: destruiría
el tipo de los elementos creados con la Fase 2.

Si hiciera falta volver al estado exacto anterior (no previsto), el
`deploy.sh` deja un respaldo pre-migración verificado (dump con checksum) y
`restore-postgres.sh` lo restaura; eso implica perder los datos creados
después, así que solo con decisión explícita del propietario.

## Configuración escrita con la Fase 2

- **Región** (`timezone`, `currency`, `locale`, `country`): son columnas que
  ya existían con default. El código anterior las lee igual (bots, SLA,
  cotizaciones); nada que revertir.
- **`Company.settings`**: la Fase 2 escribe la misma forma v2 de la Fase 1
  (con `vertical`, `pipelineDefaults` y claves desconocidas conservadas). El
  código anterior la lee sin cambios.
- **Auditoría**: filas `company.configuration.update` en `audit_logs`; el
  código anterior las ignora. No se borran.
- **`itemType` en productos nuevos**: el código anterior lo ignora y sigue
  mostrando el producto.

## Frontend

Un rollback de código vuelve a la pantalla anterior: sin sección de
configuración, sin selector Producto/Servicio ni filtro. No hay estado en el
navegador que limpiar (la caché de react-query es por sesión).

## Documentación

`git revert` del commit documental correspondiente.
