# Fase 4.5 — Evidencia

Estado: **PENDIENTE** — el despliegue en staging, la activación controlada y el
QA con correo real aún no se han ejecutado. Esta página se completa únicamente
con resultados reales.

## Contexto

- Base: `origin/main` `32d3515` (2026-09-04, Fase 4 cerrada). Rama
  `feat/phase-4-5-auth-experience`.
- Runtime de staging al empezar: `38c1575` (Fase 4). Producción: no existe
  (`crm.takto.online` y `api.crm.takto.online` sin DNS; no se tocan).

## Proveedor de correo (solo lectura, 2026-09-04)

Desde el contenedor del backend, sin enviar ningún mensaje: conexión TLS al
proveedor correcta (saludo `220 ESMTP`) y `transporter.verify()` **OK**, es
decir, el proveedor acepta las credenciales configuradas. `PASSWORD_RESET_ENABLED`
sigue en `false` y esta fase no lo cambia.

## Pruebas (local)

Ver `TEST-MATRIX.md`.

## Seguridad del diff

Pendiente.

## CI y PR

Pendiente.

## Despliegue en staging

Pendiente.

## Activación controlada

Pendiente.

## QA en staging (datos `QA_PHASE45_`, a eliminar)

Pendiente.

## Limpieza y comparación antes/después

Pendiente.

## Cierre

Pendiente.
