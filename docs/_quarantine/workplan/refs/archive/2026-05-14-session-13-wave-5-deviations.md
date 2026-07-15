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

---

## Phase 5.C — Settings UI + holidays/templates

### D-W5-5C-01 — Setting key stored in `metadata.key`, NOT `entity_id`

**INDEX spec says (Wave 5.C bullet 6 in cumulative learnings):**
"INSERT into `audit_logs` with `entity_type='setting'`,
`entity_id=<key>`, `metadata={old, new}`, `actor_id=auth.uid()`."

**Real shape:** `audit_logs.entity_id` is **UUID** (not TEXT). Setting
keys are symbolic strings (`name`, `tax_rate`, …) and cannot be coerced
into a UUID. `set_setting_v1` therefore inserts with
`entity_id = NULL`, with `metadata.key` carrying the symbolic key and
`metadata.category` carrying the symbolic category. Full payload :
`{ key, category, old, new }`.

#### Cause

`audit_logs.entity_id` was introduced in Session 1 as a UUID-typed
column to match every existing entity (orders, products, customers…).
Settings are the first entity type whose primary identifier is text.
Coercing the key into a deterministic UUID (e.g. `uuid_generate_v5`)
would have hidden the human-readable key in the table, making audit
queries painful. Storing the key in `metadata.key` matches the existing
KDS pattern (D-W4-4B-03 stores idempotency keys in `metadata`).

#### Resolution

`set_setting_v1` audit row :
```
entity_type = 'setting'
entity_id   = NULL
action      = 'setting.update'
actor_id    = <user_profiles.id resolved from auth.uid()>
metadata    = { "key": "tax_rate", "category": "tax", "old": 0.1, "new": 0.11 }
```

#### Verification

- `\d audit_logs` shows `entity_id uuid` (unchanged).
- After calling `set_setting_v1('name', '"Test"', 'business')`, the row
  in `audit_logs` shows the expected metadata shape.
- pgTAP T18 / T20 verify the RPC signature.

---

### D-W5-5C-02 — `business_config` IS the settings store ; no `app_settings` table introduced

**INDEX spec says:** Phase 5.C "phantom RPC D2" implies a generic
`app_settings` key-value store.

**Real shape:** Per Wave 3.C deviation D-W3-3C-04, `business_config` is
the singleton settings store. `get_settings_by_category_v1` projects
the singleton columns into four symbolic categories
(`business / localization / tax / pos`) and `set_setting_v1` whitelists
8 keys against the singleton's columns.

#### Cause

Introducing `app_settings(key TEXT PK, value JSONB)` would have created
two sources of truth for already-typed columns
(`shift_variance_threshold_pct` is `NUMERIC`, not "a json value"), and
would have required a sync mechanism to keep `business_config` aligned.
Projecting the singleton into categories is strictly additive — no DB
shape change, just a read/write API on top.

#### Resolution

- `get_settings_by_category_v1(p_category)` reads
  `business_config` row id=1 and returns a partitioned JSONB payload.
- `set_setting_v1(p_key, p_value, p_category)` validates and updates
  the singleton column matching `p_key`.

Future "non-singleton" settings (per-tenant, per-user) can still be
added later as their own typed tables ; this RPC stays as the gateway
for the singleton's columns.

#### Verification

- `SELECT * FROM business_config` returns 1 row.
- `SELECT get_settings_by_category_v1('business')` returns
  `{ "category": "business", "settings": { "name": "...", "fiscal_address": "..." } }`.
- No `app_settings` table exists in `list_tables`.

---

### D-W5-5C-03 — `SettingsPermissionsPage` is a read-only matrix that LINKS to the editing UI

**INDEX spec says:** "Pages `/backoffice/settings/{general,holidays,templates,permissions}`."

**Real shape:** When Phase 5.C opened, Phase 5.D had **already shipped**
the full RBAC editing UI under `/backoffice/users/permissions` with
the `PermissionsMatrixPage` (commits in the same wave). To avoid
duplicating the matrix component, the Settings nav entry exposes a
**read-only** matrix with a banner linking to the canonical editor.

#### Cause

Phase 5.D was scheduled in parallel with 5.C and reached the route
register first. Re-implementing the same matrix under
`/backoffice/settings/permissions` with editing would have
double-maintained two copies of the same component family.

#### Resolution

`SettingsPermissionsPage` :
- Renders the same `roles × permissions × role_permissions` matrix as a
  table with green dots for granted cells.
- Includes a paragraph link "Use Users → Permissions for editing, user
  overrides, and last-admin protection."
- Gated on `settings.read` only (no `rbac.update`).
- Module-filter dropdown to narrow large matrices.

#### Verification

- `apps/backoffice/src/features/settings/__tests__/SettingsPermissionsPage.smoke.test.tsx`
  asserts the heading, the link href, the granted-dot count, and the
  permission-denied gate.

---

### D-W5-5C-04 — `email_templates` here is customer-facing, distinct from any `notification_templates`

**INDEX spec says:** Phase 5.C "Coordination note: Phase 5.B may also
create `notification_templates`. Don't collide".

**Real shape:** `email_templates` ships with 4 seeded codes
(`welcome`, `order_complete`, `payment_received`, `password_reset`).
These cover customer-facing transactional email. Phase 5.B's
`notification_templates` (if/when it ships) covers system events
(low stock, fiscal close, payroll anomaly…). The two tables coexist
by design ; no foreign keys, no enum collisions.

#### Cause

The two concerns differ in audience (customer vs operator), delivery
channel (email primarily vs in-app + push + email), and ownership
(marketing-style copy vs system runbook copy).

#### Resolution

- `email_templates(code UNIQUE, subject, body_html, body_text, variables JSONB)`.
- Variables stored as a JSONB array of token strings
  (`["{{customer_name}}", "{{order_number}}"]`).
- `SettingsEmailTemplatesPage` substitutes each token with a bracketed
  placeholder in the live preview (e.g. `[customer_name]`).

#### Verification

- pgTAP T8-T12 verify the table + the 4 seeded codes.
- `SettingsEmailTemplatesPage` smoke test asserts the preview
  substitution.

---

### D-W5-5C-05 — `receipt_templates.is_default` partial unique index

**INDEX spec says:** "`is_default BOOLEAN`".

**Real shape:** Plus a `CREATE UNIQUE INDEX ... ON receipt_templates((is_default)) WHERE is_default = true` enforcing at-most-one default at the DB level. The `useUpdateReceiptTemplate` /
`useCreateReceiptTemplate` hooks pre-demote any existing default before
the write so the index never collides on a UPDATE path.

#### Cause

POS rendering relies on "the" default template — without the unique
index a misconfigured tenant could end up with two `is_default = true`
rows and ambiguous receipt formatting at print time.

#### Resolution

- DB index :
  `CREATE UNIQUE INDEX idx_receipt_templates_one_default ON receipt_templates((is_default)) WHERE is_default = true;`.
- Client hook pre-demotes the current default before flipping a new row.

#### Verification

- pgTAP T16 asserts "exactly one default exists".
- Manual test : flipping is_default on a second row demotes the first
  via the client hook ; without the hook, the index would raise a unique
  violation.

---

## Phase 5.A — LAN architecture port (hybrid Realtime + BroadcastChannel)

### D-W5-5A-01 — `print_queue.device_id` FK deferred to migration `000171`

**INDEX spec says:** Migration `000170_init_print_queue.sql` ships
`print_queue` with `device_id UUID REFERENCES lan_devices(id) ON DELETE SET NULL`.

**What landed:** Migration `000170` ships `device_id UUID` (no FK).
Migration `000171_init_lan_devices.sql` then ALTERs the table to add
`print_queue_device_id_fkey` after `lan_devices` exists.

#### Cause

`apply_migration` runs each migration as an isolated transaction —
forward references across migrations would fail under "cold-apply"
(applying 000170 against a database missing `lan_devices` would
crash). Splitting the FK creation into the next migration keeps each
file independently applyable, which is required by the cloud staging
workflow (`mcp__plugin_supabase_supabase__apply_migration` calls are
discrete).

#### Resolution

- 000170 declares the column without a FK.
- 000171 issues `ALTER TABLE print_queue ADD CONSTRAINT
  print_queue_device_id_fkey FOREIGN KEY (device_id) REFERENCES
  lan_devices(id) ON DELETE SET NULL;`.

#### Verification

- pgTAP `T_LD_07` asserts the FK exists by name after both migrations.
- Migration order verified : `list_migrations` returns 000170 then 000171
  on staging `ikcyvlovptebroadgtvd`.

---

### D-W5-5A-02 — `mark_print_failed_v1` requeues up to 3 retries (4 total attempts)

**INDEX spec says:** "Worker retries `pending` (3 attempts max, backoff
5s / 15s / 60s) ; after 3 failures → status `failed`".

**What landed:** RPC contract :
- 1st fail (`retries=0 -> 1`) -> `queued`
- 2nd fail (`retries=1 -> 2`) -> `queued`
- 3rd fail (`retries=2 -> 3`) -> `queued`
- 4th fail (`retries=3 -> 4`) -> `failed` (terminal)

That is **3 retries + 1 initial attempt = 4 total**, matching the
INDEX intent ("3 attempts max" = 3 retries past the initial print).
Backoff scheduling is NOT in the SQL — it's left to the print-server
worker process, which polls `claim_print_job_v1` at its own cadence.

#### Cause

DB-side cron/backoff would require `pg_cron` + a separate dispatcher
function ; the print-server worker process (separate Node service)
already polls in a loop, so the schedule belongs there. Keeping the
DB primitive simple (immediate requeue on fail, no `scheduled_for`
column) lets the worker layer evolve independently.

#### Resolution

- RPC requeues until `retries >= 3` ; on the 4th failure, status flips
  to terminal `failed` and the worker stops polling that row.
- The print-server worker (not part of this phase) is expected to honor
  a 5s/15s/60s backoff between claims targeted at the failed device.

#### Verification

- pgTAP `T_PQ_07` exercises the 4-fail sequence and asserts
  `(queued, queued, queued, failed)` transitions.
- Vitest live test `T_PQ_LIVE_05` repeats the cycle against the real
  RPC.

---

### D-W5-5A-03 — D19 channel uniqueness applied to LAN hooks (UUID inside useEffect)

**INDEX spec lines 897 reference:** ``useMemo(() => `lan-${deviceId}-${Math.random().toString(36).slice(2, 9)}`, [deviceId])``.

**What landed:** all 3 new hooks (`useLanHub`, `useLanClient`,
`useLanHeartbeat`) generate `crypto.randomUUID()` **inside**
`useEffect`, NOT via component-body `useMemo`. Mirrors the
Wave 4 hotfixes D-W4-4B-05 (`useKdsRealtime`) and D-W4-4C-03
(`useDisplayRealtime`).

#### Cause

`useMemo(() => crypto.randomUUID(), [])` looks correct but is broken in
StrictMode dev mode :
- React invokes `useMemo` during *render*.
- StrictMode discards the first render's result and runs the body for
  the second render.
- The second render's UUID survives, but **both effect mounts then run
  with that same UUID** — channel-name collision.

Generating the UUID inside the effect (which runs once per effect
cycle, not per render) sidesteps this.

#### Resolution

Each hook follows the pattern :

```ts
useEffect(() => {
  const channelKeySuffix = crypto.randomUUID();
  const hub = new LanHub({ ..., channelKeySuffix });
  hub.start();
  return () => hub.stop();
}, [...]);
```

#### Verification

- `useLanHub.uniqueChannel.test.tsx` asserts StrictMode double-mount
  produces 2 distinct channel names ; non-Strict produces 1.
- Grep audit : `grep -RE "supabase\.channel\(['\"][^'\"]*['\"]\)" apps/pos/src/features/lan/` returns 0 hits.

---

### D-W5-5A-04 — LanHub / LanClient use loose `any` types for the Supabase client

**INDEX spec says (implicitly):** typed integration with
`@supabase/supabase-js` types.

**What landed:** `lanHub.ts` / `lanClient.ts` / `lanHubMessageHandler.ts`
declare local `type SupabaseClient = any` and `type RealtimeChannel = any`
instead of importing from `@supabase/supabase-js`.

#### Cause

`@supabase/supabase-js` is NOT a direct dependency of `@breakery/app-pos`
(it's a transitive dep via `@breakery/supabase`). Importing types from
it would require adding the dep + a peer-dep declaration. The
runtime client is obtained via `@/lib/supabase` (which itself imports
from `@breakery/supabase`), so the types are erased at runtime anyway.
The other LAN-adjacent files (`useKdsOrders.ts`, `useBumpItem.ts`)
follow the same pattern.

#### Resolution

- Use local `any` types for `SupabaseClient` and `RealtimeChannel`.
- Each `any` is justified by an eslint-disable comment.
- Future improvement : expose typed wrappers from `@breakery/supabase`
  (out-of-scope for Phase 5.A).

#### Verification

- POS typecheck passes (`pnpm --filter @breakery/app-pos typecheck` -> 0 errors).
- The few `(supabase as any)` casts are confined to LAN files.

---

### D-W5-5A-05 — Hub handler dispatches `kds.bump` to print queue, NOT to KDS RPCs

**INDEX spec says (Task 21-002):** "Hub handles KDS_ORDER_ACK, KDS_ORDER_READY,
KDS_ORDER_BUMP, KDS_ITEM_PREPARING, KDS_ITEM_READY ... Hub updates
order_items.kds_status or broadcasts to display/POS for synchro UI".

**What landed:** `lanHubMessageHandler.ts` handles a *minimal* KDS
contract :
- `kds.bump` -> invalidate `kds` + `orders` caches + enqueue kitchen-chit
  print job (when `new_status === 'preparing'`).
- `kds.recall` / `kds.undo` -> invalidate `kds` cache only.

Status mutations themselves happen in the originating device's RPC
call (`kds_bump_item_v1`, `kds_recall_order_v1`, `kds_undo_bump_v1` —
all from Phase 4.B). The hub is the **fanout layer**, not the
state owner.

#### Cause

V2's monolithic hub had to mutate state directly because there were no
RPCs — RLS was less strict and the hub had service-role privileges.
V3 routes every state change through SECURITY DEFINER RPCs (Phase 4.B
KDS work). Re-implementing the state machine in the hub would
duplicate the RPC contract and risk RLS bypass on misconfigured
clients. The hub's job is now (a) dedup, (b) fanout, (c) side-effects
that depend on cross-device visibility (kitchen-chit print, heartbeat
table write).

#### Resolution

- 21-001 (dedup) : `MessageDedup` ring per hub/client.
- 21-002 (KDS handlers) : subset — `kds.bump/recall/undo` invalidate
  downstream caches.
- 21-003 (print target) : `print.result` envelopes carry `to=msg.from`
  (targeted reply, not broadcast).
- 21-004 (print queue) : `enqueue_print_job_v1` called from
  `handleKdsBump` + `handlePrintRequest`.
- 21-005..011 (failover, persistence, diagnostics, etc.) : OUT OF
  SCOPE for Phase 5.A — deferred to Wave 6+.

#### Verification

- `lanHub.dedup.test.ts` covers (1) + envelope guard + self-echo.
- `useLanHub.uniqueChannel.test.tsx` covers D19 channel-name uniqueness.
- pgTAP `print_queue.test.sql` + `lan_devices.test.sql` cover the
  RPC contracts.

---

### D-W5-5A-06 — `useKdsRealtime` extended with optional `onEvent` callback (non-breaking)

**INDEX spec says:** "useKdsRealtime adds LAN broadcast on bump".

**What landed:** `useKdsRealtime(station, opts?: { onEvent?: (payload) => void })`.
Existing call site (`apps/pos/src/pages/Kds.tsx`) passes a single
argument — `opts` defaults to `{}` so no caller breaks. New callers
(e.g., a future `useKdsLanBridge`) can wire `useLanClient.send()` to
`opts.onEvent`.

#### Cause

Tightly coupling `useKdsRealtime` to LAN transport would force the KDS
hook to depend on the LAN feature graph (LanClient, MessageDedup,
broadcast lifecycle). That couples two independent concerns (DB
subscription + LAN mesh) and breaks the existing
`useKdsRealtime.uniqueChannel.test.tsx` mock surface. The optional
callback keeps both responsibilities orthogonal — the KDS hook stays
DB-only ; bridging to LAN is opt-in at the call site.

#### Resolution

- Hook signature : `useKdsRealtime(station, opts?: { onEvent?: ... })`.
- Hook fires `opts.onEvent(payload)` on every order_items change.
- Existing call site at `apps/pos/src/pages/Kds.tsx:37` unchanged.

#### Verification

- `useKdsRealtime.uniqueChannel.test.tsx` still green (2 tests).
- Compatibility : `useKdsRealtime('kitchen')` still compiles + works.
