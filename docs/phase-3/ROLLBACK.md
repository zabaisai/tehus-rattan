# Fase 3 — Rollback

**Sin migración Prisma.** Todo lo que la fase escribe ya existía como columna,
tabla o JSON (`Company.country/timezone/currency/locale`, `settings` v2,
`invitation_codes`, `pipelines`, `pipeline_stages`, `users`, `audit_logs`).

## Código (staging)

- Antes de desplegar: cerrar o revertir el PR en `main` con `git revert`.
- Después: `./deploy/scripts/rollback-code.sh <SHA_ANTERIOR>` (el `deploy.sh`
  imprime «Previous (rollback) commit»; el anterior a esta fase es `547f31f`,
  release de Fase 2). No toca la base.

## Datos creados con la Fase 3

- Empresas del onboarding v3: `settings.vertical.templateVersion = 3`. El
  código anterior las lee igual (`parseCompanySettings` acepta cualquier
  versión) y `findBusinessType` devuelve `undefined` para `vet_petshop` o
  `software` → el resumen/config muestra el tipo como texto; ninguna ruta lanza.
- Región: columnas ya existentes; el código anterior las respeta.
- Auditoría: `metadata.onboarding` adicional; el código anterior la ignora.
- Endpoint `POST /onboarding/invitation/check`: desaparece con el rollback; el
  asistente anterior no lo usa.

## Frontend

Un rollback devuelve el asistente de Fase 1 (sin región ni recomendación
explicada). No hay estado en el navegador que limpiar.

## Documentación

`git revert` del commit documental correspondiente.
