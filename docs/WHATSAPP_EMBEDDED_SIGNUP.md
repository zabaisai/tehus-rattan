# WhatsApp Embedded Signup (Conectar con Meta)

Official Meta Embedded Signup onboarding for the Tehus Rattan CRM, replacing
manual Phone Number ID / Access Token / WABA ID entry as the primary way to
connect WhatsApp Business. Companion to [WHATSAPP_MULTI_TENANT.md](./WHATSAPP_MULTI_TENANT.md)
and [WEBHOOK_SECURITY.md](./WHATSAPP_REAL_TEST_CHECKLIST.md).

Verification of the number and all WhatsApp access happen **exclusively through
Meta's official mechanisms** — there is no home-grown OTP and no attempt to
bypass Meta authentication.

## Flow

1. An ADMIN/SUPER_ADMIN opens *Configuración → WhatsApp* and chooses:
   **"Conectar mi WhatsApp actual"** (the primary, Coexistence path) or
   **"Usar un número nuevo"** (standard Cloud API onboarding).
2. Frontend calls `POST /api/whatsapp-integrations/me/embedded-signup/start`.
   The backend mints a **single-use state** (32 random bytes; only its SHA-256
   hash is stored; short TTL) and returns **public** config only:
   `{ appId, configId, graphVersion, state, expiresAt }` — never the app secret.
3. Frontend loads Meta's official JS SDK (`connect.facebook.net/en_US/sdk.js`),
   calls `FB.login` with `config_id`, `response_type: 'code'`,
   `override_default_response_type: true` and `sessionInfoVersion: '3'`, and
   listens for the `WA_EMBEDDED_SIGNUP` window message. For the existing-number
   path it also sends Meta's official
   `featureType: 'whatsapp_business_app_onboarding'`. The login callback and
   session message are awaited independently because Meta does not guarantee
   their order.
4. On **FINISH**, the message yields `phone_number_id`, `waba_id`, `business_id`
   and `FB.login` returns a **30-second exchangeable code**.
5. Frontend posts `{ state, code, phoneNumberId, wabaId, businessId }` to
   `POST /api/whatsapp-integrations/me/embedded-signup/complete`.
6. Backend: validates & consumes the state → **exchanges the code server-side**
   for a customer business token → confirms the `phoneNumberId` belongs to the
   authorized WABA → enforces cross-company uniqueness → **subscribes the WABA
   to the app** → encrypts the token and persists the integration transactionally
   → audits. Returns a **safe** (token-free, phone-masked) status.
7. Frontend shows staged progress and the connected view.

Works for SUPER_ADMIN and ADMIN. AGENT cannot connect. `companyId` is always
taken from the JWT, never from the request.

## Connection states

`NOT_CONNECTED` → `CONNECTING` → `CONNECTED` → `REAUTH_REQUIRED` → `DISCONNECTED`
→ `REVOKED` → `ERROR`. `NOT_CONNECTED`/`CONNECTING` are derived (no row / active
state); the rest are persisted on `WhatsAppIntegration.status`.

## Endpoints

| Method / path | Auth | Purpose |
| --- | --- | --- |
| `POST /api/whatsapp-integrations/me/embedded-signup/start` | ADMIN/SUPER_ADMIN | Mint state + return public SDK config. Per-IP throttled. |
| `POST /api/whatsapp-integrations/me/embedded-signup/complete` | ADMIN/SUPER_ADMIN | Finish: exchange code, validate, subscribe, persist. |
| `GET /api/whatsapp-integrations/me/connection-status` | ADMIN/SUPER_ADMIN | Safe snapshot: `status`, `connectionMethod`, `coexistence`, masked phone, `businessName`, `connectedAt`, `lastCheckedAt`, `webhookStatus`, `actionRequired`, sanitized `errorCode`. No token, no WABA. |
| `POST /api/whatsapp-integrations/me/reconnect` | ADMIN/SUPER_ADMIN | Mint a new state to re-run signup. **Cancel-safe**: the current integration is left CONNECTED until a new `complete` succeeds. |
| `POST /api/whatsapp-integrations/me/test` | ADMIN/SUPER_ADMIN | Send one E.164-validated test text via the connected integration (rate-limited, audited). Works only inside Meta's 24h window. |
| `POST /api/whatsapp-integrations/me/disconnect` | ADMIN/SUPER_ADMIN | **Local-only** disconnect (does NOT revoke on Meta / deregister the number). |
| `PUT /api/whatsapp-integrations/me` | **SUPER_ADMIN only** | Legacy manual connect (advanced fallback). |

No endpoint ever returns the access token (plaintext or encrypted).

## Environment

Opt-in via `WHATSAPP_EMBEDDED_SIGNUP_ENABLED=true`. When enabled the following
are **required and validated at boot**:

| Variable | Secret | Notes |
| --- | --- | --- |
| `WHATSAPP_APP_ID` | no | Meta App ID (`client_id` for the code exchange). |
| `WHATSAPP_CONFIG_ID` | no | Embedded Signup configuration id. |
| `WHATSAPP_APP_SECRET` | **yes** | `client_secret` for the exchange (reuses the webhook HMAC secret). Never in the browser. |
| `WHATSAPP_GRAPH_API_VERSION` | no | e.g. `v25.0` — verify a currently supported version in Meta's docs. |
| `WHATSAPP_EMBEDDED_SIGNUP_STATE_TTL_MINUTES` | no | State lifetime, default 10. |
| `THROTTLE_WHATSAPP_SIGNUP_LIMIT` | no | Per-IP limit, default 20. |
| `NEXT_PUBLIC_WHATSAPP_APP_ID` / `NEXT_PUBLIC_WHATSAPP_CONFIG_ID` | no (public) | Frontend **build-time** args; inlined into the bundle. Must match the backend app/config ids. Also gate the CSP relaxation for Meta's SDK. |

## Meta app setup (Tech Provider) — runbook

Do this in your own Meta account/console; never paste secrets into chat, commits,
docs, or screenshots.

1. Create/choose a **Meta app** (type: Business). Add the **WhatsApp** and
   **Facebook Login for Business** products.
2. Create a **Facebook Login for Business / Embedded Signup v4**
   configuration, select only the WhatsApp products TAKTO needs, and note its
   **configuration id**. Do not reuse an obsolete v2/v3 configuration.
3. Request the permissions **`whatsapp_business_management`** and
   **`whatsapp_business_messaging`** on the app (App Review as required).
4. Copy the **App ID** and **App Secret** (Settings → Basic).
5. Add the CRM's frontend origin to the app's allowed domains for the JS SDK.
6. Fill `WHATSAPP_APP_ID`, `WHATSAPP_CONFIG_ID`, `WHATSAPP_APP_SECRET`,
   `WHATSAPP_GRAPH_API_VERSION` in the backend env and the two `NEXT_PUBLIC_*`
   build args, then set `WHATSAPP_EMBEDDED_SIGNUP_ENABLED=true`.
7. Ensure the webhook is configured (`WHATSAPP_WEBHOOK_ENABLED=true`,
   `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`) — the flow subscribes each
   customer WABA to this app so inbound messages are delivered.

### CSP note
Meta's SDK requires the app's CSP to allow `https://connect.facebook.net`
(script), `https://www.facebook.com` (frame) and `https://graph.facebook.com`
+ `https://www.facebook.com` (connect). This is added **only** when
`NEXT_PUBLIC_WHATSAPP_APP_ID` is set at build time; otherwise the CSP stays
fully locked down. No app secret is ever exposed to the browser.

## Security

- **State**: high-entropy (`crypto.randomBytes(32)`), stored only as a SHA-256
  hash, **single-use** (atomic compare-and-swap), short TTL, bound to the
  company + issuing user. Consumed **before** the persist transaction so it can
  never be replayed even if a later step fails. This is the anti-CSRF / anti-
  replay control. (Meta's Embedded Signup does not offer PKCE for this flow;
  the equivalent protection is this state + the server-side secret exchange.)
- **Code → token exchange** happens **only in the backend**; the browser never
  sees the token. Tokens are stored **encrypted** (AES-256-GCM, per
  [WHATSAPP_MULTI_TENANT.md](./WHATSAPP_MULTI_TENANT.md)) and never returned.
- **Scopes** are minimal (`whatsapp_business_management`,
  `whatsapp_business_messaging`) via the Embedded Signup configuration.
- **Multi-tenant isolation**: `companyId` from JWT only; `phoneNumberId` is
  globally unique and a second company connecting the same number gets **409**.
- **Idempotency**: state is single-use; the integration upsert is keyed on the
  globally unique `phoneNumberId`; subscribing the WABA is idempotent on
  Meta's side.
- **Timeouts** on every Meta call; **redacted logs** (never the code, token, or
  Meta payload — only a non-secret error classifier); **generic** user-facing
  errors.
- **Audit** (no secrets): `WHATSAPP_SIGNUP_STARTED`, `WHATSAPP_SIGNUP_COMPLETED`,
  `WHATSAPP_SIGNUP_FAILED`, `WHATSAPP_RECONNECTED`,
  `WHATSAPP_DISCONNECTED_LOCAL`, `WHATSAPP_CONNECTION_TESTED`.

## New vs migrated vs Coexistence numbers

- **New Cloud API number**: created inside Embedded Signup. Subscribed to the
  app; registration for Cloud API (with the customer's 2FA PIN) is a separate,
  explicitly-confirmed step — the automatic flow does **not** register.
- **Migrated number**: moving from another BSP/on-prem. Requires the migration
  flow and registration; **always warn the user first**.
- **Coexistence** (number already live in the WhatsApp Business app): requested
  explicitly through Meta's `whatsapp_business_app_onboarding` flow and
  confirmed server-side with Meta's official `is_on_biz_app` phone-number
  field (with `platform_type` only as a compatibility fallback). The flow
  **only** subscribes the WABA and stores the token — it **never registers,
  migrates or deregisters** the number, so an eligible number keeps working in
  the Business app. Do not promise Coexistence when Meta does not offer it for
  the customer's account, number or country.

  **Coexistence limitations:** verification and any QR/code confirmation are
  rendered and controlled by Meta, not by TAKTO. Eligibility, history sync,
  supported message types and the exact wording shown inside WhatsApp can
  change by account, app version, country and Meta policy. TAKTO must show
  only conditional language until a real-number test confirms the behavior.

## Customer experience (Kommo-style)

The customer never pastes an access token, WABA id, app secret or system-user
credential into TAKTO. The intended flow is:

1. Click **Conectar mi WhatsApp actual**.
2. Complete Meta's own authentication.
3. Enter/select the existing WhatsApp Business number.
4. Confirm the connection using the method Meta presents (for example a
   confirmation in the Business app, QR, SMS or voice code depending on the
   flow and eligibility).
5. Return automatically to TAKTO with the number connected and the webhook
   subscribed.

TAKTO must not implement or send its own phone-verification OTP. The notice a
person may see in WhatsApp saying that a number is associated with a Meta
business/platform service is also rendered by Meta/WhatsApp; TAKTO cannot force
its exact text.

The TAKTO operator configures one provider app globally. Each customer then
authorizes their own WABA and customer-scoped token. Tokens are encrypted per
tenant, incoming webhooks are routed by the globally unique `phone_number_id`,
and no customer needs operator assistance for routine onboarding.

## Meta production gate (human/external)

Code readiness alone does not make this available to arbitrary customer
companies. Before enabling the feature in production, the TAKTO operator must:

- complete Meta business verification and Tech Provider onboarding;
- obtain Advanced Access/App Review approval for
  `whatsapp_business_management` and `whatsapp_business_messaging`;
- create the current Embedded Signup v4 configuration with WhatsApp Business
  app onboarding/Coexistence enabled;
- configure the production HTTPS domain and webhook callback in Meta;
- place the App ID, configuration ID and App Secret in the deployment secret
  store (never Git), then rebuild the frontend with the matching public ids;
- validate one eligible existing Business app number and one new test number
  end to end before making the feature generally available.

## Disconnect semantics

- **Desconectar (local)**: `POST /me/disconnect` flips status to `DISCONNECTED`
  in the CRM only. It does **not** revoke access on Meta and does **not**
  deregister the number. Inbound for that number is then ignored and outbound
  fails until reconnected.
- To fully revoke, remove the app's access from the customer's WABA in Meta
  (Business settings) — this is an explicit action taken in Meta, never silently
  by the CRM.

## Reconnect / rotation

Use **Reconectar** (`POST /me/reconnect`) when the token is invalid/expired
(status `REAUTH_REQUIRED`) or after rotating `WHATSAPP_APP_SECRET`. It re-runs
Embedded Signup and replaces the stored token. Note: rotating
`WHATSAPP_TOKEN_ENCRYPTION_KEY` makes all stored tokens undecryptable — every
company must reconnect, so plan/announce it.

## Rollback

- Feature flag: set `WHATSAPP_EMBEDDED_SIGNUP_ENABLED=false` to disable the flow
  (the endpoints return a controlled 503); the SUPER_ADMIN manual connection and
  all existing webhook/outbound behavior keep working.
- Code: `deploy/scripts/rollback-code.sh <previous_sha>`; the migration is purely
  additive (new table + nullable columns + new enum values), so a code rollback
  does not require a DB restore. If you must revert the schema, drop the new
  table/columns in a follow-up migration (existing rows are unaffected).

## Local testing

Automated tests mock the Meta client entirely — **no real Meta calls** and only
**fictitious** WABA/phone ids (`test/whatsapp-embedded-signup.e2e-spec.ts` and
the unit specs). For a real end-to-end test with a live number, follow
[WHATSAPP_REAL_TEST_CHECKLIST.md](./WHATSAPP_REAL_TEST_CHECKLIST.md); never write
a real number or token into fixtures, commits, or docs.
