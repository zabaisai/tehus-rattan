# WhatsApp multiempresa

> Para preparar y ejecutar una prueba contra un entorno real (staging + Meta real), ver [`docs/WHATSAPP_REAL_TEST_CHECKLIST.md`](./WHATSAPP_REAL_TEST_CHECKLIST.md).

## 1. Resumen

- WhatsApp ahora es multiempresa: cada empresa puede tener su propia integración de WhatsApp Business.
- El **inbound** (webhooks de Meta) se resuelve buscando una `WhatsAppIntegration` conectada por `phoneNumberId`, no por `Company.phone`.
- El **outbound** (envío de mensajes) usa la integración conectada de la empresa autenticada, no credenciales globales.
- `Company.phone` **ya no se usa** para resolver webhooks de WhatsApp. El campo se mantiene intacto en el schema, pero no participa en este flujo.

## 2. Modelo de datos: `WhatsAppIntegration`

Relación 1:1 con `Company` (`companyId` es único).

| Campo | Descripción |
| --- | --- |
| `companyId` | Empresa dueña de la integración (única, 1:1). |
| `displayPhoneNumber` | Número visible del WhatsApp Business, solo informativo. |
| `phoneNumberId` | ID de Meta (Phone Number ID), único — es la clave real de enrutamiento del webhook. |
| `wabaId` | WhatsApp Business Account ID de Meta. |
| `status` | Estado de la integración: `PENDING`, `CONNECTED`, `DISCONNECTED`, `REVOKED`. |
| `accessTokenEncrypted` | Token de acceso de Meta, cifrado (ver sección 5). Nunca se guarda en texto plano. |
| `connectedAt` | Fecha en que la integración pasó a `CONNECTED`. |
| `disconnectedAt` | Fecha en que la integración pasó a `DISCONNECTED`/`REVOKED`. |
| `createdAt` / `updatedAt` | Estándar. |

## 3. Flujo inbound

1. Meta envía un webhook a `POST /webhook` con `value.metadata.phone_number_id`.
2. `WebhookService` llama a `WhatsAppIntegrationService.findConnectedByPhoneNumberId(phoneNumberId)`.
3. Si existe una integración con `status: CONNECTED` para ese `phoneNumberId`, se usa `integration.companyId` como tenant real para crear/buscar el contacto, la conversación y el mensaje.
4. Si no existe integración, o existe pero no está `CONNECTED`, el evento se ignora: no se crea contacto, conversación ni mensaje, y no se lanza error al llamador (Meta sigue recibiendo `200 OK` desde el controller, que responde antes de procesar).
5. Logs seguros: solo se registra el `phoneNumberId` y el resultado (procesado / ignorado / duplicado). **Nunca** se loguean tokens, headers `Authorization`, ni el payload completo del webhook.

## 4. Flujo outbound

1. `ConversationsController.sendWhatsApp` valida que la conversación pertenezca a `req.user.companyId` (sin cambios respecto al control de tenant existente) y pasa ese `companyId` a `WhatsappService.sendMessage`.
2. `WhatsappService` busca la integración conectada de esa empresa vía `WhatsAppIntegrationService.findConnectedByCompanyId(companyId)`.
3. Si no hay integración conectada, o le falta `accessTokenEncrypted`, se lanza `NotFoundException('WhatsApp no conectado para esta empresa')` — no se realiza ninguna llamada a Meta.
4. Se descifra `accessTokenEncrypted` (ver sección 5) para obtener el token real.
5. Se envía el mensaje a `https://graph.facebook.com/v19.0/{phoneNumberId}/messages` usando el `phoneNumberId` de **esa** integración y `Authorization: Bearer <token descifrado>`.
6. Ya **no** se usan `WHATSAPP_PHONE_NUMBER_ID` ni `WHATSAPP_TOKEN` globales en ningún punto del envío.

## 5. Endpoints de gestión

Endpoints para que cada empresa conecte, consulte o desconecte su propia integración de WhatsApp. Siguen el mismo patrón `me` ya usado en `CompaniesController`.

### `GET /api/whatsapp-integrations/me`

- Requiere usuario autenticado.
- Permitido para cualquier rol: `SUPER_ADMIN`, `ADMIN` y `AGENT`.
- Devuelve la integración de la empresa del usuario autenticado, o `null` si no existe ninguna.
- Nunca devuelve `accessToken` ni `accessTokenEncrypted`.

### `PUT /api/whatsapp-integrations/me`

- Requiere `ADMIN` o `SUPER_ADMIN`.
- Crea o actualiza (upsert) la integración de la empresa autenticada.
- Usa `req.user.companyId` — nunca un `companyId` del body.
- Body permitido:
  - `phoneNumberId` (obligatorio)
  - `accessToken` (obligatorio, en texto plano solo en este request)
  - `displayPhoneNumber` (opcional)
  - `wabaId` (opcional)
- El `accessToken` llega en texto plano únicamente en este request y se cifra (`WhatsAppTokenCryptoService.encrypt`) antes de guardarse como `accessTokenEncrypted`. Nunca se guarda el token en texto plano.
- Nunca devuelve `accessTokenEncrypted` en la respuesta.
- Si el `phoneNumberId` ya pertenece a otra empresa, responde con un `409 Conflict` y un mensaje claro, sin exponer un error crudo de constraint de Prisma.

### `POST /api/whatsapp-integrations/me/disconnect`

- Requiere `ADMIN` o `SUPER_ADMIN`.
- Cambia `status` a `DISCONNECTED` y setea `disconnectedAt`.
- No borra la fila de `WhatsAppIntegration`.
- No llama a Meta todavía (no revoca el token del lado de Meta — ver sección 9, Limitaciones).
- Nunca devuelve tokens en la respuesta.

### Seguridad

- `companyId` siempre viene del JWT (`req.user.companyId`); ningún endpoint acepta `companyId` desde el body o desde params.
- `ConnectWhatsAppIntegrationDto` no declara `companyId`, `status` ni `accessTokenEncrypted` — el `ValidationPipe` global (`whitelist: true, forbidNonWhitelisted: true`) rechaza esos campos con `400` si llegan en el body.
- Ningún log de estos endpoints incluye el token plano ni el cifrado.
- Ningún endpoint de esta fase llama a Meta — `connectOrUpdateForCompany` y `disconnectForCompany` solo leen/escriben en la base de datos.

## 6. Cifrado del token

- `accessTokenEncrypted` se cifra con **AES-256-GCM** (módulo `crypto` nativo de Node, sin dependencias externas).
- Formato del valor almacenado:

  ```
  ivHex:authTagHex:cipherTextHex
  ```

  Tres componentes en hexadecimal, separados por `:` — el IV (12 bytes), el authentication tag de GCM (16 bytes) y el texto cifrado.
- La clave de cifrado/descifrado se deriva con `sha256(WHATSAPP_TOKEN_ENCRYPTION_KEY)`, normalizando cualquier passphrase configurada a los 32 bytes que exige AES-256.
- Si falta la clave, el formato es inválido, o el authentication tag no valida (token corrupto o cifrado con otra clave), se lanza un error claro sin imprimir el valor cifrado ni el descifrado.
- Este documento no contiene secretos reales ni tokens de ejemplo con valores reales — todos los tokens usados en pruebas son ficticios.

### 6.1 Generar un `accessTokenEncrypted`

Hay un helper de línea de comandos en `apps/backend/scripts/encrypt-whatsapp-token.ts` que cifra un token con el mismo formato exacto que espera `WhatsappService`. No se conecta a Prisma, no hace llamadas a Meta, y no guarda nada — solo imprime el valor cifrado en la terminal.

```
WHATSAPP_TOKEN_ENCRYPTION_KEY="<clave-de-tu-entorno>" npm run whatsapp:encrypt-token -- "<token-real-de-meta>"
```

- Si se omite el token como argumento, el script lo pide por prompt interactivo.
- Si falta `WHATSAPP_TOKEN_ENCRYPTION_KEY`, o no se proporciona ningún token, el script termina con un mensaje de error claro y código de salida distinto de cero — nunca imprime la clave ni el token en esos casos.
- El resultado impreso es el valor listo para guardar en `WhatsAppIntegration.accessTokenEncrypted`.

Ejemplo con valores ficticios (nunca usar tokens reales fuera de un entorno seguro):

```
$ WHATSAPP_TOKEN_ENCRYPTION_KEY="fixture-only-key-not-real" npm run whatsapp:encrypt-token -- "FAKE-TEST-TOKEN-12345"
018881fbd7d09e317bb2d06e:b6ee0210fb440c15de01be5cf7e44895:ead2088bfe683038c210ed070cafe89179e2179ac9
```

## 7. Variables de entorno

| Variable | Estado |
| --- | --- |
| `WHATSAPP_TOKEN_ENCRYPTION_KEY` | Nueva. Clave usada para cifrar/descifrar `accessTokenEncrypted` de cada empresa. Documentada (sin valor real) en `.env.example`. |
| `WHATSAPP_VERIFY_TOKEN` | Sigue siendo **global** por ahora — se usa solo en el handshake `GET /webhook` (`hub.verify_token`), que no forma parte de este rediseño. En el patrón estándar de WhatsApp Cloud API multiempresa suele haber un único Meta App/webhook con múltiples `phone_number_id` debajo, por lo que un verify token global en el handshake es válido; lo que cambia es el enrutamiento del *payload* de cada mensaje hacia la empresa dueña de ese `phone_number_id`. |

## 8. Pruebas

- **`WhatsAppIntegrationService`** (`apps/backend/src/modules/whatsapp-integration/whatsapp-integration.service.spec.ts`): cobertura de `findConnectedByPhoneNumberId`, `findConnectedByCompanyId` y `assertConnectedByCompanyId` — integración conectada/no conectada, IDs vacíos, y que el lookup inbound nunca seleccione `accessTokenEncrypted`.
- **`WhatsAppTokenCryptoService`** (`apps/backend/src/modules/whatsapp-integration/whatsapp-token-crypto.service.spec.ts`): formato de 3 partes, round-trip cifrado/descifrado, rechazo de token/clave vacíos, fallo sin `WHATSAPP_TOKEN_ENCRYPTION_KEY`, y que ningún mensaje de error incluye el token ni la clave.
- **`WhatsAppIntegrationManagementService`** (`apps/backend/src/modules/whatsapp-integration/whatsapp-integration-management.service.spec.ts`): `getForCompany`, `connectOrUpdateForCompany` (upsert, cifrado del token recibido, conflicto de `phoneNumberId` entre empresas) y `disconnectForCompany` (cambia estado sin borrar la fila) — todas las respuestas verificadas sin `accessTokenEncrypted`.
- **`WhatsAppIntegrationController`** (`apps/backend/src/modules/whatsapp-integration/whatsapp-integration.controller.spec.ts`): cada endpoint delega en el service con `req.user.companyId` (nunca con un `companyId` del body), metadata de roles (`GET /me` sin `@Roles`, `PUT`/`disconnect` con `@Roles('ADMIN', 'SUPER_ADMIN')`), y los guards de clase aplicados.
- **`WebhookService`** (`apps/backend/src/modules/webhook/webhook.service.spec.ts`): resolución de tenant por `phoneNumberId`, `phoneNumberId` desconocido, integración no conectada, payload sin mensajes, y el comportamiento existente de deduplicación por `wamid`.
- **`WhatsappService`** (`apps/backend/src/modules/whatsapp/whatsapp.service.spec.ts`): envío correcto con `phoneNumberId` + token descifrado, sin integración conectada, sin `accessTokenEncrypted`, token no descifrable, y verificación de que nunca se loguea el token.
- **Aislamiento Empresa A / Empresa B** (`apps/backend/src/modules/whatsapp-tenant-isolation.spec.ts`): con dos integraciones simultáneas en un Prisma falso, confirma que un webhook o un envío de una empresa nunca toca los datos, el `phoneNumberId` ni el token de la otra.
- **Whitelist de DTOs** (`apps/backend/src/modules/dto-tenant-whitelist.spec.ts`): además de los DTOs existentes, cubre `ConnectWhatsAppIntegrationDto` rechazando `companyId`, `status` y `accessTokenEncrypted` en el body.

Todas las pruebas mockean Prisma y `axios` — ninguna llamada real a Meta ni a una base de datos real.

Comandos para verificar (estado actual):

```
npm test -- --runInBand   # 10 suites, 99 tests
npm run test:e2e          # 2 suites, 5 tests
npm run build             # OK
```

## 9. Limitaciones actuales

- Ya **no** falta un endpoint/admin básico para registrar o actualizar una integración por empresa — cubierto por `GET/PUT /whatsapp-integrations/me` y `POST /whatsapp-integrations/me/disconnect` (ver sección 5).
- Todavía falta UI en el frontend para conectar/desconectar WhatsApp por empresa.
- Todavía falta el proceso de onboarding real con Meta (Embedded Signup u otro flujo de alta de número).
- Todavía falta validar la firma `X-Hub-Signature-256` de los webhooks entrantes de Meta.
- Todavía falta probar contra un número de WhatsApp real — todo lo actual está cubierto con mocks/fixtures ficticias, nunca con Meta real.
- El verify token (`WHATSAPP_VERIFY_TOKEN`) sigue siendo global, no por integración.
- `POST /me/disconnect` actualmente solo marca `status: DISCONNECTED` localmente — no revoca ni desconecta nada del lado de Meta.
- La migración de `WhatsAppIntegration` fue aditiva: no borra ni modifica `Company.phone`, que queda intacto y sin uso en este flujo.
