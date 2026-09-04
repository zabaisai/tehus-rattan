# Fase 4.5 — Estado actual (para reanudar)

- Rama: `feat/phase-4-5-auth-experience` (worktree `../Tehus_Rattan-phase-4-5`),
  base `origin/main` `32d3515` (Fase 4 fusionada y verificada).
- Línea base antes de tocar código (2026-09-05): backend 153 suites / 2473
  unitarias; frontend 113 ficheros / 1183. Todo en verde.
- Hecho: inspección (Git, staging en lectura, login, sesiones, correo);
  `GAP-ANALYSIS`; migración aditiva `20260905090000_verificacion_de_dispositivo`
  (dos tablas nuevas, aplicada en local); backend completo (registro de
  parámetros, código con `crypto`, digest HMAC con secreto propio, retos con
  intentos y consumo atómicos, dispositivos confiables con cookie `__Host-`,
  interruptor y allowlist de servidor, correo propio, auditoría, revocación
  conectada a los caminos que ya cierran sesiones); pruebas unitarias del
  backend; documentos `AUTH-FLOW`, `THREAT-MODEL`, `EMAIL-DELIVERY`, `ROLLBACK`.
- En curso: frontend (pantalla de acceso nueva, verificación, apertura del
  tablero) y pruebas de extremo a extremo del backend.
- Falta: regresión completa, QA local con correo de pruebas, `README` y
  `TEST-MATRIX`, commits, PR, CI, merge, despliegue en staging, activación
  controlada, QA en staging, limpieza y cierre documental.
- **Dependencia humana pendiente**: una dirección de correo controlada y
  autorizada para recibir el código durante el QA de staging. Sin ella, la fase
  se cierra como PARCIAL con el interruptor apagado.
- Proveedor de correo en staging: verificado (TLS y autenticación aceptada), sin
  enviar ningún mensaje.
- Bloqueadores: ninguno hasta el QA de staging.
- Sin secretos en este documento.
