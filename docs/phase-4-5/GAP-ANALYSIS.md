# Fase 4.5 — Análisis de brechas

Base inspeccionada: `origin/main` `32d3515` (Fase 4 fusionada y verificada: PR #26
`38c1575` funcional, PR #27 `32d3515` documental). Worktree
`../Tehus_Rattan-phase-4-5`, rama `feat/phase-4-5-auth-experience`.

Estados: `HECHO`, `PARCIAL`, `FALTANTE`, `FUERA DE FASE`.

## 1. Qué existe hoy

**Backend.** `POST /api/auth/login` valida con bcrypt, comprueba usuario activo y
estado de la empresa, y devuelve `{ token, user }` con la cookie de refresh
(`takto_refresh_token`, httpOnly, `SameSite=lax`, `Secure` cuando
`NODE_ENV=production`, `Path=/api/auth`, 90 días). El access token dura 15
minutos y lleva `sid`; `JwtStrategy` valida la sesión en cada petición
(revocada, cerrada, expirada por inactividad de 90 días, usuario y empresa
coincidentes). El refresh es opaco de 32 bytes, guardado como SHA-256 único,
con rotación por compare-and-swap. `LoginEvent` registra éxitos y fallos con IP
truncada, hash del dispositivo y agente de usuario ya interpretado. La cookie de
dispositivo (`takto_device_id`) es un identificador opaco, sin fingerprinting.

**Recuperación de contraseña.** Ya implementa exactamente el patrón que esta
fase necesita: token aleatorio con `crypto`, persistido solo como hash,
un solo uso mediante compare-and-swap, expiración configurable, espera de
reenvío de 60 s, respuesta genérica anti-enumeración, throttling propio,
auditoría sanitizada y compensación si el correo falla. Al restablecer, revoca
todas las sesiones del usuario.

**Correo.** `MailService` con nodemailer sobre SMTP, dos condiciones separadas:
`isEnabled()` (recuperación de contraseña) e `isSmtpConfigured()`
(notificaciones). Una plantilla, sin cola ni reintentos. En staging el SMTP está
configurado y verificado contra el proveedor; la bandera de recuperación de
contraseña está **desactivada**.

**Frontend.** `/login` es una tarjeta centrada con correo, contraseña y enlace de
recuperación. No hay pantalla de verificación, ni panel visual, ni prueba
automatizada del login. No existe librería de animación: hay tokens de duración
y easing y un interruptor global de `prefers-reduced-motion`.

## 2. Matriz requisito → estado → brecha → acción → prueba

| # | Requisito | Estado | Evidencia | Brecha | Acción | Prueba |
|---|---|---|---|---|---|---|
| 1 | Verificación de dispositivo por código al iniciar sesión | FALTANTE | El login crea sesión siempre | No existe challenge | Modelo `DeviceVerificationChallenge` + servicio + endpoints | unit + e2e |
| 2 | Código de 6 dígitos con `crypto`, no `Math.random` | FALTANTE | — | — | `randomInt` con relleno a 6 dígitos | unit |
| 3 | Digest del código con HMAC-SHA256 y secreto propio | FALTANTE | Hoy solo hay SHA-256 sin sal para tokens de alta entropía | Un código de 6 dígitos es de baja entropía: un hash simple es enumerable | `AUTH_CHALLENGE_HMAC_SECRET` exclusivo, comparación en tiempo constante | unit |
| 4 | Validez 10 min, un solo uso, máximo 5 intentos | FALTANTE | — | — | Campos y compare-and-swap como en el reset | unit + e2e |
| 5 | Reenvío con espera de 60 s que invalida el anterior | FALTANTE | El reset ya tiene el patrón | Reutilizar la idea, no el código | `resendAvailableAt` + revocación del previo | unit + e2e |
| 6 | Sin sesión, access ni refresh antes de verificar | FALTANTE | Hoy la sesión se crea en el login | Riesgo central de la fase | La sesión se crea solo al consumir el challenge | e2e |
| 7 | Dispositivo confiable de 30 días, opcional y desmarcado | FALTANTE | — | — | Modelo `TrustedDevice`, token de 32 bytes, solo hash | unit + e2e |
| 8 | Cookie del dispositivo con `__Host-`, sin `Domain` | PARCIAL | Las cookies actuales no usan prefijo y `Secure` depende de `NODE_ENV` | Staging corre con `NODE_ENV=production`, así que admite `__Host-` | Nombre con prefijo cuando la cookie es segura; nombre plano y ruta acotada en desarrollo | unit + e2e |
| 9 | Revocación al vencer, al cerrar sesiones, al cambiar contraseña, al desactivar el usuario | FALTANTE | `revokeAllActiveForUser` solo toca sesiones | Un dispositivo confiable sobreviviría a un robo de cuenta | Revocar dispositivos en el mismo camino que las sesiones | unit + e2e |
| 10 | El token de un usuario no sirve para otro | FALTANTE | — | — | Búsqueda por hash **y** `userId` | e2e |
| 11 | Correo real con marca, código y vigencia, sin secretos | PARCIAL | Hay SMTP verificado y una plantilla de reset | Falta plantilla y método propios | `sendDeviceVerificationEmail` con condición independiente de la de reset | unit |
| 12 | La API solo devuelve el destino enmascarado | FALTANTE | — | — | `is***@dominio` calculado en el servidor | unit + e2e |
| 13 | Kill switch de servidor, apagado por defecto | FALTANTE | — | — | `AUTH_DEVICE_VERIFICATION_ENABLED` validado al arrancar | unit + e2e |
| 14 | Rollout limitado sin exponer correos en Git ni aceptar parámetros del cliente | FALTANTE | — | — | Allowlist opcional por variable de entorno del servidor | unit |
| 15 | Throttling de creación, verificación y reenvío | PARCIAL | Existe la infraestructura y el límite `auth` | Falta aplicarla a los endpoints nuevos | Reutilizar `@Throttle` con los límites existentes | e2e |
| 16 | Sin enumeración de cuentas | HECHO | El login ya responde igual ante usuario inexistente | Mantenerlo cuando hay challenge | El challenge solo se crea tras validar la contraseña | e2e |
| 17 | Auditoría sanitizada de los eventos nuevos | FALTANTE | El patrón existe | — | Cinco acciones nuevas sin código ni token | unit + e2e |
| 18 | Pantalla de acceso con panel ilustrativo de TAKTO | FALTANTE | Login mínimo actual | — | Composición 56/44 con contenido sintético y aviso explícito | Vitest |
| 19 | Nada del inquilino antes de autenticar | HECHO (a preservar) | El login no consulta datos | Riesgo al añadir el panel | Contenido estático, sin consultas | Vitest |
| 20 | Pantalla de verificación con seis dígitos accesible | FALTANTE | — | — | Campo OTP con pegado, flechas, borrado y `one-time-code` | Vitest |
| 21 | Máquina de estados explícita | FALTANTE | Hoy son dos booleanos | — | Estado único tipado | Vitest |
| 22 | Apertura del tablero sin simular pasos | FALTANTE | Hoy salta directo | Riesgo de inventar progreso | Pasos atados a peticiones reales, sin esperas artificiales | Vitest |
| 23 | Etiqueta `Correo`, no `Correo corporativo` | HECHO | El login ya dice `Correo` | El mockup dice «corporativo» | Mantener `Correo` | Vitest |
| 24 | Mostrar u ocultar contraseña accesible | FALTANTE | — | — | Botón con nombre accesible y `aria-pressed` | Vitest |
| 25 | Sin marcas de Claude, Muebles Andina ni personas ficticias | HECHO en el repo | Cero apariciones en el frontend | El mockup sí las trae | No copiarlas | Vitest |
| 26 | Respetar `prefers-reduced-motion` | HECHO (global) | Interruptor en `globals.css` | Las animaciones nuevas deben además neutralizar transformaciones | `motion-reduce:` en lo que se mueva | Vitest |
| 27 | No degradar el rendimiento ni añadir dependencias grandes | — | Sin librería de animación | — | Solo CSS y React | revisión de `package.json` |
| 28 | Migración aditiva y reversible conceptualmente | — | 59 migraciones aplicadas | — | Dos tablas nuevas, ninguna columna existente tocada | `migrate deploy` |

## 3. Decisiones de diseño

1. **La autoridad es el servidor.** El frontend nunca decide si hace falta
   verificar: reacciona a lo que responde `/auth/login`.
2. **Contrato aditivo.** La respuesta de login gana un campo `status`. Con el
   kill switch apagado responde `{ status: 'authenticated', token, user }`, que
   es el objeto de hoy más una clave; los clientes actuales siguen funcionando.
   Cuando hace falta verificar responde `{ status: 'verification_required', … }`
   **sin** token y sin cookie de sesión.
3. **Digest del código.** HMAC-SHA256 con `AUTH_CHALLENGE_HMAC_SECRET`,
   exclusivo de esta función y distinto de `JWT_SECRET`. Comparación con
   `timingSafeEqual`. Un digest simple sería enumerable en un espacio de un
   millón de combinaciones.
4. **Correo independiente del reset.** El envío del código depende de que el
   SMTP esté configurado y del kill switch, no de `PASSWORD_RESET_ENABLED`, que
   sigue como está. Si el envío falla, el challenge se revoca y el usuario
   recibe un error claro: nunca queda un estado ambiguo.
5. **Cookie del dispositivo.** `__Host-takto_trusted_device` con `Path=/` cuando
   la cookie es segura (staging y producción futura); `takto_trusted_device` con
   `Path=/api/auth` en desarrollo sin HTTPS, donde el prefijo no es válido. Sin
   `Domain` en ningún caso. Se lee por cualquiera de los dos nombres.
6. **Revocación en el mismo camino que las sesiones.** Todo lo que hoy llama a
   `revokeAllActiveForUser` (restablecer contraseña, revocación por plataforma)
   revoca también los dispositivos confiables del usuario, dentro de la misma
   transacción cuando la hay.
7. **Sin bypass.** No hay endpoint, cabecera, parámetro ni código universal de
   prueba. En desarrollo, sin SMTP, el flujo simplemente no se activa.

## 4. Lo que esta fase no toca

Duración de sesión (90 días de inactividad) y del access token (15 minutos):
sin cambios. `PASSWORD_RESET_ENABLED` sigue en `false` en staging. Producción,
DNS, Meta y WhatsApp: intactos. Fase 5: no se inicia.

Sin secretos en este documento.
