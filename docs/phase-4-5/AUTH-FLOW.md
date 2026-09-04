# Fase 4.5 — Flujo de acceso

## Resumen

El inicio de sesión sigue siendo contraseña. Lo nuevo es que, cuando el
interruptor está encendido y el dispositivo no se reconoce, hace falta además
un código de seis dígitos enviado por correo. Hasta que ese código se consume
**no existe sesión, ni access token, ni refresh token**.

Un dispositivo confiable no sustituye a la contraseña: solo evita repetir el
código durante 30 días.

## Recorrido normal

1. La persona envía correo y contraseña a `POST /api/auth/login`.
2. El servidor valida la contraseña con bcrypt y comprueba, como siempre, que
   la cuenta esté activa y su empresa no esté suspendida ni eliminada. Los
   fallos siguen respondiendo `Credenciales inválidas` sin distinguir si el
   correo existe.
3. Si la verificación no aplica (interruptor apagado, o la cuenta queda fuera
   del despliegue controlado) → sesión y respuesta de siempre.
4. Si aplica y el navegador presenta una cookie de dispositivo confiable válida
   **de esa misma cuenta** → sesión y respuesta de siempre.
5. En cualquier otro caso se crea un reto, se envía el código y se responde
   `verification_required`. No se emite nada más.
6. La persona envía el código a `POST /api/auth/verify-device`. Si acierta, ahí
   nace la sesión: `UserSession`, access token de 15 minutos y cookie de
   refresh. Si además marcó la casilla, se emite la cookie del dispositivo.

## Contrato

### `POST /api/auth/login`

Cuerpo: `{ email, password }`. Guardas: `CookieOriginGuard`, límite `auth`.

```jsonc
// Sesión abierta (también es lo único que ocurre con el interruptor apagado)
{ "status": "authenticated", "token": "<jwt 15 min>", "user": { "id", "email", "name" } }

// Falta verificar el dispositivo: ni token ni cookie de sesión
{
  "status": "verification_required",
  "challengeId": "<opaco>",
  "maskedEmail": "is***@dominio",
  "expiresAt": "<ISO>",
  "resendAvailableAt": "<ISO>",
  "attemptsRemaining": 5
}
```

### `POST /api/auth/verify-device`

Cuerpo: `{ challengeId, code, trustDevice? }`. No acepta `userId`, `email` ni
`companyId`: la cuenta sale del reto, que solo existe porque alguien acertó la
contraseña. Cualquier clave desconocida → 400 sin efectos.

Respuesta: `{ status: 'authenticated', token, user }` más la cookie de refresh
y, si `trustDevice` es `true`, la del dispositivo. Error: 400 con el mensaje
único `El código no es válido o ya venció. Solicita uno nuevo.`

### `POST /api/auth/verify-device/resend`

Cuerpo: `{ challengeId }`. Respeta la espera mínima, revoca el reto anterior y
crea uno nuevo, de modo que solo un código está vivo a la vez.

### `POST /api/auth/trusted-devices/revoke-all`

Autenticado. Retira la confianza de todos los dispositivos de quien lo pide y
borra la cookie. Es la vía explícita para «dejar de recordar mis dispositivos».

## Parámetros

| Parámetro | Valor | Dónde |
|---|---|---|
| Longitud del código | 6 dígitos | `device-verification.constants.ts` |
| Vigencia del código | 10 minutos | ídem |
| Intentos por reto | 5 | ídem |
| Espera entre reenvíos | 60 segundos | ídem |
| Vigencia del dispositivo confiable | 30 días | ídem |
| Access token | 15 minutos | sin cambios (Fase 2) |
| Sesión (inactividad) | 90 días | sin cambios |

Las tres duraciones son distintas y se documentan por separado a propósito: la
sesión mide cuánto dura el acceso, el dispositivo confiable cuánto dura el
recuerdo del segundo factor, y el código cuánto dura un intento concreto.

## Generación y comprobación del código

- Se genera con `crypto.randomInt`, nunca con `Math.random`, y se rellena con
  ceros a la izquierda para no perder combinaciones.
- En base se guarda `HMAC-SHA256(challengeId + ':' + código)` con
  `AUTH_CHALLENGE_HMAC_SECRET`, un secreto exclusivo de esta función. Un hash
  simple sería inútil: un millón de combinaciones se precalculan en segundos.
  El `challengeId` entra en el mensaje para que la huella de un reto no valga
  en otro.
- La comparación es en tiempo constante (`timingSafeEqual`).
- El intento se descuenta con una escritura condicional **antes** de comparar,
  y el consumo del reto es otra escritura condicional (`consumedAt IS NULL`):
  dos peticiones simultáneas con el mismo código abren, como mucho, una sesión.

## Cookies

| Cookie | Nombre | Atributos | Vida |
|---|---|---|---|
| Refresh (existente) | `takto_refresh_token` | `HttpOnly`, `Secure` en producción, `SameSite=Lax`, `Path=/api/auth` | 90 días |
| Dispositivo (existente) | `takto_device_id` | `HttpOnly`, `SameSite=Lax`, `Path=/` | ~2 años |
| **Dispositivo confiable (nueva)** | `__Host-takto_trusted_device` con HTTPS; `takto_trusted_device` sin él | `HttpOnly`, `Secure` con HTTPS, `SameSite=Lax`, `Path=/` con el prefijo y `/api/auth` sin él, **nunca `Domain`** | 30 días |

El prefijo `__Host-` solo lo acepta el navegador si la cookie es `Secure`,
tiene `Path=/` y no declara `Domain`, así que ningún subdominio vecino puede
escribirla. Staging corre con `NODE_ENV=production`, de modo que allí se usa el
nombre con prefijo.

## Revocación del dispositivo confiable

Se retira la confianza cuando:

- vence (30 días);
- la persona llama a `trusted-devices/revoke-all`;
- se cierran **todas** las sesiones de la cuenta
  (`SessionsService.revokeAllActiveForUser`), lo que incluye el
  restablecimiento de contraseña;
- un SUPER_ADMIN revoca las sesiones de un usuario o de una empresa entera;
- se desactiva la cuenta.

Cerrar una sola sesión (logout) **no** retira la confianza: el segundo factor
es del equipo, no de la sesión. Está documentado aquí porque es una decisión,
no un descuido.

## Qué se audita

`DEVICE_VERIFICATION_CHALLENGE_CREATED`, `DEVICE_VERIFICATION_SUCCEEDED`,
`DEVICE_VERIFICATION_FAILED`, `TRUSTED_DEVICE_CREATED`,
`TRUSTED_DEVICE_REVOKED`. Cada fila guarda el identificador del reto o del
dispositivo, el tipo de equipo, el navegador y la IP ya truncada. Nunca el
código, su huella, el token, la contraseña ni el correo completo.

## Interruptor y despliegue controlado

| Variable | Efecto |
|---|---|
| `AUTH_DEVICE_VERIFICATION_ENABLED` | `false` por defecto: el acceso es exactamente el anterior a esta fase. `true` activa el flujo. Solo se aceptan esos dos textos. |
| `AUTH_CHALLENGE_HMAC_SECRET` | Obligatorio con el interruptor encendido: mínimo 32 caracteres y distinto de `JWT_SECRET`. Sin él, el arranque falla; si aun así faltara en caliente, la verificación queda inactiva y se registra el error. |
| `AUTH_DEVICE_VERIFICATION_ALLOWLIST` | Opcional. Correos separados por coma a los que se limita la verificación mientras se prueba. Vive en la configuración protegida del servidor, nunca en el repositorio, y no se registra. |

El frontend nunca decide: reacciona al `status` que responde el servidor. No
existe cabecera, parámetro ni código universal que salte la verificación.

## Qué NO cambia

Duración de sesión y de access token, rotación del refresh, expiración por
inactividad, política de contraseñas, recuperación de contraseña, CORS, CSRF,
límites de peticiones y auditoría existente.
