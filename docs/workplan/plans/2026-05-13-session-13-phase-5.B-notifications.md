# Session 13 — Phase 5.B — Notifications pipeline (MVP email-only) — Sub-plan

> **Status** : in-progress (2026-05-14)
> **Executor** : `coder` / `backend-dev` (`notif-pipe`)
> **Migration block** : `20260517000180` (1 migration)
> **Complexity** : L (~18-24 h)
> **Parent INDEX** : [`./2026-05-13-session-13-INDEX.md`](./2026-05-13-session-13-INDEX.md) §Phase 5.B (line 909)
> **Module ref**  : [`../../reference/04-modules/08-customers-loyalty.md`](../../reference/04-modules/08-customers-loyalty.md) (08-006)

## 1. Context (state at startup, verified 2026-05-14)

Waves 1-4 are DONE. Staging project `ikcyvlovptebroadgtvd` already has :

- ✓ `customers` table (Session 5) with `email TEXT`, `phone TEXT`, no opt-out columns yet.
- ✓ `audit_logs (id BIGINT PK, actor_id UUID, action TEXT, entity_type TEXT, entity_id UUID, metadata JSONB, created_at TIMESTAMPTZ)` (plural ; per CLAUDE.md).
- ✓ `permissions (code, module, action, description)` + `role_permissions` matrix (Wave 1 Phase 1.B).
- ✓ `has_permission(p_uid UUID, p_perm TEXT) RETURNS BOOLEAN` — DO NOT re-CREATE per CLAUDE.md.
- ✓ `set_updated_at()` trigger helper.
- ✓ `_shared/cors.ts`, `_shared/error-redact.ts`, `_shared/supabase-admin.ts` in EFs.
- ✓ Decision **D5** (decision-pack §D5) — Email-only MVP via Supabase EF fanout. Provider lock-out by env vars. We default to **Resend** (simpler API, free tier, single env var `RESEND_API_KEY`).
- ✓ Migration block `20260517000180` is unused.
- ✗ No `notification_templates`, `notification_outbox`, `enqueue_notification_v1`, `notifications.send` perm.

## 2. Decisions (locked for this phase)

- **D-W5-5B-01 Provider = Resend (HTTP API)** — Decision-pack §D5 leaves the choice open between Sendgrid and "Resend-as-SMTP-relay". We pick the Resend REST API (`POST https://api.resend.com/emails`) because :
  - single env var (`RESEND_API_KEY`),
  - no domain verification needed for the sandbox `onboarding@resend.dev` sender (good for smoke test),
  - 3 000 free emails / month sufficient for MVP volume,
  - identical JSON contract to Sendgrid — swap = single shared provider file.
  The provider lives in `_shared/email-provider.ts` and the EF `notification-dispatch` imports it. Switching to Sendgrid later = one file edit + one env var rename.

- **D-W5-5B-02 No `pg_cron` schedule in this phase** — `net.http_post` requires the `pg_net` extension which is enabled on Supabase but plumbing `cron.schedule` from MCP migrations runs into permission issues (`cron` schema is owned by `postgres` superuser). We document the manual invocation pattern in `email-provider.ts` and the EF supports a `?secret=<DISPATCH_SECRET>` query param so an external scheduler (Vercel Cron, GitHub Action, manual `curl`) can hit it without a Bearer JWT. Adding `pg_cron` automation is Phase 7.

- **D-W5-5B-03 Local-dev mock = console.log, NO sidecar file write** — INDEX spec mentions "writes to `notifications-dev-outbox.json`". Inside Deno EF runtime we have no write permission to the project root and writing to the EF sandbox `/tmp` is useless for debugging. Real local-dev experience = `console.log` is visible in `supabase functions serve` logs. We keep the JSON sidecar OUT to avoid dead code. The provider returns `{ ok: true, providerMessageId: 'console-<uuid>', mode: 'console' }` when `RESEND_API_KEY` is unset or starts with `re_test_`. Tests assert on the return shape, not on file IO.

- **D-W5-5B-04 `decideChannels` simple v1** — Customer-preferences columns (`notification_opt_out_email`, `..._sms`, ...) don't exist yet on `customers`. v1 `decideChannels` takes only the template's declared channel + an optional "customer prefs" object (`{ optOutEmail?: boolean; optOutSms?: boolean }`) so the caller can pass an empty object for now. Real prefs columns ship in Phase 5.C with the customer-notification-prefs migration. Domain function stays pure and future-compatible.

- **D-W5-5B-05 Permission `notifications.send` = manager+** — Seeded to roles `MANAGER`, `ADMIN`, `SUPER_ADMIN`. Cashier cannot enqueue. SUPER_ADMIN holds it through the unconditional branch in `has_permission` (set in Wave 1) so we only INSERT the perm row + the 3 explicit role grants (idempotent ON CONFLICT).

- **D-W5-5B-06 `enqueue_notification_v1` returns the outbox UUID, NOT void** — caller stores the id in their feature row (e.g. `orders.notification_id`) to track delivery. Idempotency = caller passes their own UUID via a separate column ; v1 RPC doesn't dedupe — we add `p_idempotency_key UUID` as a NULL-able column on `notification_outbox` with a partial unique index `WHERE idempotency_key IS NOT NULL`. ON CONFLICT, return the existing row's id.

- **D-W5-5B-07 Variable substitution is `{{var}}` Mustache-lite** — no escaping, no conditionals, no loops. Pure `String.replaceAll(/\{\{(\w+)\}\}/g, ...)`. Missing variables → literal `{{var}}` left in place + warning logged. Numeric / nested vars stringified with `String(v)`. Domain function is deterministic + pure.

- **D-W5-5B-08 6 seed templates** — INDEX prescribes `order_complete, payment_received, customer_birthday, low_stock_alert, po_received, expense_approved`. All seeded with `channel='email'`. Body is plain text (no HTML in v1 — keeps the provider abstraction trivial). Subject and body templates use the same `{{var}}` placeholder grammar.

## 3. Files to create / edit

### Domain (pure, IO-free) — `packages/domain/src/notifications/`

- `types.ts` — `NotificationChannel`, `NotificationTemplate`, `CustomerNotificationPrefs`, `ComposeResult`.
- `composeMessage.ts` — `composeMessage(template, variables)` → `{ subject, body, missingVars: string[] }`.
- `decideChannels.ts` — `decideChannels(templateChannel, prefs)` → `NotificationChannel[]`.
- `index.ts` — barrel.
- `__tests__/composeMessage.test.ts` — 10+ cases (happy, missing var, numeric, undefined, falsy, repeats, no vars).
- `__tests__/decideChannels.test.ts` — 6+ cases (channel respected, opt-out filters, empty prefs).

Then export the barrel from `packages/domain/src/index.ts`.

### Migration — `supabase/migrations/20260517000180_init_notification_templates.sql`

- `notification_templates (id UUID PK, code TEXT UNIQUE NOT NULL, channel TEXT CHECK IN ('email','sms','push','inapp') NOT NULL, subject_template TEXT, body_template TEXT NOT NULL, variables JSONB DEFAULT '[]'::jsonb NOT NULL, is_active BOOLEAN DEFAULT true NOT NULL, created_at TIMESTAMPTZ DEFAULT now() NOT NULL, updated_at TIMESTAMPTZ DEFAULT now() NOT NULL)` + `set_updated_at` trigger.
- `notification_outbox (id UUID PK DEFAULT gen_random_uuid(), template_code TEXT NOT NULL REFERENCES notification_templates(code), channel TEXT NOT NULL CHECK IN ('email','sms','push','inapp'), recipient TEXT NOT NULL, subject TEXT, body TEXT NOT NULL, status TEXT NOT NULL CHECK IN ('queued','sending','sent','failed','retry') DEFAULT 'queued', error_message TEXT, retries INT NOT NULL DEFAULT 0, idempotency_key UUID, scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(), sent_at TIMESTAMPTZ, provider_message_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`.
- Indexes : `idx_notification_outbox_status_scheduled (status, scheduled_for) WHERE status IN ('queued','retry')`, `uq_notification_outbox_idempotency (idempotency_key) WHERE idempotency_key IS NOT NULL`.
- RLS on both : SELECT for `authenticated`, INSERT/UPDATE only via SECURITY DEFINER RPCs (no direct INSERT policy for templates ; templates are seed + admin-only via Phase 5.C UI later).
- Permission INSERT : `notifications.send` (manager+). Grant rows to `MANAGER`, `ADMIN`, `SUPER_ADMIN`.
- RPC `enqueue_notification_v1(p_template_code, p_recipient, p_variables JSONB DEFAULT '{}'::jsonb, p_channel TEXT DEFAULT NULL, p_scheduled_for TIMESTAMPTZ DEFAULT NULL, p_idempotency_key UUID DEFAULT NULL) RETURNS UUID` — SECURITY DEFINER. Gates on `has_permission(auth.uid(), 'notifications.send')`. Resolves template, falls back to template.channel if `p_channel` NULL, substitutes vars server-side (mirrors domain logic so DB consumers without app can enqueue), inserts row, returns id. Idempotency replay returns existing id.
- 6 seed templates (`order_complete`, `payment_received`, `customer_birthday`, `low_stock_alert`, `po_received`, `expense_approved`) — channel='email', plain-text bodies, ON CONFLICT DO NOTHING.

### Edge Functions — `supabase/functions/`

- `_shared/email-provider.ts` (CREATE) — `sendEmail({ to, subject, body, from? })` async → `{ ok: boolean; providerMessageId?: string; error?: string; mode: 'resend' | 'console' }`. Reads `RESEND_API_KEY` env. If missing → console mode (development).
- `notification-dispatch/index.ts` (CREATE) — POST handler. Reads `?secret=` query param OR validates Bearer JWT (manager perm via `has_permission`). Polls outbox `WHERE status IN ('queued','retry') AND scheduled_for <= NOW()` LIMIT 50 FOR UPDATE SKIP LOCKED. For each row : marks `sending`, calls `sendEmail`, updates `sent` / `retry` / `failed` based on result + retry count (max 3, exponential backoff `2^retries` minutes). Returns `{ processed: N, sent: N, failed: N, retried: N }`.

### Tests

- `supabase/tests/notifications.test.sql` — pgTAP T_NOTIF_01..06 :
  - 01 schema (tables, columns, indexes)
  - 02 6 seed templates present + active
  - 03 RLS enabled on both tables
  - 04 `enqueue_notification_v1` happy path → row inserted, returns id
  - 05 idempotency replay returns same id
  - 06 missing template → raise exception
- `supabase/tests/functions/notifications-dispatch.test.ts` — Vitest live: manager enqueues via RPC, calls EF (`?secret=`), asserts outbox row status `sent` (console mode in test env since `RESEND_API_KEY` is unset in CI).
- `packages/domain/src/notifications/__tests__/composeMessage.test.ts` + `decideChannels.test.ts` — pure unit.

## 4. Execution order

1. Write this sub-plan, commit.
2. Domain helpers + tests, commit.
3. Migration via MCP `apply_migration`, regen types via `generate_typescript_types`, commit + types.
4. EF `_shared/email-provider.ts` + `notification-dispatch/index.ts` (file-only).
5. Deploy EF via MCP `deploy_edge_function`. Commit EF files.
6. pgTAP suite via MCP `execute_sql` (BEGIN ... ROLLBACK).
7. Vitest live + domain run.
8. `pnpm typecheck` green.
9. Update Wave 5 deviation pack (D-W5-5B-01..08).
10. Final commits squash-mergeable.

## 5. DoD checklist

- [ ] 1 migration `20260517000180` applied + types regen committed.
- [ ] EF `notification-dispatch` deployed via MCP ; smoke test sends 1 mock email in console mode.
- [ ] Channel layer compose pure + deterministic (unit tests).
- [ ] `pnpm typecheck` green.
- [ ] pgTAP T_NOTIF_01..06 green via execute_sql rollback envelope.
- [ ] Vitest live `notifications-dispatch.test.ts` green.
- [ ] Domain unit tests green.
- [ ] Deviations D-W5-5B-01..08 recorded.
- [ ] Commits squash-mergeable, Claude co-author.
