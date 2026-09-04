# Fase 4.5 — Matriz de pruebas

Línea base tomada antes de tocar código (2026-09-05, worktree de la fase):
backend 153 suites / 2473 unitarias y 72 suites / 1065 e2e; frontend 113
ficheros / 1183 pruebas. Todo en verde.

## Regresión completa (mismos comandos que el CI)

| Ámbito | Comprobación | Resultado |
| --- | --- | --- |
| Backend | `npx prisma validate` | OK |
| Backend | `npm run typecheck` | OK — 0 errores |
| Backend | `npx eslint "{src,apps,libs,test}/**/*.ts" --no-fix` | OK — 0 errores, 0 avisos |
| Backend | `npm test -- --runInBand` | **158 suites / 2556 pruebas** |
| Backend | `npm run build` (`nest build`) | OK |
| Backend | `npm run test:e2e -- --runInBand` (PostgreSQL y Redis reales) | **74 suites / 1110 pruebas** |
| Frontend | `npx tsc --noEmit` | OK — 0 errores |
| Frontend | `npx eslint src` | 0 errores (2 avisos anteriores a la fase) |
| Frontend | `npx vitest run` | **116 ficheros / 1235 pruebas** |
| Frontend | `npx next build` | OK |
| Prisma | Migraciones nuevas | 1, aditiva (`20260905090000_verificacion_de_dispositivo`) |

## Requisito → prueba

### Código de verificación

| Requisito | Pruebas |
| --- | --- |
| Generación con `crypto`, nunca `Math.random` | `device-code.util.spec.ts` (no llama a `Math.random`; cubre todo el rango) |
| Seis dígitos con ceros a la izquierda | `device-code.util.spec.ts` (2000 códigos: todos de longitud 6, alguno empieza por cero) |
| Digest HMAC con secreto propio, no un hash desnudo | `device-code.util.spec.ts` (distinto del SHA-256 del código; cambia con el secreto y con el reto) |
| Comparación en tiempo constante | `device-code.util.spec.ts` (longitudes distintas no lanzan) |
| Destino enmascarado | `device-code.util.spec.ts`, e2e `device-verification` |
| Vigencia de diez minutos | `device-verification.service.spec.ts`, e2e (reto vencido → 400) |
| Cinco intentos y bloqueo | `device-verification.service.spec.ts`, e2e |
| Un solo uso | `device-verification.service.spec.ts`, e2e (código reutilizado → 400) |
| Dos verificaciones simultáneas: solo una gana | `device-verification.service.spec.ts` |
| Espera de reenvío e invalidación del anterior | `device-verification.service.spec.ts`, e2e |
| Error genérico en todos los casos, incluido sin secreto | `device-verification.service.spec.ts`, e2e |
| El código nunca se guarda ni viaja | `device-verification.service.spec.ts` (fila, vista y auditoría sin el código), e2e |
| Fallo de correo → reto revocado y error claro | `device-verification.service.spec.ts` |

### Dispositivo confiable

| Requisito | Pruebas |
| --- | --- |
| Token opaco de 32 bytes, solo su hash en base | `trusted-device.service.spec.ts`, e2e |
| Treinta días de vigencia | `trusted-device.service.spec.ts` |
| El token de una cuenta no vale para otra | `trusted-device.service.spec.ts`, e2e `trusted-device` |
| Vencido o revocado deja de valer | `trusted-device.service.spec.ts`, e2e |
| Usarlo no alarga la vigencia | `trusted-device.service.spec.ts` |
| Cookie `__Host-` con HTTPS, nombre plano y ruta acotada sin él | `trusted-device-cookie.util.spec.ts`, e2e |
| `HttpOnly`, `SameSite=Lax`, sin `Domain` | `trusted-device-cookie.util.spec.ts`, e2e |
| Revocación: explícita, cierre de todas las sesiones, restablecer contraseña, desactivar cuenta, vencimiento | `trusted-device.service.spec.ts`, e2e `trusted-device` (cinco caminos) |
| Revocación explícita auditada sin el token | `trusted-device.service.spec.ts` |

### Flujo y contrato

| Requisito | Pruebas |
| --- | --- |
| Sin sesión, token ni cookie antes de verificar | e2e `device-verification` (cero `UserSession`, sin `set-cookie`, `/auth/me` 401) |
| La sesión nace al consumir el código | e2e (sesión creada, token válido contra `/auth/me`) |
| Contraseña incorrecta y cuenta inexistente responden igual | e2e (cuerpos idénticos, `LoginEvent` FAILED) |
| El reto solo se crea tras validar la contraseña | e2e |
| DTO estricto: claves desconocidas, código mal formado, falta el reto | e2e |
| Guarda de origen | e2e (Origin ajeno → 403) |
| Auditoría sin secretos | e2e (metadatos sin código, digest, token ni correo) |

### Interruptor y despliegue

| Requisito | Pruebas |
| --- | --- |
| Apagado por defecto: acceso idéntico al anterior | `device-verification.config.spec.ts`, e2e, QA local |
| Solo el texto exacto `true` enciende | `device-verification.config.spec.ts` |
| Encendido sin secreto no se aplica y avisa una vez | `device-verification.config.spec.ts` |
| Allowlist limita a las cuentas indicadas | `device-verification.config.spec.ts`, e2e |
| El arranque exige secreto y SMTP | `env.validation.spec.ts` |

### Frontend

| Requisito | Pruebas |
| --- | --- |
| Máquina de estados | `login-machine.test.ts` |
| Acceso: etiquetas, autocompletado, ver contraseña, Bloq Mayús, doble envío | `login/page.test.tsx` |
| Transición a verificación sin sesión | `login/page.test.tsx` |
| Seis casillas: pegado, flechas, borrado, `one-time-code` | `DeviceVerificationForm.test.tsx` |
| Cuenta atrás, reenvío y aviso de intentos | `DeviceVerificationForm.test.tsx` |
| Casilla de confianza desmarcada y enviada solo si se marca | ambas |
| Error genérico sin revelar existencia; bloqueo por 429 | `login/page.test.tsx` |
| Apertura del tablero sin porcentajes ni esperas | `login/page.test.tsx` |
| Panel ilustrativo sin datos reales ni peticiones | `login/page.test.tsx` |
| Sin «código de prueba» en ninguna pantalla | ambas |

## QA local con el producto levantado (2026-09-05)

Backend `node dist/src/main` y frontend `next start` con el build de
producción, base local y un servidor SMTP de pruebas en el equipo. El código se
leyó **del buzón**, nunca de la base. Empresa y usuarios temporales
`QA_PHASE45_<stamp>`, borrados por ID al final.

**Por API: 36 comprobaciones, 0 fallos.**

| Bloque | Verificado |
| --- | --- |
| Interruptor apagado | Entra directo con token y cookie de refresh; `verify-device` no abre nada |
| Credenciales | Contraseña incorrecta y cuenta inexistente responden exactamente igual |
| Dispositivo nuevo | `verification_required` sin token ni cookie; `/auth/me` sigue cerrado; destino enmascarado |
| Correo | Llega con la marca, el código y la vigencia; sin contraseñas, tokens ni enlaces con parámetros |
| Código | Incorrecto → error genérico; clave desconocida y formato inválido → 400; correcto → sesión; reutilizado → 400 |
| Confianza | Sin marcar no hay cookie; marcada emite `HttpOnly`, `SameSite=Lax`, sin `Domain`; el segundo acceso no pide código |
| Aislamiento | El dispositivo de una cuenta no vale para otra |
| Revocación | `revoke-all` responde el conteo y el acceso vuelve a pedir código |
| Límites | Ráfaga de intentos → 429 por IP; cinco fallos agotan el reto y ni el código correcto abre sesión |

**Por navegador (Chrome headless): 28 comprobaciones, 0 fallos, 0 errores de consola.**

| Bloque | Verificado |
| --- | --- |
| Acceso | Un solo `h1`; panel de TAKTO con el aviso «Vista ilustrativa»; dice `Correo`, no «Correo corporativo»; botón `Continuar`; sin marcas del prototipo ni datos ficticios de empresas; sin promesas de seguridad falsas |
| Contraseña | El botón de ver contraseña cambia el tipo del campo |
| Verificación | Destino enmascarado y correo completo oculto; casilla de confianza desmarcada; sin «código de prueba»; un código incorrecto se anuncia sin decir por qué falló |
| Acceso completo | Con el código correcto se abre el tablero |
| Anchos 320 / 390 / 768 / 1024 / 1280 / 1440 / 1920 | Sin scroll horizontal ni controles sin nombre; el panel decorativo no se monta por debajo de 1024 px y sí aparece por encima |
| Objetivos táctiles | Los cinco controles miden 44 px de alto |

**Verificación en base y limpieza.** Doce retos, todos con huella hexadecimal
de 64 caracteres y ninguno con el código; tres dispositivos (dos revocados por
la prueba de revocación, uno vigente); auditoría con los cuatro eventos y sin
secretos. Borrado por ID: 12 retos, 3 dispositivos, 36 filas de auditoría, 10
eventos de acceso, 6 sesiones, 2 usuarios y 1 empresa. **Residuos: 0.**

## Correcciones surgidas del QA

1. La revocación explícita de dispositivos no quedaba auditada, pese a estar
   documentada como evento. Se añadió `revokeAllForUserAudited` y su prueba.
2. El enlace «¿Olvidaste tu contraseña?» medía 18 px de alto, por debajo del
   mínimo de 24 px de WCAG 2.2 AA para objetivos táctiles. Ahora mide 44 px.
3. `verify-device` respondía 503 cuando faltaba el secreto, lo que permitía
   distinguir sin autenticarse si la función estaba configurada. Ahora responde
   el mismo error genérico que un código incorrecto.

## Deuda registrada

- El interruptor se lee al arrancar: cambiarlo exige reiniciar el backend, no
  basta con editar el entorno en caliente. Es el procedimiento normal de
  despliegue y está recogido en `ROLLBACK.md`.
- `PASSWORD_RESET_ENABLED` sigue desactivado en staging: la recuperación de
  contraseña no envía correo. Es anterior a esta fase y no se toca aquí.
- Sin cola ni reintento para el correo: un fallo de envío revoca el reto y pide
  reintentar.
