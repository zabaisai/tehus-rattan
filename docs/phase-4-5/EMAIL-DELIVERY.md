# Fase 4.5 — Entrega del correo

## Infraestructura reutilizada

No se añade proveedor ni cola. Se usa `MailService`
(`apps/backend/src/modules/mail/mail.service.ts`), el mismo que envía la
recuperación de contraseña: nodemailer sobre SMTP, transporte memoizado, un
`sendMail` directo por llamada.

Variables (solo nombres; los valores viven en la configuración protegida del
servidor y nunca en el repositorio): `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`,
`SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME`.

## Dos condiciones separadas

| Correo | Condición | Estado en staging |
|---|---|---|
| Recuperación de contraseña | `PASSWORD_RESET_ENABLED === 'true'` **y** `SMTP_HOST` | Desactivado (`false`), sin cambios en esta fase |
| **Código de verificación (nuevo)** | `isSmtpConfigured()` (host, usuario, contraseña y remitente) **y** el interruptor de la fase | SMTP configurado y verificado |

Son deliberadamente independientes: encender la verificación de dispositivo no
puede encender el correo de recuperación por efecto lateral, ni al revés. El
arranque exige las cuatro variables SMTP cuando el interruptor de la fase está
en `true`.

## Comportamiento ante fallo

`sendDeviceVerificationEmail` **lanza** si el SMTP no está configurado o el
envío falla. Es lo contrario del correo de notificación, que es un no-op
tolerante: aquí un fallo silencioso dejaría a la persona ante una pantalla
pidiendo un código que nunca llega. Quien llama revoca el reto y responde 503
con un texto claro.

El registro dice solo que el envío falló. Nunca el código, el destinatario ni
la dirección.

## Contenido del mensaje

Asunto: `Tu código de acceso a TAKTO: <código>`.

Cuerpo (versión HTML y versión de texto): marca TAKTO, el código en grande y
monoespaciado, la vigencia en minutos y una línea que explica que puede
ignorarse si no intentó entrar. Sin contraseña, sin tokens internos, sin
enlaces con secretos, sin píxeles de seguimiento, sin datos de la empresa.

Plantilla: `src/modules/mail/templates/device-verification-email.template.ts`,
con escapado de HTML como la de recuperación.

## Qué sale por la API

Solo el destino enmascarado (`is***@dominio`), calculado en el servidor. El
código **nunca** aparece en una respuesta, un registro, la auditoría, un
mensaje de error ni una métrica. No existe endpoint, cabecera ni parámetro que
lo devuelva, ni «código de prueba» en ningún entorno.

## Verificación del proveedor en staging (2026-09-04, solo lectura)

Desde el contenedor del backend, sin enviar ningún mensaje:

- conexión TLS al puerto 465 correcta, saludo `220 ESMTP` del proveedor;
- `transporter.verify()` → **OK**: el proveedor acepta las credenciales
  configuradas.

Queda pendiente, para el QA de staging, una dirección de correo controlada y
autorizada a la que enviar el código. No se envía a ninguna dirección
encontrada en la base de datos.

## Desarrollo local

Sin SMTP configurado, `isSmtpConfigured()` es falso y el arranque impide
encender el interruptor, así que el flujo no se activa y el acceso es el de
siempre. Para el QA local se usa un transporte SMTP de pruebas en el propio
equipo y el código se lee del buzón de ese transporte, nunca de la base de
datos.
