# Fase 4 — Rollback

## Sin migración

La Fase 4 no añade migraciones de Prisma. El modelo (`Company.settings`,
`Product.itemType`, `Pipeline`, `PipelineStage`) ya soportaba todo. Volver
atrás es volver el código; los datos no cambian de forma.

## Código (staging)

```bash
cd /opt/tehus-crm
./deploy/scripts/rollback-code.sh <sha-anterior>   # el «Previous (rollback) commit» que imprimió deploy.sh
./deploy/scripts/health-check.sh
BASE_URL=https://crm-staging.takto.online EXPECTED_RELEASE=<sha-anterior> ./deploy/scripts/smoke-test.sh
```

El release anterior a esta fase es `4d457df` (Fase 3, runtime de staging al
empezar). `deploy.sh` registra el rollback target en su salida.

## Configuración escrita durante la fase

- Un `PATCH /companies/me/configuration` sobre una empresa legacy (v0/v1)
  reescribe `Company.settings` en forma v2 con las cinco banderas declaradas
  (fusionadas sobre los valores efectivos). El código anterior (Fase 2/3) lee
  v2 sin problema: los módulos quedan como el ADMIN los dejó. No hay que
  deshacer nada; si se quisiera, es un cambio de configuración normal desde la
  misma pantalla.
- Un módulo desactivado no borra datos: al volver al código anterior (que no
  aplica el guard) todo vuelve a ser visible; al volver a este, lo que el ADMIN
  desactivó sigue desactivado.

## Datos de pipelines

Las invariantes nuevas solo rechazan escrituras; no modifican filas
existentes. Un embudo legacy incompleto sigue igual que antes.

## Frontend

Mismo paquete que el backend: `rollback-code.sh` recompila ambos. No hay
estado en el navegador que limpiar (la configuración se lee del servidor).
