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

---

## Phase 5.D — RBAC UI + audit pairing + last-admin protection

### D-W5-5D-01 — `user_profiles` has `full_name` only, no first/last/phone

**INDEX spec says:** `create_user_v1(p_email TEXT, p_role_code TEXT,
p_first_name, p_last_name, p_pin_hash TEXT, p_phone TEXT DEFAULT NULL)`.

**Real signature landed:** `create_user_v1(p_employee_code TEXT,
p_full_name TEXT, p_role_code TEXT, p_pin TEXT) RETURNS UUID`.

#### Cause

The V3 `user_profiles` table (migration `20260503000001_init_auth.sql`)
ships with `id, auth_user_id, employee_code, full_name, pin_hash,
role_code, is_active, failed_login_attempts, locked_until,
last_login_at, created_at, updated_at, deleted_at`. **There is no
first_name / last_name / phone / email column.** Splitting the name
or adding contact info would require a separate migration that is
out-of-scope for Phase 5.D and would cascade through the existing
`auth-verify-pin` EF, `useAuthStore`, BO sidebar bottom widget, and
~6 audit-emitting RPCs that read `full_name`.

The synthetic email for `auth.users` is generated server-side from
`employee_code` (`staff-<emp_code>@thebreakery.local`) so PIN auth
keeps working unchanged. Plaintext PIN is taken as input then
bcrypt-hashed inside the RPC via the existing `hash_pin()` helper.

#### Resolution

- `create_user_v1(p_employee_code, p_full_name, p_role_code, p_pin)`.
- The UI dialog (`UserFormDialog.tsx`) collects exactly these 4 fields.
- Migration `20260517000200` adds 5 RPCs total: `create_user_v1`,
  `update_user_role_v1`, `delete_user_v1`, `update_user_profile_v1`,
  `reset_user_pin_v1`, plus an internal helper
  `_revoke_user_sessions_v1`.

#### Verification

- `pg_get_function_identity_arguments` for `create_user_v1` returns
  `p_employee_code text, p_full_name text, p_role_code text, p_pin text`.
- pgTAP T_USR_01a..e assert all 5 RPC signatures.

---

### D-W5-5D-02 — RPCs INSERT into `auth.users` directly (no gotrue admin API)

**INDEX spec says:** "Insert into `auth.users` (via admin API call OR via
the same flow used by existing user creation)".

**Real impl:** `create_user_v1` is `SECURITY DEFINER` running as the
function-owner role (postgres on staging). It INSERTs into `auth.users`
directly, mirroring the seed migration pattern in `supabase/seed.sql`.

#### Cause

A gotrue admin API call requires a service-role JWT, which a backoffice
client doesn't have (RPCs are authenticated with the PIN-derived JWT
that is HS256-signed). Going through a separate "user-create" Edge
Function would (a) require duplicating the permission gate
(`has_permission(auth.uid(), 'users.create')`), (b) introduce another
service-role secret in EF env, (c) split the audit trail across two
systems. The direct INSERT — already used by the seed migration —
keeps the create+audit transaction atomic with no extra moving parts.

The synthetic email + disabled bcrypt password (`crypt('disabled-...'
|| gen_random_uuid(), gen_salt('bf'))`) prevent email-password sign-in
without explicitly disabling that flow at the gotrue level.

#### Resolution

- `create_user_v1` issues a single `INSERT INTO auth.users (...) VALUES
  (...)` then a second `INSERT INTO user_profiles (...) VALUES (...)`.
  Both rows commit together with the audit row.
- The audit row's `actor_id` is the **caller's profile id**, not the
  caller's `auth.uid()` — see D-W5-5D-04.

#### Verification

- pgTAP T_USR_03b : the `auth.users` row exists after `create_user_v1`.
- pgTAP T_USR_03c : audit row inserted on create.

---

### D-W5-5D-03 — Session revocation = DELETE auth.sessions + UPDATE user_sessions

**INDEX spec says:** "Revoke active sessions for that user via
`auth.sessions` table OR Supabase admin API (gotrue admin endpoint)".

**Real impl:** Helper `_revoke_user_sessions_v1(p_profile_id)` runs
both deletions atomically:

1. `DELETE FROM auth.sessions WHERE user_id = (auth_user_id of target)` —
   revokes GoTrue access tokens (refresh tokens chain breaks too).
2. `UPDATE user_sessions SET ended_at = now(), end_reason = 'role_changed'
   WHERE user_id = p_profile_id AND ended_at IS NULL` — closes the custom
   PIN-auth session ledger rows.

Helper returns the integer sum, which `update_user_role_v1` and
`delete_user_v1` include in their JSON response *and* in the audit
metadata (`revoked_session_count`).

#### Cause

V3 has two session ledgers running in parallel : (a) GoTrue's own
`auth.sessions` table (managed by Supabase's auth service, refresh
tokens etc.) and (b) the V3-internal `user_sessions` table (custom
SHA-256 hashed PIN-derived tokens, the PIN auth wrapper consults this
ledger). Revoking only one would leave the other side believing the
user is still authenticated. The helper deletes both atomically in a
single SECURITY DEFINER transaction.

#### Verification

- pgTAP T_USR_05a : `revoked_session_count = 1` (one fake row planted
  pre-role-change).
- pgTAP T_USR_05b : `0` remaining active `user_sessions` post-call.
- Vitest live `users.test.ts` confirms `revoked_session_count >= 1`
  after planting one row pre-RPC and reading the count post-RPC.

---

### D-W5-5D-04 — `audit_logs.actor_id` FK → `user_profiles.id`, not `auth.users.id`

**INDEX wording:** "Issue audit_log row".

**Bug found during pgTAP first run:** First migration body inserted
`v_caller_uid := auth.uid()` (a `auth.users.id`) into
`audit_logs.actor_id`. The FK `audit_logs_actor_id_fkey REFERENCES
user_profiles(id)` rejected the row → `23503` foreign key violation.

#### Cause

The audit_logs table was modelled after `user_profiles.id` (Phase 1.B
[m5] migration `20260517000034`) — actor is the profile, not the
underlying auth user. The same shape is used by the four legacy SECURITY
DEFINER RPCs (soft_delete_customer, record_stock_movement_v1, transfer
RPCs).

#### Resolution

Each user-mgmt RPC now resolves `v_caller_prof` via
`SELECT id FROM user_profiles WHERE auth_user_id = v_caller_uid AND
deleted_at IS NULL LIMIT 1` and inserts that into `audit_logs.actor_id`.

#### Verification

- pgTAP T_USR_03c / T_USR_04b / T_USR_06b / T_USR_08c all assert the
  audit row exists with the correct entity_type/action/metadata.
- Re-running the suite after the fix produces 26/26 green (was failing
  at T_USR_09 on the FK violation before).

---

### D-W5-5D-05 — PermissionMatrix reads `role_permissions`, not 545 has_permission() calls

**INDEX spec says:** "PermissionMatrix component consumes
`has_permission()` lookup (Wave 1) [for each (role, permission) pair
from `permissions` and `role_permissions` tables]".

**Real impl:** `usePermissionMatrix` hook fetches `roles`, `permissions`,
`role_permissions` in **3 parallel queries** (≈100 rows total) and
builds a `Set<string>` keyed by `${role_code}\x00${permission_code}`.
The matrix cell renders ✓ iff the set contains the key.

#### Cause

V3 has 5 roles × 109 permissions = 545 cells. Calling
`has_permission(role_uuid, perm_code)` per cell would be 545 RPC
round-trips per matrix render — slow, chatty, and unnecessarily
expensive. **The function body itself (Phase 1.B locked) is a pure
data lookup against the same three tables we read directly.** So
reading the tables is semantically equivalent (`is_granted` flag
handled), faster, and cacheable for 5 minutes.

`user_permission_overrides` is intentionally NOT joined in : the
matrix shows **role defaults**, not per-user overrides. Per-user
overrides will be a future Phase 5.D+ feature with its own UI surface.

#### Resolution

`PermissionMatrix.tsx` consumes the role_permissions table directly,
groups by `module` for visual separation, and offers a filter box
over code/module/description. A footnote on the page explicitly cites
the design : Phase 1.B made `has_permission()` a pure lookup → the
matrix view IS the function's truth.

#### Verification

- Network panel shows 3 SELECTs (roles, permissions, role_permissions)
  on first render; cached thereafter.
- Matrix cells against `EMP000` (SUPER_ADMIN) show ✓ for all 109
  permissions ; against `EMP001` (CASHIER) show ≈ 7 ✓.
- The footnote on `PermissionsMatrixPage` references the locked
  function.
