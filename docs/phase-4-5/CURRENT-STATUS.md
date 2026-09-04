# Fase 4.5 — Estado actual (para reanudar)

- Estado: **FASE 4.5 CERRADA — PASS** (2026-09-04).
- Implementación: PR #28 `feat/phase-4-5-auth-experience` → `main` `52289a8`
  (merge commit, con una migración aditiva). Cierre documental: rama
  `docs/phase-4-5-closure`.
- Staging: release `52289a8`, migración `20260905090000_verificacion_de_dispositivo`
  aplicada, health completo y smoke 22/22. QA con correo real recibido: 28
  comprobaciones por API y 25 por navegador, sin fallos; datos borrados por ID
  con 0 residuos y línea base igual salvo un evento de acceso del propio smoke.
- **Interruptor en staging: encendido y limitado por allowlist a una sola
  dirección de QA**, que ya no corresponde a ninguna cuenta. Ninguna cuenta real
  pide código. Para activación total: vaciar
  `AUTH_DEVICE_VERIFICATION_ALLOWLIST` y reiniciar el backend. Para desactivar:
  `AUTH_DEVICE_VERIFICATION_ENABLED=false` y reiniciar (ver `ROLLBACK.md`).
- Copia de seguridad del entorno antes de tocarlo:
  `.env.staging.bak-antes-fase45-<marca>` con permisos `600`.
- Producción: no existe ni se toca. Fase 5: no iniciada.
- Deuda registrada:
  - El dominio remitente no publica DKIM, así que Gmail desvía el código a
    spam. Requiere un cambio de DNS fuera del alcance de esta fase.
  - `PASSWORD_RESET_ENABLED` sigue en `false` en staging (anterior a la fase).
  - El interruptor se lee al arrancar: cambiarlo exige reiniciar el backend.
  - Sin cola ni reintento de correo: un fallo revoca el reto y pide reintentar.
- Bloqueadores: ninguno.
- Sin secretos en este documento.
