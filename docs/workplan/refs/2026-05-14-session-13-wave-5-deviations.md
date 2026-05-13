# Session 13 — Wave 5 Deviation Pack

**Date opened:** 2026-05-14
**Status:** open — appended as Wave 5 phases land.

This document records intentional deviations between the Wave 5
INDEX/spec and the SQL/code that actually landed on staging
`ikcyvlovptebroadgtvd` and in the repo. Each entry covers cause +
resolution + verification, mirroring the Wave 1 / Wave 2 / Wave 3 /
Wave 4 deviation packs.

---

## Phase 5.B — Notifications pipeline (MVP email-only)

### D-W5-5B-01 — Provider = Resend (HTTP API), Sendgrid swap = one-file edit

**INDEX spec says:** "Sendgrid OR Resend integration". The decision-pack
§D5 leaves the choice open between "Sendgrid" and "Resend-as-SMTP-relay".

**What landed:** `supabase/functions/_shared/email-provider.ts` calls
the **Resend REST API** (`POST https://api.resend.com/emails`) when
`RESEND_API_KEY` is set and starts with `re_` (but not `re_test_`).

#### Cause

Resend offers (a) a single env var (`RESEND_API_KEY`), (b) no domain
verification needed for the sandbox `onboarding@resend.dev` sender —
critical for unblocking smoke tests on staging without DNS gymnastics,
(c) 3 000 free emails / month, sufficient for MVP volume, (d) an
identical JSON contract to Sendgrid (`{from, to, subject, text}`).
Swapping later means editing one file (`email-provider.ts`) plus
renaming one env var.

#### Resolution

Provider lives in `_shared/email-provider.ts`. EF
`notification-dispatch` imports the exported `sendEmail()` and never
references `Resend` by name. Future Sendgrid migration = one PR.

#### Verification

- `RESEND_API_KEY` unset on staging → EF runs in **console mode**
  (logs JSON to stdout). Smoke verified via batch RPC + state
  transitions.
- Live Resend mode covered by code path but not exercised on staging
  yet (no production API key seeded). Production rollout will set the
  key via Supabase dashboard secrets.

---

### D-W5-5B-02 — No `pg_cron` schedule in this phase

**INDEX spec says:** "cron schedule (pg_cron) to invoke EF every 1 min".

**What landed:** No `cron.schedule(...)` call. The EF accepts a
`?secret=<NOTIFICATION_DISPATCH_SECRET>` query param as an alternative
to a Bearer JWT, so an external scheduler (Vercel Cron, GitHub Action,
manual `curl`) can hit it without a user session.

#### Cause

`pg_cron`'s `cron` schema is owned by the `postgres` superuser. Even
with `pg_net` available, calling `cron.schedule(...)` from MCP
`apply_migration` runs as the migration role which doesn't have
`USAGE ON SCHEMA cron`. Granting that role-wide is a security smell on
a shared cloud project, and rolling per-migration GRANTs would leave
permission drift behind.

#### Resolution

The EF supports two auth pathways:
1. **Bearer JWT** for app-side manual flushes (manager+ via
   `has_permission('notifications.send')`).
2. **`?secret=`** query param for scheduled invocations. If
   `NOTIFICATION_DISPATCH_SECRET` env var is unset, this pathway is
   disabled (Bearer-only).

The scheduler choice is deferred to Phase 7 (production-readiness).
Vercel Cron + a thin curl-style trigger is the most likely v1
production wiring.

#### Verification

- HTTP smoke from staging: no auth → 401 `missing_authorization`. Anon
  JWT → 401 `invalid_token`. Confirmed both gates.

---

### D-W5-5B-03 — Local-dev mock = console.log, NO sidecar JSON file

**INDEX spec says:** "For local dev: writes to console + a
`notifications-dev-outbox.json` file."

**What landed:** Console mode only. No file IO from the EF runtime.

#### Cause

Deno's EF sandbox has no write permission to the repo root.
`Deno.writeTextFile('/notifications-dev-outbox.json', ...)` would
either be a no-op (silent permission denied) or write to a sandbox
`/tmp` directory the developer never sees. The real dev experience is
`supabase functions logs notification-dispatch` (or the cloud
dashboard log viewer), which shows the `console.log(JSON.stringify(...))`
output we emit in console mode.

#### Resolution

`sendEmail()` returns `{ ok: true, providerMessageId: 'console-<uuid>',
mode: 'console' }` when `RESEND_API_KEY` is unset OR starts with
`re_test_`. Logs include `to`, `from`, `subject`, and a 200-char body
preview. Tests assert on the return shape, not on file IO.

#### Verification

Domain unit tests (22 cases, 100% coverage on the compose/decide
functions). EF batch RPC smoke + state transition asserted via SQL.

---

### D-W5-5B-04 — `decideChannels` simple v1 (no customer-prefs columns yet)

**INDEX spec says:** "decide channels to send" given customer prefs.

**What landed:** `decideChannels(templateChannel, prefs)` where `prefs`
is an optional `{ optOutEmail?: boolean; optOutSms?: boolean; ... }`
struct. Empty object `{}` = no preferences captured yet.

#### Cause

`customers` table v3 does NOT have `notification_opt_out_email` /
`notification_opt_out_sms` / `notification_opt_out_push` columns yet.
Adding them is Phase 5.C's responsibility (settings UI for customer
prefs). We don't want 5.B to dictate the column shape that 5.C will
ship.

#### Resolution

`decideChannels` v1 takes the flags struct directly. Caller passes
`{}` for now. When 5.C migrates the columns onto `customers`, the
caller will populate the struct from the row.

Future v2 (Phase 6+) may broadcast across multiple channels for
high-priority templates (the function already returns an array).

#### Verification

9 unit tests cover happy path, all-channels opt-out, partial opt-out,
default (no flag = opted-in), explicit false (also opted-in).

---

### D-W5-5B-05 — Permission `notifications.send` = manager+ (3 role grants)

**INDEX spec says:** "Permission `notifications.send` (manager+)".

**What landed:** One permission row + three `role_permissions` grants
(`MANAGER`, `ADMIN`, `SUPER_ADMIN`).

#### Cause / Resolution

Per CLAUDE.md, we never re-CREATE `has_permission()`. SUPER_ADMIN
already inherits through the unconditional branch from Wave 1, but we
include the explicit grant for completeness so the role's permissions
read identically to the table data.

The `notifications.send` code is added to the static `PermissionCode`
union in `packages/supabase/src/rls/permissions.ts` so the client-side
UI gates pick it up.

#### Verification

- SQL: `(SELECT COUNT(*) FROM permissions WHERE code='notifications.send')` = 1
- SQL: `(SELECT COUNT(*) FROM role_permissions WHERE permission_code='notifications.send')` = 3
- Cashier RPC call → `42501 permission_denied` (pgTAP T_NOTIF_04 +
  manual verification).

---

### D-W5-5B-06 — `enqueue_notification_v1` returns UUID, not void

**INDEX spec says:** "RPC `enqueue_notification_v1(...) RETURNS UUID`".
(Matches.)

**What landed:** Returns the outbox row UUID. `p_idempotency_key UUID`
(NULL by default) is a separate parameter; replay returns the existing
row's id.

#### Cause / Resolution

Callers (orders, expenses, inventory) want to store the notification
id on their feature row to track delivery status. Returning UUID
satisfies that. Idempotency is enforced via a partial unique index
`uq_notification_outbox_idempotency (idempotency_key) WHERE
idempotency_key IS NOT NULL`.

#### Verification

pgTAP T_NOTIF_05: same `p_idempotency_key` returns the same id ;
T_NOTIF_05b: only one outbox row inserted.

---

### D-W5-5B-07 — Variable substitution is `{{var}}` Mustache-lite

**INDEX spec says:** "substitute `{{variable}}` placeholders in
template body/subject".

**What landed:** Mustache-lite with grammar `\{\{\s*[a-zA-Z_]\w*\s*\}\}`.
No escaping, no conditionals, no loops, no nested paths.

#### Cause / Resolution

- **Pure function in domain layer**
  (`packages/domain/src/notifications/composeMessage.ts`) — same
  grammar mirrored server-side in `_notif_substitute(TEXT, JSONB)`
  helper called by `enqueue_notification_v1` (so DB-only callers can
  enqueue without going through the app).
- Missing variables left as literal `{{var}}` + listed in
  `missingVars` array (caller decides : warn / fail).
- `null`/`undefined` treated as missing.
- Numbers/booleans stringified with `String(v)`.
- Whitespace inside braces tolerated (`{{ name }}` = `{{name}}`).
- Invalid identifiers (digits-first, hyphens, etc.) never match —
  passed through as literal text.

#### Verification

13 unit tests covering happy / missing / null / undefined / numeric /
zero / false / repeated / whitespace / malformed / invalid identifiers
/ no-vars / dedup.

---

### D-W5-5B-08 — 6 seed templates, all email channel

**INDEX spec says:** "Seed templates: order_complete, payment_received,
customer_birthday, low_stock_alert, po_received, expense_approved."

**What landed:** All six, plain text bodies (no HTML in v1), email
channel. Idempotent `ON CONFLICT (code) DO NOTHING`.

#### Cause / Resolution

Plain-text keeps the provider abstraction trivial (Resend API accepts
both `text` and `html` ; v1 uses `text` only). HTML rendering is
Phase 7+ when the marketing wants pretty emails.

#### Verification

pgTAP T_NOTIF_02 / T_NOTIF_02b / T_NOTIF_02c — all 6 codes present,
all active, all channel='email'.

---

## Phase 5.B — Companion migration

### D-W5-5B-09 — Migration 000181 added for `pick_notifications_batch_v1`

**INDEX spec says:** Phase 5.B migration block is `20260517000180` (1
migration).

**What landed:** Two migrations — `000180` (templates + outbox + RPC +
seeds) and `000181` (`pick_notifications_batch_v1` for the EF batch
claim).

#### Cause

Splitting the batch-claim RPC from the user-facing `enqueue` RPC keeps
the perm boundary obvious: `enqueue_notification_v1` is granted to
`authenticated` (self-gates on `notifications.send`) ;
`pick_notifications_batch_v1` is granted **only** to `service_role` so
nothing in user-space can starve the queue or mark rows as `sending`
out-of-band.

#### Resolution

`000181` is small (one RPC, no schema change) and consumes block 181
which was reserved free in the Wave 5 / Phase 5.B allotment.

#### Verification

- EF `notification-dispatch` invokes `pick_notifications_batch_v1(50)`
  and processes the returned rows.
- Smoke: SQL `SELECT * FROM pick_notifications_batch_v1(50)` against
  the staging seed row → status flipped to `sending` atomically with
  the SELECT.
- `REVOKE ALL ... FROM PUBLIC` confirmed by `pg_proc.proacl`.
