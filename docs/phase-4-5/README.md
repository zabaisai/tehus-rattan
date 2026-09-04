# Fase 4.5 — Nuevo inicio de sesión y verificación de dispositivo

Convierte la puerta de entrada de TAKTO en dos cosas a la vez: una pantalla que
explica qué es el producto antes de pedir nada, y un acceso que ya no depende
solo de la contraseña. Cuando alguien entra desde un dispositivo que la cuenta
no reconoce, hace falta además un código de seis dígitos enviado por correo.
Hasta que ese código se consume no existe sesión.

TAKTO es la plataforma y dueña del CRM. El login es su puerta: lleva marca
TAKTO, nunca la de una empresa cliente.

Rama: `feat/phase-4-5-auth-experience` (desde `origin/main` `32d3515`),
fusionada en `main` `52289a8` (PR #28).
Worktree aislado; el worktree principal y su archivo ajeno
(`deploy/scripts/send-demo-template.mjs`) no se tocan.

## Documentos

| Documento | Contenido |
|---|---|
| [GAP-ANALYSIS.md](GAP-ANALYSIS.md) | Requisito → estado en `main` → brecha → acción → prueba |
| [AUTH-FLOW.md](AUTH-FLOW.md) | Recorrido, contrato de los endpoints, parámetros, cookies y revocación |
| [THREAT-MODEL.md](THREAT-MODEL.md) | Qué mitiga, qué ataca al propio mecanismo y qué queda fuera |
| [EMAIL-DELIVERY.md](EMAIL-DELIVERY.md) | Proveedor, condiciones de envío, contenido y comportamiento ante fallo |
| [TEST-MATRIX.md](TEST-MATRIX.md) | Qué prueba cubre cada requisito y resultados reales |
| [STAGING-EVIDENCE.md](STAGING-EVIDENCE.md) | Evidencia sanitizada de pruebas, CI, despliegue y QA |
| [ROLLBACK.md](ROLLBACK.md) | Cómo volver atrás: apagar el interruptor, sin revertir datos |
| [CURRENT-STATUS.md](CURRENT-STATUS.md) | Estado para reanudar el trabajo |

## Alcance

**Backend.** Modelos `DeviceVerificationChallenge` y `TrustedDevice` con
migración aditiva; código de seis dígitos generado con `crypto` y guardado solo
como HMAC-SHA256 con un secreto exclusivo; diez minutos de vigencia, cinco
intentos, un solo uso, reenvío cada sesenta segundos que invalida el anterior;
consumo e intentos con escrituras condicionales, de modo que dos peticiones
simultáneas no abren dos sesiones; dispositivos confiables de treinta días con
token opaco, cookie `__Host-` y solo su hash en base; revocación conectada a
todos los caminos que ya cerraban sesiones; interruptor y despliegue controlado
de servidor; correo propio con su plantilla; cinco acciones de auditoría sin
secretos.

**Frontend.** Pantalla de acceso partida: panel de TAKTO con contenido
ilustrativo y sintético a la izquierda, formulario a la derecha; máquina de
estados explícita en lugar de banderas sueltas; pantalla de verificación con
seis casillas que aceptan pegado, flechas y borrado, cuenta atrás, reenvío,
aviso de intentos y casilla de confianza desmarcada; apertura del tablero atada
a operaciones reales, sin porcentajes inventados ni esperas artificiales.

**No incluido**: llaves de seguridad (WebAuthn), verificación por SMS,
recordar la sesión entre navegadores, gestión visual de dispositivos en
Configuración, activación en producción y Fase 5.

## Decisiones que conviene conocer

1. **El servidor manda.** El navegador no decide si hace falta verificar:
   reacciona al `status` de la respuesta. No hay cabecera, parámetro ni código
   universal que salte el paso.
2. **Antes de autenticar no se consulta nada del inquilino.** El panel visual
   es estático y sintético, y lo dice en pantalla.
3. **Textos honestos.** Nada de «cifrado de extremo a extremo», «dispositivo
   autorizado» ni ciudad detectada. Solo lo que el producto hace de verdad.
4. **`Correo`, no «Correo corporativo»**: TAKTO admite cuentas de cualquier
   proveedor.
5. **Cerrar sesión no retira la confianza del dispositivo**; para eso existe una
   acción explícita. Está razonado en `AUTH-FLOW.md`.
6. **Sin dependencias nuevas.** Las animaciones son CSS y React sobre los
   tokens de duración que ya tenía el sistema visual.

## Plan y estado

| # | Etapa | Estado |
|---|---|---|
| 1 | Inspección y análisis de brechas | HECHA |
| 2 | Migración aditiva y núcleo de seguridad | HECHA |
| 3 | Endpoints, correo, auditoría y revocación | HECHA |
| 4 | Frontend (acceso, verificación, apertura) | HECHA |
| 5 | Pruebas unitarias y de extremo a extremo | HECHA |
| 6 | QA local con el producto levantado y correo real de pruebas | HECHA — 64 comprobaciones, 0 fallos |
| 7 | PR, CI y merge | HECHA — PR #28 → `main` `52289a8` (merge commit) |
| 8 | Backup y despliegue en staging | HECHA — release `52289a8`, backup con checksums, migración aplicada, health y smoke 22/22 |
| 9 | Activación controlada y QA en staging | HECHA — 28 comprobaciones por API y 25 por navegador, con correo real |
| 10 | Documentación y cierre | HECHA — rama `docs/phase-4-5-closure` |

Estado de la fase: **FASE 4.5 CERRADA — PASS** (2026-09-04). Fase 5 no iniciada.

## Migración

Una, aditiva: `20260905090000_verificacion_de_dispositivo` crea dos tablas y
sus índices. No altera, renombra ni borra nada existente. Volver atrás no exige
revertirla.

## Fuera de alcance

Producción (DNS, certificados, despliegue), Meta y WhatsApp, correos a personas
reales, cambio de contraseñas de cuentas existentes, renombres de
infraestructura heredada y Fase 5.
