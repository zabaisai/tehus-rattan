# Checklist de prueba real — WhatsApp multiempresa

## 1. Propósito

Esta guía sirve para preparar y ejecutar una prueba real de WhatsApp Cloud API contra el backend de Tehus Rattan, en un entorno de staging o similar, **sin exponer secretos** en el chat, en commits, en capturas de pantalla ni en ningún documento del repositorio. Ningún paso de esta guía se ejecuta desde esta conversación — todos los pasos con credenciales reales se hacen en tu propio entorno seguro.

## 2. Estado actual del backend

Antes de esta prueba, ya está implementado y subido a `develop`:

- Modelo `WhatsAppIntegration` por empresa (relación 1:1 con `Company`).
- Tenant siempre resuelto por JWT (`req.user.companyId`), nunca por body/params.
- Inbound resuelto por `phoneNumberId` (no por `Company.phone`).
- Outbound resuelto por la integración conectada de la empresa autenticada.
- Token cifrado en DB (AES-256-GCM) vía `WhatsAppTokenCryptoService`.
- Endpoints de gestión: `GET/PUT /api/whatsapp-integrations/me`, `POST /api/whatsapp-integrations/me/disconnect`.
- Pruebas unitarias (99) y E2E (17) cubriendo aislamiento multiempresa, permisos, y el pipeline HTTP real de estos endpoints.

Ver `docs/WHATSAPP_MULTI_TENANT.md` para el detalle de cada flujo.

## 3. Checklist antes de tocar Meta

- [ ] `git branch --show-current` confirma que estás en `develop` (o la rama de staging correspondiente).
- [ ] `git status` confirma working tree limpio.
- [ ] `git log --oneline -8` confirma que el commit más reciente es el esperado (al momento de escribir esta guía: `c15ad25`).
- [ ] `npm test -- --runInBand`, `npm run test:e2e` y `npm run build` pasan sin errores.
- [ ] Tienes una base Postgres real de prueba/staging disponible (no la de desarrollo local sin datos, y **nunca** producción para la primera prueba).
- [ ] Confirmas que **no** vas a pegar tokens reales en este chat, en commits, en mensajes de Slack/correo, ni en capturas de pantalla.
- [ ] Tienes un usuario `ADMIN` de una empresa de prueba ya creado en esa base (o puedes crearlo vía `POST /auth/register`).

## 4. Variables de entorno necesarias

Solo nombres, sin valores reales:

| Variable | Uso |
| --- | --- |
| `DATABASE_URL` | Conexión a la base Postgres de staging. |
| `JWT_SECRET` | Firma de los JWT emitidos por el backend. |
| `WHATSAPP_TOKEN_ENCRYPTION_KEY` | Clave para cifrar/descifrar `accessTokenEncrypted` de cada empresa. |
| `WHATSAPP_VERIFY_TOKEN` | Token del handshake `GET /api/webhook` con Meta. |

Notas importantes:
- **`WHATSAPP_TOKEN_ENCRYPTION_KEY` no se debe perder ni cambiar sin un plan de rotación**: si cambia, todos los `accessTokenEncrypted` ya guardados quedan indescifrables y cada empresa tendría que reconectar su WhatsApp.
- `WHATSAPP_VERIFY_TOKEN` se usa únicamente para el handshake inicial (`GET /api/webhook`) — sigue siendo global en esta fase (ver sección 12).
- **Nunca** commitear el archivo `.env` real. Esta guía nunca debe modificarlo ni leerlo.

## 5. Migración

Documentado, pero **no ejecutado desde esta sesión**:

1. Hacer backup de la base de staging antes de aplicar cualquier migración.
2. Revisar migraciones pendientes con `npx prisma migrate status` (comando de solo lectura).
3. Comando recomendado para aplicar en staging/entorno real:
   ```
   npx prisma migrate deploy
   ```
   (Nunca `npx prisma migrate dev` en un entorno que no sea tu máquina local de desarrollo — `migrate dev` puede intentar resetear/recrear la base si detecta drift.)
4. Confirmar que la migración `add_whatsapp_integration` es **aditiva**: solo `CREATE TYPE`, `CREATE TABLE`, `CREATE INDEX` y una `ADD CONSTRAINT` de foreign key — no borra ni modifica ninguna columna existente, y no toca `Company.phone`.

## 6. Configuración de integración vía API

```
PUT /api/whatsapp-integrations/me
Authorization: Bearer <JWT_ADMIN>
Content-Type: application/json

{
  "phoneNumberId": "<PHONE_NUMBER_ID_DE_META>",
  "accessToken": "<TOKEN_REAL_SOLO_EN_TU_ENTORNO_SEGURO>",
  "displayPhoneNumber": "<NUMERO_VISIBLE>",
  "wabaId": "<WABA_ID>"
}
```

- Este request se ejecuta localmente (curl/Postman/Insomnia) contra tu entorno de staging, nunca desde este chat.
- `Authorization: Bearer <JWT_ADMIN>` debe ser el JWT real de un usuario `ADMIN` o `SUPER_ADMIN` de la empresa de prueba.
- El `accessToken` viaja en texto plano únicamente en este request (sobre HTTPS) — el backend lo cifra (`WhatsAppTokenCryptoService.encrypt`) antes de guardarlo como `accessTokenEncrypted`.
- La respuesta de este endpoint **nunca** incluye `accessTokenEncrypted` ni el token plano.

## 7. Verificación de integración

```
GET /api/whatsapp-integrations/me
Authorization: Bearer <JWT_ADMIN>
```

Confirmar en la respuesta:
- [ ] `status` es `CONNECTED`.
- [ ] `phoneNumberId` coincide con el configurado en el paso anterior.
- [ ] `companyId` corresponde a la empresa del usuario autenticado.
- [ ] La respuesta **no** incluye `accessToken`.
- [ ] La respuesta **no** incluye `accessTokenEncrypted`.

## 8. Configuración de webhook en Meta

De forma general (la UI de Meta puede cambiar, así que esto es intencionalmente de alto nivel):

- Usar una URL pública de tu backend de staging (dominio real o túnel tipo ngrok apuntando a tu entorno, nunca a tu máquina de desarrollo sin exponer datos reales).
- Endpoint del webhook: `GET/POST /api/webhook`.
- En la configuración del webhook en el panel de Meta, usar el mismo valor de `WHATSAPP_VERIFY_TOKEN` configurado en tu entorno para completar el handshake (`GET /api/webhook`).
- Suscribirse a los eventos de mensajes (`messages`) del producto WhatsApp.
- No pegar el `WHATSAPP_VERIFY_TOKEN`, el `accessToken`, ni ningún otro secreto en esta documentación ni en el chat — configúralo directamente en el panel de Meta y en tu `.env` real.

## 9. Prueba inbound real

- [ ] Enviar un mensaje de WhatsApp desde un teléfono autorizado hacia el número de prueba/real configurado.
- [ ] Verificar en los logs del backend que se procesó el mensaje — los logs solo deben mostrar `phoneNumberId`, resultado (procesado/ignorado/duplicado) y el número de teléfono del remitente; **nunca** tokens.
- [ ] Confirmar que se creó (o reutilizó) el contacto, la conversación y el mensaje correspondientes en la base de staging.
- [ ] Confirmar que el `companyId` asociado a esos registros es el de la empresa correcta (la que conectó ese `phoneNumberId`).
- [ ] Confirmar que un `phoneNumberId` desconocido (no configurado en ninguna `WhatsAppIntegration`) no crea ningún dato — solo un log de advertencia.

## 10. Prueba outbound real

- [ ] Responder desde el endpoint existente de conversaciones (`POST /conversations/:id/send`) usando el JWT de un usuario de la empresa correspondiente.
- [ ] Confirmar que el mensaje llega al teléfono real.
- [ ] Confirmar que el envío usó la integración (`phoneNumberId`/token) de la empresa autenticada, no de otra.

Errores comunes a los que estar atento:
- Token inválido o expirado del lado de Meta.
- `phoneNumberId` incorrecto o mal copiado al conectar la integración.
- Número destino no habilitado para pruebas (en modo desarrollo, WhatsApp Cloud API solo permite enviar a números pre-autorizados).
- Permisos insuficientes de la app/token en Meta (falta el scope o el producto WhatsApp no está aprobado).
- Error de versión de la Graph API o respuesta de error de Meta con un formato distinto al esperado en los mocks de las pruebas automatizadas.

## 11. Prueba de desconexión

```
POST /api/whatsapp-integrations/me/disconnect
Authorization: Bearer <JWT_ADMIN>
```

- Este endpoint **solo** cambia `status` a `DISCONNECTED` y setea `disconnectedAt` en la base de datos local — **no revoca el token del lado de Meta**.
- Después de desconectar: un webhook entrante para ese `phoneNumberId` debe ser ignorado (mismo comportamiento que "integración no encontrada").
- Después de desconectar: un intento de outbound para esa empresa debe fallar con `WhatsApp no conectado para esta empresa`.

## 12. Riesgos conocidos

- Falta validar la firma `X-Hub-Signature-256` de los webhooks entrantes de Meta.
- `disconnect` no revoca el token en Meta, solo cambia el estado local.
- El `WHATSAPP_VERIFY_TOKEN` sigue siendo global (compartido entre todas las empresas), no por integración.
- No hay UI en el frontend todavía para conectar/desconectar WhatsApp.
- No hay mecanismo de rotación de `WHATSAPP_TOKEN_ENCRYPTION_KEY`.
- Los errores reales de Meta (formato, códigos, mensajes) pueden diferir de lo que asumen los mocks usados en las pruebas automatizadas — esta es, precisamente, la razón de ser de esta guía.

## 13. Criterios para considerar exitosa la prueba

- [ ] La migración de `WhatsAppIntegration` se aplicó correctamente en staging (`npx prisma migrate deploy` sin errores).
- [ ] La integración de la empresa de prueba quedó en `status: CONNECTED`.
- [ ] Un mensaje inbound real crea la conversación/contacto/mensaje correctos, asociados al `companyId` correcto.
- [ ] Un mensaje outbound real se entrega al teléfono de destino.
- [ ] `disconnect` funciona (cambia estado, no borra la fila) y bloquea inbound/outbound después de ejecutarse.
- [ ] Los logs de todo el proceso no exponen tokens en ningún momento.
- [ ] `npm test -- --runInBand`, `npm run test:e2e` y `npm run build` siguen pasando después de la prueba (nada se rompió).

## 14. Checklist final de comandos seguros

Estos comandos no exponen secretos y pueden correrse para verificar el estado del proyecto en cualquier momento:

```
git status
git log --oneline -8
npm test -- --runInBand
npm run test:e2e
npm run build
```

No incluyas en ningún script, log compartido o documento comandos que contengan `WHATSAPP_TOKEN_ENCRYPTION_KEY`, `WHATSAPP_VERIFY_TOKEN`, `accessToken` o cualquier valor real de Meta.
