# Notification center

Multi-tenant, per-user in-app notifications for SUPER_ADMIN, ADMIN and AGENT.
Companion to [WHATSAPP_EMBEDDED_SIGNUP.md](./WHATSAPP_EMBEDDED_SIGNUP.md).

## What it does

A header bell shows a live unread badge; a dropdown lists recent items; a full
page (`/dashboard/notifications`) lists/filters everything; a preferences page
(`/dashboard/settings/notifications`) controls in-app + email per category.
Notifications are generated automatically from real business events.

## Isolation & privacy (enforced in the backend)

- Every read/write is scoped to the JWT: `recipientUserId = req.user.sub`,
  `companyId = req.user.companyId`. A user can only ever see or mutate **their
  own** notifications — never another user's or another company's.
- Notifications **never** store secrets, tokens, passwords, full WhatsApp
  message bodies, full phone numbers, sessions or full IPs — only a title, a
  short sanitized preview and minimal metadata.
- `SUPER_ADMIN` does not bypass tenant isolation; platform events are scoped to
  the affected company (a company-less platform super-admin sees an empty list —
  a documented limitation; a platform-scoped variant is future work).

## Data model

- **`Notification`** — `companyId`, `recipientUserId`, `actorUserId?`, `type`,
  `category`, `priority`, `title`, `bodyPreview?`, `entityType?`, `entityId?`,
  `actionUrl?`, `metadata?`, `dedupeKey?` (unique — collapses bursts), `readAt?`,
  `expiresAt?`, `createdAt`. Indexed by recipient/company/read/created.
- **`NotificationPreference`** — unique `(userId, category)`, `inAppEnabled`,
  `emailEnabled`. Defaults applied in code when a row is absent (in-app on;
  email off except SECURITY/WHATSAPP), so new users need no seeding.

Migration `20260727225339_add_notifications` is fully additive.

## Categories & types

Categories: `CONVERSATION, MESSAGE, CONTACT, LEAD, TASK, QUOTE, WHATSAPP,
SECURITY, PLATFORM, SYSTEM`. Each `type` maps to a category + default priority
(see `notification-types.ts`).

Wired to real producers today:

| Type | Producer | Recipient |
| --- | --- | --- |
| `WHATSAPP_CONNECTED` / `_CONNECTION_FAILED` / `_DISCONNECTED` | Embedded Signup service | company ADMIN/SUPER_ADMIN |
| `NEW_INBOUND_MESSAGE` | webhook service | assigned agent (short preview, deduped 5-min buckets) |
| `TASK_DUE_SOON` / `TASK_OVERDUE` | hourly scheduler | task assignee (single-shot per task) |

Other types in the catalog (`LEAD_ASSIGNED`, `QUOTE_*`, `SESSION_REVOKED`,
`COMPANY_STATUS_CHANGED`, …) are defined and ready; wiring their producers is a
documented follow-up (each needs a clean recipient-resolution hook in the owning
module). No type is emitted without a real consumer.

## Endpoints (all authenticated; recipient/company from JWT)

| Method / path | Purpose |
| --- | --- |
| `GET /api/notifications` | Cursor-paginated list; filters `unread`, `category`, `priority` (DTO-whitelisted). |
| `GET /api/notifications/unread-count` | `{ count }`. |
| `POST /api/notifications/:id/read` | Mark one read — only if owned. |
| `POST /api/notifications/read-all` | Mark all own read. |
| `GET /api/notifications/preferences` | Every category merged with defaults. |
| `PUT /api/notifications/preferences` | Upsert preferences (whitelisted). |

## Email

Best-effort, out of band, and **SMTP-gated** (a controlled no-op when SMTP is
not configured — never breaks the triggering operation). Only categories in the
email-eligible set (SECURITY, WHATSAPP, TASK) can ever email, and only when the
user's preference is on and their account + company are active. Emails are
sanitized, carry only an absolute-http(s) action link (no open redirect), and
never include another company's data. Defaults keep email OFF except SECURITY
and WHATSAPP. Tests use a mocked mailer — **no real email is ever sent in tests**.

## Real-time strategy

First version uses authenticated **polling** (unread count every 30s +
refetch-on-window-focus, plus cache invalidation after actions) via TanStack
Query — simple and reliable for a single staging instance. WebSocket/SSE can be
added later when there is a real need; the service interface does not change.

## Scheduling & retention

An hourly `@Cron` emits single-shot `TASK_DUE_SOON`/`TASK_OVERDUE` (idempotent
via `dedupeKey`, so re-runs are no-ops); "due soon" = within
`DUE_SOON_WINDOW_HOURS` (24h). A daily job prunes **read** notifications older
than `READ_RETENTION_DAYS` (60) and expired ones — **audit logs are never
touched** (notifications ≠ audit). Single-instance on staging; multi-instance
would need a leader-elected job or durable queue (documented, not built).

## Resilience

Notification creation is best-effort for out-of-band emission (`emit` /
`emitToCompanyRoles` never throw) so a notification failure can never break the
event that triggered it. When atomicity matters, `create(input, tx)` accepts a
transaction client to write the notification in the same transaction as the
event.

## Tests

Backend: service (create/dedupe/preferences/email-eligibility, mark own-only,
cursor list, fan-out), scheduler (single-shot, retention), and e2e (auth,
per-user/company isolation, mark-read own-only, unread-count, preferences, DTO
whitelist). Frontend: bell (badge/99+/dropdown/mark/navigate/empty),
preferences page, header. No test sends real email or calls Meta.
