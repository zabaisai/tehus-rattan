# Seguridad de webhook de WhatsApp y rate limiting

Fase 2A de preparación para staging. Endurece los endpoints públicos y valida
la autenticidad de los webhooks de Meta. No cambia el comportamiento de los
endpoints autenticados.

## 1. Firma X-Hub-Signature-256

Meta firma cada `POST` del webhook con el header
`X-Hub-Signature-256: sha256=<hmac_hex>`, donde `<hmac_hex>` es el
**HMAC-SHA256 del cuerpo crudo exacto** (los bytes recibidos, no un JSON
reserializado) usando el **App Secret** de la app de Meta como clave.

Validación (`WhatsAppSignatureGuard`, aplicado solo al `POST /api/webhook`):

1. Se preserva el cuerpo crudo con `NestFactory.create(AppModule, { rawBody: true })`
   (soporte nativo de Nest — sin middleware casero); el guard lee `req.rawBody`.
2. Calcula `HMAC-SHA256(rawBody, WHATSAPP_APP_SECRET)`.
3. Compara contra el header con `crypto.timingSafeEqual` (resistente a timing).
4. Valida formato y longitud antes de comparar: el header debe cumplir
   `^sha256=[0-9a-f]{64}$`.
5. Rechaza (sin procesar) si el header falta, tiene otro algoritmo, hex
   inválido, longitud incorrecta, firma vacía, secret incorrecto o cuerpo
   alterado. `processWebhook` **nunca** se ejecuta si la firma falla.
6. Fail-closed: si falta `WHATSAPP_APP_SECRET`, el POST se rechaza con `503`
   (nunca procesa payloads sin verificar).

La firma usa el **App Secret de la app de Meta**, no el access token de cada
empresa ni el verify token.

### Diferencia entre los tres secretos

| Secreto | Para qué | Dónde |
| --- | --- | --- |
| **App Secret** (`WHATSAPP_APP_SECRET`) | Verificar la firma HMAC de los POST del webhook | App Dashboard > Settings > Basic |
| **Verify token** (`WHATSAPP_VERIFY_TOKEN`) | Handshake de alta del webhook (`GET`), compara `hub.verify_token` | Lo eliges tú y lo configuras en Meta |
| **Access token** (por empresa, cifrado) | Enviar mensajes salientes (`WhatsappService`) | `WhatsAppIntegration.accessTokenEncrypted` |

## 2. Variables de entorno nuevas

| Variable | Descripción |
| --- | --- |
| `WHATSAPP_WEBHOOK_ENABLED` | `"true"` exige `WHATSAPP_APP_SECRET` + `WHATSAPP_VERIFY_TOKEN` al arrancar (falla claro si faltan). Por defecto no habilitado. |
| `WHATSAPP_APP_SECRET` | App Secret de Meta para la firma. Sin él, el POST del webhook se rechaza (503). |
| `WHATSAPP_GRAPH_API_VERSION` | Versión de Graph API para envíos salientes (formato `v<major>.<minor>`). Default `v19.0` (última verificada; ajústala a la versión que valides con Meta). Reemplaza el valor antes hardcodeado. |
| `THROTTLE_TTL` | Ventana de rate limiting en ms (default 60000). |
| `THROTTLE_DEFAULT_LIMIT` | Límite global generoso (default 300). |
| `THROTTLE_AUTH_LIMIT` | Login (default 10). |
| `THROTTLE_REFRESH_LIMIT` | Refresh (default 30). |
| `THROTTLE_ONBOARDING_LIMIT` | Onboarding + register legacy (default 15). |
| `THROTTLE_WEBHOOK_LIMIT` | POST del webhook (default 600). |
| `THROTTLE_WEBHOOK_VERIFY_LIMIT` | GET verify del webhook (default 30). |

`WHATSAPP_VERIFY_TOKEN` ya existía. Ver `.env.example` y
`deploy/env/staging.env.example`. Ningún ejemplo contiene secretos reales.

## 3. Configuración local vs staging

- **Local:** `WHATSAPP_WEBHOOK_ENABLED=false`. El webhook queda fail-closed
  (503) hasta que configures el App Secret; el resto de la app funciona sin
  WhatsApp. Los tests usan valores ficticios, nunca `.env`.
- **Staging:** `WHATSAPP_WEBHOOK_ENABLED=true` con `WHATSAPP_APP_SECRET` y
  `WHATSAPP_VERIFY_TOKEN` reales (solo en el `.env.staging` con `chmod 600`,
  nunca en git). Detrás de Caddy (`trust proxy = 1`), el rate limiting se aplica
  por IP real reenviada en `X-Forwarded-For`.

## 4. Rate limiting

`@nestjs/throttler` con `ThrottlerGuard` global. Cada ruta ajusta o exime el
límite con `@Throttle` / `@SkipThrottle`.

| Endpoint | Límite (default staging) |
| --- | --- |
| `POST /api/auth/login` | 10 / 60s (estricto: fuerza bruta) |
| `POST /api/auth/refresh` | 30 / 60s |
| `POST /api/onboarding/company`, `POST /api/auth/register` | 15 / 60s (fuerza bruta de códigos de invitación) |
| `POST /api/webhook` | 600 / 60s (alto: ráfagas legítimas de Meta) |
| `GET /api/webhook` (verify) | 30 / 60s |
| `GET /api/health`, `GET /api/` | exentos (`@SkipThrottle`) |
| Resto de endpoints autenticados | 300 / 60s (default generoso, no se inutilizan) |

Al superar el límite: `429 Too Many Requests` con header `Retry-After`.
Limitación conocida: el store es en memoria (por instancia). Para varias
instancias, migrar a un store compartido (p. ej. Redis) — pendiente.

## 5. Endpoints y respuestas

- `401 Unauthorized` — firma de webhook inválida/ausente (o token JWT inválido
  en rutas autenticadas).
- `403 Forbidden` — verify token incorrecto en el `GET` del webhook; o
  `BusinessTenantGuard` en rutas de empresa.
- `429 Too Many Requests` — límite de rate excedido (con `Retry-After`).
- `503 Service Unavailable` — webhook habilitado pero `WHATSAPP_APP_SECRET`
  ausente (fail-closed).

## 6. Cómo probar con una firma ficticia (sin Meta real)

```bash
SECRET="fake-secret"
BODY='{"entry":[{"changes":[{"value":{"messages":[]}}]}]}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')"
curl -sS -X POST http://localhost:3001/api/webhook \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: $SIG" \
  --data "$BODY"
```
Con `WHATSAPP_APP_SECRET=fake-secret`, una firma válida → `200 OK`; cualquier
alteración del cuerpo o del secret → `401`. Los tests e2e
(`test/webhook-signature.e2e-spec.ts`) cubren estos casos con mocks, sin llamar
a Meta.

## 7. Qué NUNCA se registra

Ni el App Secret, ni la firma completa, ni access tokens, ni el contenido
completo de los mensajes. Los logs del webhook solo registran `phoneNumberId`,
el resultado (procesado / ignorado / duplicado) y el tipo de mensaje omitido.

## 8. Robustez del procesamiento de webhook

`processWebhook` recorre **todos** los `entry[] → changes[] → messages[]` (no
solo `[0]`). Payloads sin mensajes (estados de entrega, otros eventos) se
ignoran de forma segura. Cada mensaje se deduplica por `wamid` y se procesa de
forma aislada (un fallo no descarta el resto del lote); un mensaje que falla
antes de persistirse no queda marcado como procesado (Meta puede reintentarlo).

## 9. Tipos de mensaje no soportados aún

Solo se persiste **texto**. Otros tipos (imagen, audio, video, documento,
sticker, ubicación, interactivos, plantillas) se reconocen y se omiten con un
log del tipo — no fallan.

## 10. Pendientes (fases siguientes)

- Multimedia entrante (imagen/audio/video/documento) y su descarga segura.
- Estados de entrega/lectura (`value.statuses`) → actualizar `Message.status`.
- Plantillas (envío saliente con plantillas aprobadas).
- Store de rate limiting compartido (Redis) para múltiples instancias.
- Protección de `/uploads/*` (hoy estáticos y enumerables, sin auth).
- Verify token del `GET` con comparación de tiempo constante (hoy `===`).
- Embedded Signup / OAuth real de Meta.
