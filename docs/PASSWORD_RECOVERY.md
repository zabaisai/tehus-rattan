# Password recovery

Secure, multi-tenant password recovery for the TAKTO CRM. Companion to
[AUTH_SESSION_SECURITY.md](./AUTH_SESSION_SECURITY.md) and
[SECURITY_HEADERS.md](./SECURITY_HEADERS.md).

## Flow

1. `/login` shows a **"¿Olvidaste tu contraseña?"** link → `/forgot-password`.
2. The user submits their email. The API **always** replies with the same
   generic message (anti-enumeration).
3. If the account exists, is active, and can log in, a token is generated and a
   reset link is emailed.
4. The user opens `/reset-password?token=…`, chooses a new password (confirmed).
5. The backend validates the token and changes the password **atomically**; the
   token is consumed (single-use) and every session/refresh token is revoked.
6. The reset event is audited; the user is redirected to `/login` with a success
   message.

Works for SUPER_ADMIN, ADMIN, and AGENT. The role is never chosen in the form —
the account is resolved server-side by normalized email (`User.email` is globally
`@unique`, so there is no cross-company ambiguity).

## Endpoints

| Method / path | Auth | Purpose |
| --- | --- | --- |
| `POST /api/auth/forgot-password` | public | Request a reset email. Generic reply. Origin/CSRF-guarded, per-IP throttled. |
| `POST /api/auth/reset-password` | public | `{token, password, passwordConfirmation}` → change password. Same guards. |
| `POST /api/platform/users/:userId/send-password-reset` | SUPER_ADMIN (PlatformGuard) | Send a reset for any active user. |
| `POST /api/users/:userId/send-password-reset` | ADMIN (BusinessTenantGuard + Roles) | Send a reset for an AGENT of the admin's OWN company. |

Admin sends never return or reveal the token/link; the admin cannot choose the
new password. The user always sets their own via the emailed link.

## Permissions (enforced in the backend, not just the UI)

- **Self-service**: anyone can recover only their OWN account via the public
  endpoint (no `role`/`companyId` accepted from the client).
- **SUPER_ADMIN**: may send a reset for any active user.
- **ADMIN**: may send a reset only for an **AGENT of their own company**. A
  cross-company target → **404** (existence hidden); a same-company non-agent
  (e.g. another ADMIN) → **403**; an inactive/suspended target → **404**.
- **AGENT**: no admin endpoints (`/users/...` → 403, `/platform/...` → 403).

## Token policy

- 32 random bytes (`crypto.randomBytes`), hex. Only its **SHA-256 hash** is
  stored (`PasswordResetToken.tokenHash`, `@unique`) — the plaintext lives only
  in the emailed link and is never persisted, logged, or returned by the API.
- **Single-use**: consumed via an atomic compare-and-swap
  (`updateMany ... usedAt=null → count===1`), so two concurrent requests with
  the same token can never change the password twice.
- **Expiry**: configurable, default **15 minutes** (`PASSWORD_RESET_TOKEN_TTL_MINUTES`).
- Issuing a new token **invalidates the user's prior active tokens**.
- A per-account **resend cooldown** (60s) suppresses email-bombing.
- Rejected — with the same generic error — when expired, used, revoked,
  non-existent, or malformed. No Prisma/SMTP/token detail is ever leaked.

## Password policy

Centralized in `apps/backend/src/common/password/password-policy.ts` and reused
by account creation (register / create-user / onboarding) AND recovery: **≥ 10
characters with lower, upper, digit, and a special char**. The new password must
also differ from the current one. The frontend mirrors the rules for a live
requirements checklist (`src/lib/password-policy.ts`); the backend is the
enforcing authority.

## Session revocation

On a successful reset, `SessionsService.revokeAllActiveForUser` runs in the same
transaction, flipping every ACTIVE session to REVOKED. Because `JwtStrategy`
checks the session status on every request, any existing access token is
rejected immediately and no old refresh token can rotate.

## Email

`MailService` (nodemailer, provider-agnostic) sends only when
`PASSWORD_RESET_ENABLED=true` and SMTP is configured; otherwise it is a
controlled no-op that **never logs the token, URL, or recipient**. A send failure
throws so the caller **compensates** (revokes the just-issued token) while the
public endpoint keeps its generic reply. The email (Spanish) contains only the
name, a reset button, the 15-minute/single-use notice, and an
ignore-if-not-requested line — never the password or any other company's data.

## Throttling

Per-IP on both public endpoints (`THROTTLE_PASSWORD_RESET_LIMIT`, default 5 per
`THROTTLE_TTL`), plus the per-account resend cooldown above. Deliberately NOT
device-bucketed (credential-sensitive).

## Audit

Reuses the existing `AuditLog`. Recorded actions (no token/password/URL ever
stored): `PASSWORD_RESET_REQUESTED`, `PASSWORD_RESET_COMPLETED`,
`SESSIONS_REVOKED_AFTER_PASSWORD_RESET`, `PASSWORD_RESET_SENT_BY_SUPER_ADMIN`,
`PASSWORD_RESET_SENT_BY_ADMIN`. The IP stored is the anonymized (truncated)
preview, consistent with sessions.

## Frontend security

The recovery pages are public top-level routes (`/forgot-password`,
`/reset-password`), `noindex`. The token is read from the URL into memory once
and immediately stripped with `history.replaceState`, so it never lingers in the
address bar, history, logs, or analytics — and is never written to
localStorage/sessionStorage. The access JWT remains in memory only.

## Environment

See `.env.example` / `deploy/env/staging.env.example`:
`PASSWORD_RESET_ENABLED`, `SMTP_HOST/PORT/SECURE/USER/PASSWORD`,
`SMTP_FROM_EMAIL/NAME`, `PASSWORD_RESET_URL` (absolute — the link is built only
from this), `PASSWORD_RESET_TOKEN_TTL_MINUTES`, `THROTTLE_PASSWORD_RESET_LIMIT`.
When enabled, the SMTP settings + reset URL are validated at startup. **Staging
must run `NODE_ENV=production`** (for `Secure` cookies) and set a real SMTP
provider before enabling. Never commit real SMTP credentials.

## Local testing

Automated tests use a mock mailer and never call SMTP
(`test/password-recovery.e2e-spec.ts`, unit specs for the policy and the mailer).
For manual QA with `PASSWORD_RESET_ENABLED` unset, the email is a no-op — read
the token from the `password_reset_tokens` table (its hash) or capture the
`resetUrl` via a local outbox; never send real email during testing.
