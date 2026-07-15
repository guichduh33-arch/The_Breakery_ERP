# Session 20 — Defense-in-depth GRANT hardening — Spec

> Date authored: 2026-05-17
> Branch: `swarm/session-20`
> Migration block: `20260524000010..099`
> Theme: close the "Supabase default permissive grants" pattern across tables, functions, and over-permissive RLS — in one session.

---

## §0 — Context

Session 13 closed the **anon RLS policy** gap on PII tables (5 tables flipped from `anon USING(true)` to `is_authenticated() OR has_kiosk_jwt()`). A live audit of the V3 dev DB (`ikcyvlovptebroadgtvd`) on 2026-05-17 — driven by the backlog-triage opening of S20 — surfaced **three remaining manifestations** of the same root pattern:

| # | Manifestation | Where | Impact |
|---|---|---|---|
| 1 | `refund_sequences` has **RLS disabled** | `pg_class.relrowsecurity = false` | Anon can `TRUNCATE` the refund-number sequence table with the public anon key. Contained to V3 dev (no prod traffic) but acute. |
| 2 | **~50 public tables** keep anon table-level `GRANT ALL` | `information_schema.role_table_grants WHERE grantee='anon'` | Critical surfaces affected (`audit_logs`, `journal_entries`, `journal_entry_lines`, `accounts`, `roles`, `role_permissions`, `permissions`, `user_profiles`, `user_sessions`, `cash_movements`, `print_queue`, `notification_outbox`, `production_records`, …). Currently masked by absence of anon RLS policies, but defense-in-depth principle violated — one RLS regression would unmask the whole surface. |
| 3 | **100 public SECURITY DEFINER functions** are anon-`EXECUTE`-able | `has_function_privilege('anon', oid, 'EXECUTE')` | Includes `complete_order_with_payment_v9`, `delete_user_v1`, `adjust_stock_v1`, `_revoke_user_sessions_v1`, `approve_expense_v1`, etc. S19 INDEX §10 DEV-S19-1.B-02 (medium) flagged the pattern — corrective migration `_22` patched one function. This wave does the project-wide sweep. |
| 4 | **11 `authenticated USING(true)` SELECT policies** | `pg_policies WHERE 'authenticated' = ANY(roles) AND qual = 'true'` | 5 of them are operational tables (cash_movements, lan_devices, notification_outbox, print_queue, stock_reservations) that should be permission-gated. 6 are reference data (holidays, display_screens, email_templates, expense_categories, notification_templates, receipt_templates) — staying permissive is by design. |

The 2026-04-09 audit's "P1-01 — 16+ tables anon SELECT" finding (the historically-cited top-priority item #2) was resolved at the **RLS level** by S13. The current spec resolves it at the **GRANT level** (defense-in-depth) and adds two new resolutions (functions, over-permissive `authenticated`).

---

## §1 — Goals (success criteria)

1. **`refund_sequences` RLS enabled** with documented policy. pgTAP asserts anon cannot SELECT/INSERT/UPDATE/DELETE/TRUNCATE.
2. **Zero anon table-level GRANTs on public.*** — `SELECT count(*) FROM information_schema.role_table_grants WHERE grantee='anon' AND table_schema='public' AND table_type='BASE TABLE'` returns `0`.
3. **Zero anon function-EXECUTE on public.*** — `has_function_privilege('anon', oid, 'EXECUTE') = false` for every `public` function.
4. **The 5 operational `authenticated USING(true)` SELECT policies are permission-gated** with smoke-tested per-role behavior. The 6 reference-data policies stay unchanged (documented in spec).
5. **Default privileges hardened** — future migrations cannot accidentally re-introduce anon GRANT/EXECUTE on public objects (via `ALTER DEFAULT PRIVILEGES`).
6. **Critical patterns codified** — CLAUDE.md gains an entry making "REVOKE FROM anon" the project-wide convention.
7. **Roadmap refreshed** — the historical P1-01 / phantom-tables items are explicitly closed in `00-roadmap-globale.md`.

---

## §2 — Non-goals (out of scope)

- The 6 reference-data `authenticated USING(true)` policies (`holidays`, `display_screens`, `email_templates`, `expense_categories`, `notification_templates`, `receipt_templates`) — these are intentionally readable by any authenticated user (printing receipts, sending emails, picking holidays). Documented as design intent, not gap.
- Function arg-level audits (which RPCs leak data via specific args).
- Schema-level isolation refactors (e.g., moving accounting tables to a `private.` schema).
- LAN message dedup TTL 5s (D-W6-6B-02), Playwright E2E CI (D-W6-6C-05), WAC landed cost shipping (TASK-07-012 partial), modal focus-trap migration. These remain as candidates for S21+ themes.
- I1/I2/I3 fiscal compliance — blocked by PKP status confirmation (business decision, not technical).

---

## §3 — Waves & deliverables

Each wave ships as its own commit on `swarm/session-20`. Final squash-merge PR.

### Wave 0 — Spec & branch setup

- Author this spec (`docs/workplan/specs/2026-05-17-session-20-spec.md`).
- Create branch `swarm/session-20` off latest `master`.

### Wave 1 — `refund_sequences` RLS hotfix

**Migration `20260524000010_enable_rls_refund_sequences.sql`**

```sql
ALTER TABLE public.refund_sequences ENABLE ROW LEVEL SECURITY;

-- Only the next_refund_number_v1 SECURITY DEFINER RPC writes here.
-- No INSERT/UPDATE/DELETE policy → all DML denied for non-superuser.
-- Authenticated SELECT for client-side observers (refund history pages, future audit UI).
CREATE POLICY refund_sequences_select_auth
  ON public.refund_sequences
  FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON POLICY refund_sequences_select_auth ON public.refund_sequences IS
  'S20 W1: enable RLS on sequence table — was previously bypassed. Reads OK for authenticated; writes only via next_refund_number_v1 RPC.';
```

**pgTAP test** `supabase/tests/security_refund_sequences.test.sql`:
- Assert `relrowsecurity = true` on the table.
- Assert anon SELECT returns 0 rows / 42501.
- Assert anon INSERT/UPDATE/DELETE returns 42501.
- Assert authenticated SELECT returns row count.

**Smoke**: hit refund flow end-to-end on V3 dev (POS → `refund-order` EF → DB) — RPC must still mint the next refund number.

### Wave 2 — Anon table-GRANT sweep

**Migration `20260524000020_revoke_anon_grants_from_public_tables.sql`**

```sql
-- Revoke all anon GRANTs on public base tables (defense-in-depth).
-- No anon RLS policies exist on public.* (verified by S13 + S20-Wave1).
-- EFs use service_role JWT; client uses authenticated via custom-fetch wrapper.
-- Kiosks (display/KDS/customer-display) authenticate via kiosk JWT under
-- `authenticated` role (has_kiosk_jwt() helper), not anon.
-- Therefore: no legitimate anon consumer of public.* tables exists.

DO $do$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT t.table_name, i.table_type
    FROM information_schema.role_table_grants t
    JOIN information_schema.tables i
      ON t.table_schema = i.table_schema
     AND t.table_name = i.table_name
    WHERE t.grantee = 'anon'
      AND t.table_schema = 'public'
      AND i.table_type IN ('BASE TABLE', 'VIEW')
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', r.table_name);
  END LOOP;
END
$do$;

-- Future-proof: any new table/view/sequence created in public.* will NOT auto-grant to anon.
-- Note: the exact `FOR ROLE` clause needed depends on which Supabase role currently owns
-- the auto-grant defaults (typically `postgres`; sometimes `supabase_admin`). Execution
-- step will discover via `pg_default_acl` and add `FOR ROLE <discovered>` clauses as needed.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
```

The loop covers both base tables and views (4 anon-granted views identified in the 2026-05-17 audit: `v_product_available_stock`, `view_recipe_products`, `view_product_allergens_resolved`, `view_section_stock_details`). The pgTAP test (below) asserts both categories are clean post-migration.

`pg_all_foreign_keys` (pgTAP extension artifact in `public`) and `tap_funky` (pgTAP test helper) appear in the audit's anon grant list. The loop will REVOKE on them too if `information_schema.tables` reports them as `BASE TABLE` or `VIEW` — harmless for project code, and the pgTAP extension re-grants what it needs at install/test time. If pgTAP nightly cron starts failing after Wave 2, treat as a deviation and either re-grant pgTAP-only objects or move them out of `public`.

**pgTAP test** `supabase/tests/security_anon_grants.test.sql`:

```sql
-- Generic assertion: zero anon grants remain on public base tables OR views.
SELECT is_empty(
  $$ SELECT t.table_name, i.table_type
     FROM information_schema.role_table_grants t
     JOIN information_schema.tables i
       ON t.table_schema = i.table_schema AND t.table_name = i.table_name
     WHERE t.grantee = 'anon'
       AND t.table_schema = 'public'
       AND i.table_type IN ('BASE TABLE', 'VIEW') $$,
  'no anon table/view-level GRANTs remain on public.*'
);
```

**Smoke**: POS login → place complete_order via `complete_order_with_payment_v9` → BO open `/reports` → kiosk display loads → KDS realtime fires.

### Wave 2.5 — Anon function-EXECUTE sweep

**Migration `20260524000030_revoke_anon_execute_from_public_functions.sql`**

```sql
-- All 100 SECURITY DEFINER functions + 1331 SECURITY INVOKER functions in public
-- are currently anon-EXECUTABLE by Supabase default. No legitimate anon consumer
-- exists (auth EFs use service_role; kiosks use kiosk-JWT → authenticated).
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- Future-proof.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
```

**pgTAP test** appended to `supabase/tests/security_anon_grants.test.sql`:

```sql
SELECT is_empty(
  $$ SELECT p.proname
     FROM pg_proc p
     JOIN pg_namespace n ON p.pronamespace = n.oid
     WHERE n.nspname = 'public'
       AND has_function_privilege('anon', p.oid, 'EXECUTE') $$,
  'no anon function-EXECUTE remains on public.*'
);
```

**Risk**: Supabase's PostgREST may rely on anon-EXECUTE for certain public RPCs invoked unauthenticated. This project has none (verified — login flow is via `auth-verify-pin` EF using service_role internally, not via direct anon RPC). Smoke verifies.

**Smoke**: Same as Wave 2 + a function-call from BO (adjust stock RPC), + verify Supabase Realtime still broadcasts (Realtime lives in `realtime` schema, unaffected).

### Wave 3 — Tighten 5 operational `authenticated USING(true)` policies

**Pre-flight** (do this in the wave PR, not in spec): query `permissions` table on V3 dev to confirm the codes below exist. Substitute closest equivalent if missing; log as deviation.

Expected permission codes (per CLAUDE.md and S13 RBAC migrations): `cashier.view`, `settings.view`, `orders.view`, `inventory.view`, `pos.access`. If `cashier.view` is absent, fall back to `pos.access`.

**Migration `20260524000040_tighten_authenticated_select_policies.sql`**

```sql
-- cash_movements: cashier reads own shift's movements; admins read all.
DROP POLICY IF EXISTS cash_movements_select_auth ON public.cash_movements;
CREATE POLICY cash_movements_select_auth
  ON public.cash_movements FOR SELECT TO authenticated
  USING (has_permission(auth.uid(), 'cashier.view') OR has_permission(auth.uid(), 'reports.financial.read'));

-- lan_devices: settings-level read.
DROP POLICY IF EXISTS lan_devices_select_authenticated ON public.lan_devices;
CREATE POLICY lan_devices_select_authenticated
  ON public.lan_devices FOR SELECT TO authenticated
  USING (has_permission(auth.uid(), 'settings.view'));

-- notification_outbox: settings-level read.
DROP POLICY IF EXISTS notification_outbox_select_authenticated ON public.notification_outbox;
CREATE POLICY notification_outbox_select_authenticated
  ON public.notification_outbox FOR SELECT TO authenticated
  USING (has_permission(auth.uid(), 'settings.view'));

-- print_queue: kiosk printers (kiosk-JWT) + orders.view operators.
DROP POLICY IF EXISTS print_queue_select_authenticated ON public.print_queue;
CREATE POLICY print_queue_select_authenticated
  ON public.print_queue FOR SELECT TO authenticated
  USING (has_kiosk_jwt() OR has_permission(auth.uid(), 'orders.view'));

-- stock_reservations: inventory.view.
DROP POLICY IF EXISTS stock_reservations_select_auth ON public.stock_reservations;
CREATE POLICY stock_reservations_select_auth
  ON public.stock_reservations FOR SELECT TO authenticated
  USING (has_permission(auth.uid(), 'inventory.view'));
```

The 6 reference-data policies (`holidays_select_authenticated`, `display_screens_select_authenticated`, `email_templates_select_authenticated`, `expense_categories_select_auth`, `notification_templates_select_authenticated`, `receipt_templates_select_authenticated`) are **intentionally left at `USING(true)`** — any authenticated user (cashier, waiter, manager, admin) has legitimate read access (printing receipts uses `receipt_templates`; POS picks holidays; etc.). Documented here as design intent, not a gap.

**pgTAP tests** `supabase/tests/security_authenticated_policies.test.sql`: per-table, assert as-cashier-with-perm = rows visible / as-no-perm-user = 0 rows. ~5 tests × 2 cases = ~10 assertions.

**Smoke**: BO open `/settings` (lan_devices, notification_outbox), `/inventory/stock-reservations`, place an order with print (print_queue claim), open cashier shift report (cash_movements).

### Wave 4 — Closeout

1. **Types regen** via `mcp__plugin_supabase_supabase__generate_typescript_types` → write to `packages/supabase/src/types.generated.ts`. RLS changes don't normally alter generated types, but regen for safety + spec convention.
2. **CLAUDE.md** — add to "Critical patterns — don't break these":
   > **Anon GRANT defense-in-depth** — `REVOKE ALL FROM anon ON public.*` is the project-wide default (Wave 2/2.5 of S20). New tables/functions get no anon grant via `ALTER DEFAULT PRIVILEGES`. If a future feature needs anon (e.g., public landing-page RPC), grant explicitly per-object with a comment justifying the exposure.
3. **Roadmap refresh** — `docs/workplan/backlog-by-module/00-roadmap-globale.md`:
   - Top priorités row #2: mark "Auditer & remplacer 16 RLS `anon USING(true)`" as **DONE S13 (RLS) + S20 (GRANT defense-in-depth)** with reference to this spec.
   - Top priorités row #4: mark phantom-tables (`system_alerts`, `customer_invoices`) as **DONE S14 (D2 decision pack) / S20 (verified absent on V3 dev)**.
   - Indicateurs de santé: add row "anon GRANTs/EXECUTE on public.* = 0" → DONE S20.
   - Session 20 cadence row (table §"Sessions complétées").
4. **Status notes** — append `S20 update:` lines to:
   - `01-auth-permissions.md` TASK-01-001 (RLS PII task) — note defense-in-depth GRANT sweep complement.
   - `25-security.md` TASK-25-001 (Restreindre RLS anon SELECT) — same complement.
   - `08-customers-loyalty.md` TASK-08-008 (customer_invoices) — note V3-dev verified absent.
5. **INDEX plan** — author `docs/workplan/plans/2026-05-17-session-20-INDEX.md` with deliverables per wave, deviations §10, commit list, migration list.

---

## §4 — Risks & mitigations

| # | Risk | Wave | Likelihood | Mitigation |
|---|---|---|---|---|
| R1 | Wave 2 REVOKE breaks an EF/page that secretly used anon role | 2 | Low | EFs use service_role JWT (verified in `supabase/functions/_shared/supabase-admin.ts`). `packages/supabase` client uses authenticated session via custom-fetch wrapper (CLAUDE.md critical pattern). Post-migration smoke covers golden paths. |
| R2 | Wave 2.5 breaks Supabase Realtime or public RPC | 2.5 | Low | Realtime/Storage live in non-`public` schemas. No documented anon-callable RPC in project. Smoke covers Realtime broadcast (KDS, display). |
| R3 | Wave 3 permission codes don't exist in DB | 3 | Medium | Pre-flight query against `permissions` table; substitute or seed if missing; log as deviation. |
| R4 | `refund_sequences` Wave 1 policy too strict (refund EF can't read) | 1 | Low | EFs run as service_role which bypasses RLS. Policy is for future client-side observers (none currently). Smoke covers refund flow E2E. |
| R5 | pgTAP generic-matrix test snags Supabase-managed projections (views into public from auth/storage) | 2 | Medium | Test scopes to `information_schema.tables WHERE table_type='BASE TABLE'` to exclude views and foreign tables. |
| R6 | Views still anon-readable after Wave 2 if loop missed them | 2 | Low | Loop now covers both `BASE TABLE` and `VIEW` in `information_schema.tables`. pgTAP assertion same. Spot-check the 4 known views post-migration. |
| R7 | A SECURITY DEFINER function depends on anon for an internal call path | 2.5 | Very low | SECURITY DEFINER functions run as definer (postgres), not caller; caller's role only gates whether the function can be CALLED. None of the 100 functions call back as anon. |
| R8 | `ALTER DEFAULT PRIVILEGES` needs a specific `FOR ROLE` clause on Supabase | 2 + 2.5 | Medium | At execution time, query `pg_default_acl` to discover which role(s) currently own the auto-grant defaults (typically `postgres`, sometimes `supabase_admin`). Add `FOR ROLE <discovered>` clauses; verify by creating a throwaway table post-migration and checking anon has no GRANT. If multiple roles seed defaults, all need ALTER. |
| R9 | pgTAP extension artifacts (`pg_all_foreign_keys`, `tap_funky`) in `public` get revoked, breaking nightly cron | 2 | Low | Re-grant pgTAP-only objects in a corrective if cron fails; or move pgTAP out of public to `extensions` schema. Treat as deviation. |

---

## §5 — Smoke test plan

Run after each wave's migration is applied to V3 dev, before the next wave's migration.

### Post-Wave 1
- [ ] POS: full refund flow (cashier authorizes, EF mints refund #, DB row created).
- [ ] BO: open `/reports/refunds` if exists, or query `refunds` table count.
- [ ] pgTAP: `security_refund_sequences.test.sql` passes (4 assertions).

### Post-Wave 2
- [ ] POS: PIN login → tile load → place order via `complete_order_with_payment_v9`.
- [ ] BO: open `/reports/sales-summary` (multiple table reads).
- [ ] BO: open `/users` (user_profiles + user_sessions + roles + role_permissions reads).
- [ ] Kiosk display: customer display loads + Realtime broadcast on new order.
- [ ] KDS: orders list loads + station marking flows.
- [ ] pgTAP: `security_anon_grants.test.sql` passes (1 assertion: zero anon table GRANTs).

### Post-Wave 2.5
- [ ] BO: trigger an RPC (e.g., `adjust_stock_v1` from `/inventory/adjust`).
- [ ] Supabase Realtime: KDS realtime channel + customer display realtime channel still fire on new order.
- [ ] pgTAP: same file updated assertion (zero anon function EXECUTE).

### Post-Wave 3
- [ ] BO as ADMIN: `/settings` (lan_devices + notification_outbox reads succeed).
- [ ] BO as ADMIN: `/inventory/stock-reservations` reads succeed.
- [ ] POS: place order with print → print_queue claim by printer kiosk JWT.
- [ ] BO as CASHIER (no `settings.view`): `/settings` 403 or empty list.
- [ ] BO as CASHIER: `/reports/cash` shows own shift movements.
- [ ] pgTAP: `security_authenticated_policies.test.sql` passes (10+ assertions).

---

## §6 — Migration list (planned)

| # | File | Wave | Purpose |
|---|---|---|---|
| 1 | `20260524000010_enable_rls_refund_sequences.sql` | 1 | Enable RLS + SELECT policy on `refund_sequences` |
| 2 | `20260524000020_revoke_anon_grants_from_public_tables.sql` | 2 | REVOKE ALL FROM anon on all public base tables + DEFAULT PRIVILEGES |
| 3 | `20260524000030_revoke_anon_execute_from_public_functions.sql` | 2.5 | REVOKE EXECUTE FROM anon on all public functions + DEFAULT PRIVILEGES |
| 4 | `20260524000040_tighten_authenticated_select_policies.sql` | 3 | Permission-gate 5 operational policies |

Block reserved: `20260524000010..099`. Corrective migrations (if any during execution) land at `..050..099`.

---

## §7 — pgTAP test list (planned)

| File | Wave | Assertions |
|---|---|---|
| `supabase/tests/security_refund_sequences.test.sql` | 1 | 4 — RLS enabled, anon SELECT denied, anon DML denied, authenticated SELECT works |
| `supabase/tests/security_anon_grants.test.sql` | 2 + 2.5 | 2 — zero anon table GRANTs (W2), zero anon function EXECUTE (W2.5) |
| `supabase/tests/security_authenticated_policies.test.sql` | 3 | ~10 — per-table positive/negative authz cases |

Runner: cloud V3 dev via `mcp__plugin_supabase_supabase__execute_sql` with `BEGIN ... ROLLBACK` envelope. Nightly pgTAP cron picks up new files automatically (S16 workflow).

---

## §8 — Execution model

- **Branch**: `swarm/session-20` off latest `master` (already created Wave 0).
- **Commits**: one per wave (Wave 0 spec/branch, Wave 1, Wave 2, Wave 2.5, Wave 3, Wave 4). Squash-merge PR.
- **Subagents**: optional — sequencing is mostly serial (each wave validates before next), but Wave 2 + Wave 2.5 are parallelizable since they touch disjoint objects (tables vs functions). Wave 3 must follow Wave 2 (over-permissive policies surface only after blanket REVOKE proves no anon dependency).
- **Migration apply path**: `mcp__plugin_supabase_supabase__apply_migration` per file. Cloud-only — Docker is retired (CLAUDE.md critical pattern).
- **Types regen**: in Wave 4 via MCP. Commit `types.generated.ts` if changed.

---

## §9 — Acceptance criteria checklist

- [ ] Wave 1 migration applied; `security_refund_sequences.test.sql` green.
- [ ] Wave 2 migration applied; `security_anon_grants.test.sql` table-portion green.
- [ ] Wave 2.5 migration applied; `security_anon_grants.test.sql` function-portion green.
- [ ] Wave 3 migration applied; `security_authenticated_policies.test.sql` green.
- [ ] All Wave 1-3 smoke tests pass on V3 dev.
- [ ] Types regen committed.
- [ ] CLAUDE.md updated with anon-GRANT defense-in-depth pattern.
- [ ] `00-roadmap-globale.md` updated (top priorités #2 & #4 marked DONE; indicateurs + sessions tables refreshed).
- [ ] Backlog Status notes appended (`01-auth-permissions.md`, `25-security.md`, `08-customers-loyalty.md`).
- [ ] INDEX plan authored at `docs/workplan/plans/2026-05-17-session-20-INDEX.md` with §10 deviations.
- [ ] PR opened from `swarm/session-20` → `master`, squash-merge, branch deleted.

---

## §10 — References

- S13 anon-RLS resolution: `supabase/migrations/20260517000033_rls_pii_anon_to_authenticated.sql`, PR #13 commit `bdf21aa`.
- S19 corrective `REVOKE FROM anon` precedent: `supabase/migrations/20260523000022_fix_update_role_session_timeout_v1_revoke_anon.sql`, INDEX `docs/workplan/plans/2026-05-17-session-19-INDEX.md` §10 DEV-S19-1.B-02.
- Backlog items closed by this session: TASK-01-001 (partial — GRANT-level complement), TASK-25-001 (same), TASK-08-008 (verified absent).
- 2026-04-09 audit P1-01: `docs/audit/01-architecture-security-audit.md§P1-01`.
- CLAUDE.md critical patterns reference: "Supabase auto-grants EXECUTE on public functions to `anon`…" (added in S19 covering a single corrective on `update_role_session_timeout_v1`). S20 expands the principle project-wide across both tables and functions, and adds `ALTER DEFAULT PRIVILEGES` future-proofing.
