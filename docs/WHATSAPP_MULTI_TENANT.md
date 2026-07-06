# WhatsApp multiempresa

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

## 5. Cifrado del token

- `accessTokenEncrypted` se cifra con **AES-256-GCM** (módulo `crypto` nativo de Node, sin dependencias externas).
- Formato del valor almacenado:

  ```
  ivHex:authTagHex:cipherTextHex
  ```

  Tres componentes en hexadecimal, separados por `:` — el IV (12 bytes), el authentication tag de GCM (16 bytes) y el texto cifrado.
- La clave de cifrado/descifrado se deriva con `sha256(WHATSAPP_TOKEN_ENCRYPTION_KEY)`, normalizando cualquier passphrase configurada a los 32 bytes que exige AES-256.
- Si falta la clave, el formato es inválido, o el authentication tag no valida (token corrupto o cifrado con otra clave), se lanza un error claro sin imprimir el valor cifrado ni el descifrado.
- Este documento no contiene secretos reales ni tokens de ejemplo con valores reales — todos los tokens usados en pruebas son ficticios.

## 6. Variables de entorno

| Variable | Estado |
| --- | --- |
| `WHATSAPP_TOKEN_ENCRYPTION_KEY` | Nueva. Clave usada para cifrar/descifrar `accessTokenEncrypted` de cada empresa. Documentada (sin valor real) en `.env.example`. |
| `WHATSAPP_VERIFY_TOKEN` | Sigue siendo **global** por ahora — se usa solo en el handshake `GET /webhook` (`hub.verify_token`), que no forma parte de este rediseño. En el patrón estándar de WhatsApp Cloud API multiempresa suele haber un único Meta App/webhook con múltiples `phone_number_id` debajo, por lo que un verify token global en el handshake es válido; lo que cambia es el enrutamiento del *payload* de cada mensaje hacia la empresa dueña de ese `phone_number_id`. |

## 7. Pruebas

- **`WhatsAppIntegrationService`** (`apps/backend/src/modules/whatsapp-integration/whatsapp-integration.service.spec.ts`): cobertura de `findConnectedByPhoneNumberId`, `findConnectedByCompanyId` y `assertConnectedByCompanyId` — integración conectada/no conectada, IDs vacíos, y que el lookup inbound nunca seleccione `accessTokenEncrypted`.
- **`WebhookService`** (`apps/backend/src/modules/webhook/webhook.service.spec.ts`): resolución de tenant por `phoneNumberId`, `phoneNumberId` desconocido, integración no conectada, payload sin mensajes, y el comportamiento existente de deduplicación por `wamid`.
- **`WhatsappService`** (`apps/backend/src/modules/whatsapp/whatsapp.service.spec.ts`): envío correcto con `phoneNumberId` + token descifrado, sin integración conectada, sin `accessTokenEncrypted`, token no descifrable, y verificación de que nunca se loguea el token.
- **Aislamiento Empresa A / Empresa B** (`apps/backend/src/modules/whatsapp-tenant-isolation.spec.ts`): con dos integraciones simultáneas en un Prisma falso, confirma que un webhook o un envío de una empresa nunca toca los datos, el `phoneNumberId` ni el token de la otra.

Todas las pruebas mockean Prisma y `axios` — ninguna llamada real a Meta ni a una base de datos real.

Comandos para verificar:

```
npm test -- --runInBand
npm run test:e2e
npm run build
```

## 8. Limitaciones actuales

- Falta UI en el frontend para conectar/desconectar WhatsApp por empresa.
- Falta un script/helper CLI para cifrar tokens reales al dar de alta una integración (hoy el cifrado solo se ejercita en tests con claves y tokens ficticios).
- Falta validar la firma `X-Hub-Signature-256` de los webhooks entrantes de Meta.
- Falta el proceso de onboarding real con Meta (Embedded Signup u otro flujo de alta de número).
- El verify token (`WHATSAPP_VERIFY_TOKEN`) sigue siendo global, no por integración.
- La migración de `WhatsAppIntegration` fue aditiva: no borra ni modifica `Company.phone`, que queda intacto y sin uso en este flujo.
