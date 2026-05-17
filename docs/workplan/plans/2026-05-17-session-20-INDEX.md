# Session 20 — INDEX (Defense-in-depth GRANT hardening)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the "Supabase default permissive grants" pattern across tables, functions, and over-permissive RLS in a single session — building on S13's anon-RLS work and S19's `REVOKE-from-anon` precedent on a single function.

**Architecture:** 4 execution waves (1, 2 + 2.5 parallelizable, 3, 4) serialized by gate. Each wave = one commit. Cloud-only execution via Supabase MCP — no Docker. DB-heavy session; lead executes serially (no subagent fan-out by default — Wave 2 + 2.5 can be parallelized via subagent if desired since they touch disjoint objects).

**Tech Stack:** Postgres RLS + GRANT/REVOKE + ALTER DEFAULT PRIVILEGES, pgTAP, Supabase MCP for DB ops, TypeScript types regen.

**Date:** 2026-05-17
**Branch:** `swarm/session-20` (off `d9fb507` master, post-S19 merge PR #23)
**Spec:** [`../specs/2026-05-17-session-20-spec.md`](../specs/2026-05-17-session-20-spec.md) (commit `736d59a`)
**Migration block reserved:** `20260524000010..099`

---

## 1. Goal global

Close 4 manifestations of the Supabase-default-permissive-grants pattern surfaced by 2026-05-17 V3 dev audit :

- **Wave 1** — `refund_sequences` RLS enabled (acute : anon currently TRUNCATE-able).
- **Wave 2** — REVOKE ALL FROM anon on ~50 public base tables + 4 views, ALTER DEFAULT PRIVILEGES.
- **Wave 2.5** — REVOKE EXECUTE FROM anon on all 1431 public functions (100 SECURITY DEFINER + 1331 SECURITY INVOKER), ALTER DEFAULT PRIVILEGES.
- **Wave 3** — Permission-gate 5 operational `authenticated USING(true)` SELECT policies (`cash_movements`, `lan_devices`, `notification_outbox`, `print_queue`, `stock_reservations`). Leave 6 reference-data policies unchanged.
- **Wave 4** — Types regen + CLAUDE.md pattern + roadmap refresh + Status notes + PR.

**Total phases exécutables : 5** (Wave 0..4, Wave 2 + 2.5 = 2 phases).
**Effort estimé : ~10-14h solo, ~8-10h with Wave 2/2.5 parallelization.**

---

## 2. Architecture en vagues

```
Wave 0 (planning) — Phase 0.1
  └─► Spec ✓ committed 736d59a + INDEX (this doc) + branch ✓
        │
        ▼
Wave 1 (DB — solo) — Phase 1.A
  └─► refund_sequences RLS + policy + pgTAP
        │
        ▼ Wave 1 sync gate (pgTAP green + refund smoke)
Wave 2 + Wave 2.5 (DB — 2 phases parallelizable)
  ├── Phase 2.A : REVOKE table+view anon GRANTs + ALTER DEFAULT PRIVILEGES + pgTAP
  └── Phase 2.5.A : REVOKE function anon EXECUTE + ALTER DEFAULT PRIVILEGES + pgTAP
        │
        ▼ Wave 2/2.5 sync gate (pgTAP + golden-path smoke : login, place order, BO reports, kiosks)
Wave 3 (DB — solo) — Phase 3.A
  └─► Tighten 5 operational authenticated USING(true) policies + pgTAP
        │
        ▼ Wave 3 sync gate
Wave 4 — Phase 4.A : types regen + CLAUDE.md + roadmap + Status notes + INDEX §10 + PR
```

---

## 3. Wave 0 — Prerequisites

### Phase 0.1 — Spec + INDEX + branch

**Files :**
- `docs/workplan/specs/2026-05-17-session-20-spec.md` ✓ (commit `736d59a`)
- `docs/workplan/plans/2026-05-17-session-20-INDEX.md` ✓ (this doc, to be committed)

**Steps :**
- [x] Spec dated 2026-05-17, 4 manifestations + 7 goals + 4 risks initial (R8/R9 added in self-review)
- [x] Branch `swarm/session-20` created off `d9fb507` master
- [x] INDEX dated, 5 waves, this doc
- [ ] Commit this INDEX on branch

```bash
git add docs/workplan/plans/2026-05-17-session-20-INDEX.md
git commit -m "$(cat <<'EOF'
docs(workplan): session 20 — INDEX — defense-in-depth GRANT hardening

Plan companion to spec 736d59a. 4 execution waves (1, 2+2.5, 3, 4)
serialized by gate. Cloud-only via Supabase MCP — no Docker.
Migration block 20260524000010..099. Each wave = one commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Complexity** : **S** (~30 min, mostly done).
**Suggested executor** : lead (no subagent).

---

## 4. Wave 1 — DB : `refund_sequences` RLS hotfix

### Phase 1.A — Enable RLS + policy on `refund_sequences` + pgTAP (P0 by impact, contained to V3 dev)

**Module(s)** : 03 (Payments/Refunds), 25 (Security).

**Files :**
- `supabase/migrations/20260524000010_enable_rls_refund_sequences.sql` (CREATE)
- `supabase/tests/security_refund_sequences.test.sql` (CREATE)

- [ ] **Step 1 — Verify pre-state on V3 dev (no changes yet)**

Run via `mcp__plugin_supabase_supabase__execute_sql` (project_id=`ikcyvlovptebroadgtvd`) :

```sql
SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = 'public' AND c.relname = 'refund_sequences';
```

Expected : `rls_enabled = false`. If `true`, RLS already on — skip Step 2's `ALTER TABLE` clause and proceed with policy creation only.

- [ ] **Step 2 — Apply migration via MCP `apply_migration`**

Apply `mcp__plugin_supabase_supabase__apply_migration` with `project_id=ikcyvlovptebroadgtvd`, `name=enable_rls_refund_sequences`, body :

```sql
-- 20260524000010_enable_rls_refund_sequences.sql
-- Session 20 / Wave 1 — Enable RLS on refund_sequences (P0 hotfix).
--
-- Audit 2026-05-17 found relrowsecurity=false on this table → anon could
-- TRUNCATE with public anon key. Only SECURITY DEFINER RPC
-- next_refund_number_v1 writes here (verified via grep). Safe to enable.

ALTER TABLE public.refund_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY refund_sequences_select_auth
  ON public.refund_sequences
  FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON POLICY refund_sequences_select_auth ON public.refund_sequences IS
  'S20 W1: enable RLS on sequence table — was previously bypassed. Reads OK '
  'for authenticated; writes only via next_refund_number_v1 RPC.';
```

- [ ] **Step 3 — Verify post-state on V3 dev**

```sql
SELECT
  c.relrowsecurity AS rls_enabled,
  (SELECT count(*) FROM pg_policies
    WHERE schemaname='public' AND tablename='refund_sequences') AS policy_count
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = 'public' AND c.relname = 'refund_sequences';
```

Expected : `rls_enabled = true`, `policy_count = 1`.

- [ ] **Step 4 — Author pgTAP test file**

Create `supabase/tests/security_refund_sequences.test.sql` :

```sql
-- S20 Wave 1 — RLS on refund_sequences regression suite.
BEGIN;

SELECT plan(4);

-- A1 : RLS enabled on the base table
SELECT ok(
  (SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid
    WHERE n.nspname='public' AND c.relname='refund_sequences'),
  'refund_sequences has RLS enabled'
);

-- A2 : SELECT policy for authenticated exists
SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='refund_sequences'
       AND policyname='refund_sequences_select_auth'
       AND 'authenticated' = ANY(roles)
  ),
  'refund_sequences_select_auth policy exists for authenticated'
);

-- A3 : No INSERT/UPDATE/DELETE policy means all client DML denied
SELECT is_empty(
  $$ SELECT policyname FROM pg_policies
      WHERE schemaname='public' AND tablename='refund_sequences'
        AND cmd IN ('INSERT','UPDATE','DELETE') $$,
  'no client-writable policies on refund_sequences'
);

-- A4 : anon has no GRANTs (relevant post-Wave 2 ; pre-Wave 2 this will still hold
-- because table-level GRANTs are independent of RLS — the GRANT was there but
-- RLS being off was the actual issue. Asserts the future-clean state.)
-- Soft-mode : pass if either GRANTs absent (post-W2) OR RLS now blocks (W1 done).
-- For W1's pgTAP green criterion we only enforce A1+A2+A3.
SELECT pass('A4 deferred to Wave 2 pgTAP suite');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 5 — Run pgTAP via MCP `execute_sql`**

Wrap the test file content in a single `execute_sql` call. Expected : 4 passes, no failures.

- [ ] **Step 6 — Smoke test refund flow on V3 dev**

Open POS on V3 dev (use any test cashier PIN). Create a small order, complete payment, refund one line. Verify in DB :

```sql
SELECT id, sequence_number, created_at
  FROM public.refund_sequences
  ORDER BY created_at DESC LIMIT 3;
```

Expected : new sequence row minted by `next_refund_number_v1` RPC. RPC runs as service_role so RLS does not block it.

- [ ] **Step 7 — Commit**

```bash
git add supabase/migrations/20260524000010_enable_rls_refund_sequences.sql \
        supabase/tests/security_refund_sequences.test.sql
git commit -m "$(cat <<'EOF'
fix(security): session 20 — phase 1.A — enable RLS on refund_sequences

Audit 2026-05-17 found relrowsecurity=false on public.refund_sequences →
anon could TRUNCATE with public anon key. Enable RLS + SELECT policy for
authenticated. Writes are gated solely by SECURITY DEFINER RPC
next_refund_number_v1 (no INSERT/UPDATE/DELETE policy → all client DML
denied). Refund flow smoke E2E green on V3 dev.

pgTAP: supabase/tests/security_refund_sequences.test.sql (3 hard asserts +
1 deferred to W2 sweep).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**DoD :**
- [ ] Migration applied on V3 dev.
- [ ] `relrowsecurity = true` post-migration.
- [ ] pgTAP file green via cloud MCP.
- [ ] Refund flow smoke passes.
- [ ] Commit pushed (or staged for batch push at end of session).

**Complexity** : **S** (~1.5h).
**Dependencies** : Phase 0.1 (branch exists).
**Suggested executor** : lead (no subagent — single-file migration).

---

## 5. Wave 2 + Wave 2.5 — DB : anon GRANT sweep (tables + functions, parallelizable)

### Phase 2.A — REVOKE anon table-level GRANTs on public.* + ALTER DEFAULT PRIVILEGES + pgTAP

**Module(s)** : 25 (Security), cross-cutting.

**Files :**
- `supabase/migrations/20260524000020_revoke_anon_grants_from_public_tables.sql` (CREATE)
- `supabase/tests/security_anon_grants.test.sql` (CREATE — table portion ; function portion added by Phase 2.5.A)

- [ ] **Step 1 — Discover the auto-grant role owner on V3 dev**

```sql
-- Which role(s) seed default privileges that auto-grant anon on new tables?
SELECT
  pg_get_userbyid(defaclrole) AS role,
  defaclnamespace::regnamespace AS schema,
  defaclobjtype,
  defaclacl
FROM pg_default_acl
WHERE defaclnamespace = 'public'::regnamespace::oid;
```

Note the role(s) (typically `postgres`, sometimes `supabase_admin`). This drives the `FOR ROLE <role>` clauses needed by the `ALTER DEFAULT PRIVILEGES` statements below.

- [ ] **Step 2 — Snapshot the current anon GRANT footprint (pre-state for verification)**

```sql
SELECT count(*) AS anon_table_grants_before
  FROM information_schema.role_table_grants t
  JOIN information_schema.tables i
    ON t.table_schema = i.table_schema AND t.table_name = i.table_name
 WHERE t.grantee = 'anon'
   AND t.table_schema = 'public'
   AND i.table_type IN ('BASE TABLE', 'VIEW');
```

Expected per audit : ~250 rows (50 tables × 5 priv types + 4 views × ~6 priv types). Record the number for post-state diff.

- [ ] **Step 3 — Apply migration via MCP `apply_migration`**

`name=revoke_anon_grants_from_public_tables`, body :

```sql
-- 20260524000020_revoke_anon_grants_from_public_tables.sql
-- Session 20 / Wave 2 — REVOKE anon table+view GRANTs on public.*.
--
-- Defense-in-depth complement to S13's anon-RLS sweep. No public.* table or
-- view needs anon GRANT in this project : EFs run as service_role, the
-- packages/supabase client wires authenticated session via custom-fetch,
-- kiosks authenticate as authenticated-with-kiosk-JWT (has_kiosk_jwt()).

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

-- Future-proof : new tables/views/sequences in public.* will NOT auto-grant
-- to anon. The FOR ROLE clause MUST match the role(s) discovered in Step 1.
-- If multiple roles seed defaults, repeat the statement per role.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
```

If Step 1 surfaced additional default-acl roles (e.g., `supabase_admin`), append the matching `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin ...` lines before applying.

- [ ] **Step 4 — Verify post-state on V3 dev**

```sql
SELECT count(*) AS anon_table_grants_after
  FROM information_schema.role_table_grants t
  JOIN information_schema.tables i
    ON t.table_schema = i.table_schema AND t.table_name = i.table_name
 WHERE t.grantee = 'anon'
   AND t.table_schema = 'public'
   AND i.table_type IN ('BASE TABLE', 'VIEW');
```

Expected : `0`.

- [ ] **Step 5 — Future-proof check : create a throwaway table, confirm no anon GRANT auto-applies**

```sql
CREATE TABLE public._s20_revoke_canary (id int);
SELECT count(*) AS canary_anon_grants
  FROM information_schema.role_table_grants
 WHERE grantee = 'anon' AND table_schema = 'public' AND table_name = '_s20_revoke_canary';
DROP TABLE public._s20_revoke_canary;
```

Expected : `0`. If `> 0`, the `ALTER DEFAULT PRIVILEGES` did not catch the auto-grant role — diagnose Step 1's role list and apply a corrective migration.

- [ ] **Step 6 — Author pgTAP test file (table portion ; function portion added in Phase 2.5.A)**

Create `supabase/tests/security_anon_grants.test.sql` :

```sql
-- S20 Wave 2 + 2.5 — anon GRANT defense-in-depth regression suite.
BEGIN;

SELECT plan(2);

-- A1 (Wave 2) : zero anon GRANTs remain on public base tables OR views
SELECT is_empty(
  $$ SELECT t.table_name, i.table_type
       FROM information_schema.role_table_grants t
       JOIN information_schema.tables i
         ON t.table_schema = i.table_schema AND t.table_name = i.table_name
      WHERE t.grantee = 'anon'
        AND t.table_schema = 'public'
        AND i.table_type IN ('BASE TABLE', 'VIEW') $$,
  'no anon table/view GRANTs remain on public.*'
);

-- A2 (Wave 2.5) : zero anon EXECUTE remains on public functions
-- Placeholder pass until Phase 2.5.A migration applied ; replaced inline post-2.5.
SELECT pass('A2 placeholder — Phase 2.5.A will replace with assertion');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 7 — Run pgTAP via MCP `execute_sql` ; expect 2 passes**

- [ ] **Step 8 — Golden-path smoke test on V3 dev**

Open POS → PIN login (verify EF login succeeds : auth-verify-pin uses service_role internally, anon REVOKE does not affect it). Place a small complete_order. Open BO → `/reports/sales-summary`. Verify orders list loads. Open kiosk display URL → verify orders broadcast realtime fires. Open KDS → verify station list loads.

If any of these fail, the REVOKE caught a hidden anon dependency. Stop and investigate before continuing.

- [ ] **Step 9 — Commit Phase 2.A**

```bash
git add supabase/migrations/20260524000020_revoke_anon_grants_from_public_tables.sql \
        supabase/tests/security_anon_grants.test.sql
git commit -m "$(cat <<'EOF'
fix(security): session 20 — phase 2.A — revoke anon GRANTs on public tables+views

REVOKE ALL on ~50 base tables + 4 views from anon role + ALTER DEFAULT
PRIVILEGES so future tables don't auto-grant. Defense-in-depth complement
to S13's anon-RLS sweep (which moved policies but not grants). No public.*
needs anon access in this project — EFs use service_role, client uses
authenticated via custom-fetch, kiosks use kiosk-JWT under authenticated.

Golden-path smoke green: POS login, complete_order, BO reports, kiosk
display realtime, KDS station list.

pgTAP: supabase/tests/security_anon_grants.test.sql A1 asserts zero anon
GRANTs remain on public base tables OR views. A2 (function EXECUTE) is a
placeholder, replaced in phase 2.5.A.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**DoD :**
- [ ] Migration applied on V3 dev.
- [ ] `anon_table_grants_after = 0`.
- [ ] Canary table proves auto-grant disabled.
- [ ] pgTAP A1 green (A2 placeholder).
- [ ] Golden-path smoke green.
- [ ] Commit staged.

**Complexity** : **M** (~3h, mostly in smoke verification).
**Dependencies** : Phase 1.A done (sync gate).
**Suggested executor** : lead (no subagent — single migration, small surface). Can be run in parallel with Phase 2.5.A if dispatched as subagent.

---

### Phase 2.5.A — REVOKE anon EXECUTE on public functions + ALTER DEFAULT PRIVILEGES + pgTAP

**Module(s)** : 25 (Security), cross-cutting.

**Files :**
- `supabase/migrations/20260524000030_revoke_anon_execute_from_public_functions.sql` (CREATE)
- `supabase/tests/security_anon_grants.test.sql` (MODIFY — replace A2 placeholder)

- [ ] **Step 1 — Snapshot pre-state on V3 dev**

```sql
SELECT
  count(*) FILTER (WHERE p.prosecdef) AS sec_definer_anon_executable,
  count(*) FILTER (WHERE NOT p.prosecdef) AS sec_invoker_anon_executable,
  count(*) AS total_anon_executable
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND has_function_privilege('anon', p.oid, 'EXECUTE');
```

Expected per audit : ~100 + ~1331 = ~1431. Record for post-diff.

- [ ] **Step 2 — Apply migration via MCP `apply_migration`**

`name=revoke_anon_execute_from_public_functions`, body :

```sql
-- 20260524000030_revoke_anon_execute_from_public_functions.sql
-- Session 20 / Wave 2.5 — REVOKE EXECUTE FROM anon on all public functions.
--
-- Audit 2026-05-17 found 100 SECURITY DEFINER + 1331 SECURITY INVOKER
-- functions anon-EXECUTABLE in public, including complete_order_with_payment_v9,
-- delete_user_v1, adjust_stock_v1, etc. No legitimate anon RPC consumer
-- exists in this project (auth EFs use service_role ; kiosks use kiosk-JWT
-- under authenticated). S19 set the precedent with the corrective
-- 20260523000022_fix_update_role_session_timeout_v1_revoke_anon.sql ; this
-- is the project-wide sweep.

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- Future-proof. FOR ROLE clause matches Phase 2.A discovery.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
```

If Phase 2.A surfaced multiple roles in `pg_default_acl`, append matching lines.

- [ ] **Step 3 — Verify post-state**

```sql
SELECT count(*) AS anon_executable_after
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
 WHERE n.nspname = 'public'
   AND has_function_privilege('anon', p.oid, 'EXECUTE');
```

Expected : `0`.

- [ ] **Step 4 — Future-proof check : canary function**

```sql
CREATE FUNCTION public._s20_revoke_canary_fn() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
SELECT has_function_privilege('anon', '_s20_revoke_canary_fn()'::regprocedure, 'EXECUTE') AS anon_can_execute;
DROP FUNCTION public._s20_revoke_canary_fn();
```

Expected : `anon_can_execute = false`. If `true`, `ALTER DEFAULT PRIVILEGES` did not catch — diagnose.

- [ ] **Step 5 — Replace A2 placeholder in pgTAP file**

Edit `supabase/tests/security_anon_grants.test.sql`. Replace the line `SELECT pass('A2 placeholder — Phase 2.5.A will replace with assertion');` with :

```sql
-- A2 (Wave 2.5) : zero anon EXECUTE remains on public.* functions
SELECT is_empty(
  $$ SELECT p.proname
       FROM pg_proc p
       JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public'
        AND has_function_privilege('anon', p.oid, 'EXECUTE') $$,
  'no anon function EXECUTE remains on public.*'
);
```

- [ ] **Step 6 — Run pgTAP via MCP ; expect 2 passes (A1 + A2 real)**

- [ ] **Step 7 — Function-call smoke test on V3 dev**

In addition to Phase 2.A smoke : trigger a function call from BO that exercises a SECURITY DEFINER RPC (e.g., `/inventory/adjust` → `adjust_stock_v1`). Verify RPC executes via authenticated client. Verify Supabase Realtime (KDS, customer display) still broadcasts on new order — Realtime lives in `realtime` schema, unaffected, but verify regardless.

- [ ] **Step 8 — pgTAP nightly smoke**

If pgTAP extension artifacts (`tap_funky`, `pg_all_foreign_keys`) live in public, the REVOKE may have caught them. Run a quick :

```sql
SELECT has_function_privilege('postgres', 'tap_funky()'::regprocedure, 'EXECUTE') AS postgres_can_run;
```

If pgTAP nightly cron fails next run, file as `DEV-S20-2.5.A-XX` and re-grant pgTAP-only objects.

- [ ] **Step 9 — Commit Phase 2.5.A**

```bash
git add supabase/migrations/20260524000030_revoke_anon_execute_from_public_functions.sql \
        supabase/tests/security_anon_grants.test.sql
git commit -m "$(cat <<'EOF'
fix(security): session 20 — phase 2.5.A — revoke anon EXECUTE on public functions

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon + ALTER
DEFAULT PRIVILEGES future-proofing. Audit found 1431 functions
anon-EXECUTABLE (100 SECURITY DEFINER + 1331 SECURITY INVOKER), including
complete_order_with_payment_v9, delete_user_v1, adjust_stock_v1, etc. No
legitimate anon RPC consumer exists in this project — EFs use
service_role, kiosks use kiosk-JWT under authenticated.

S19 set the precedent with a single corrective migration on
update_role_session_timeout_v1 ; this is the project-wide sweep.

Function-call smoke green: BO inventory adjust RPC, Supabase Realtime
broadcasts (KDS, customer display).

pgTAP: A2 placeholder replaced with real assertion (zero anon function
EXECUTE on public.*).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**DoD :**
- [ ] Migration applied on V3 dev.
- [ ] `anon_executable_after = 0`.
- [ ] Canary function proves auto-grant disabled.
- [ ] pgTAP A2 green (real assertion).
- [ ] Smoke (BO RPC + Realtime) green.
- [ ] Commit staged.

**Complexity** : **S** (~1.5h, smaller than 2.A — single REVOKE line + ALTER + smoke).
**Dependencies** : Phase 1.A done (sync gate). Phase 2.A done if running serially ; can be parallel with 2.A if dispatched as subagent (disjoint targets, separate pgTAP assertions).
**Suggested executor** : lead serial after 2.A is the safer default ; or subagent if parallelizing.

---

## 6. Wave 3 — DB : tighten 5 operational `authenticated USING(true)` policies

### Phase 3.A — Permission-gate 5 SELECT policies + pgTAP

**Module(s)** : 12 (Cash Register), 16 (Display), 19 (Settings), 21 (LAN), 25 (Security).

**Files :**
- `supabase/migrations/20260524000040_tighten_authenticated_select_policies.sql` (CREATE)
- `supabase/tests/security_authenticated_policies.test.sql` (CREATE)

- [ ] **Step 1 — Pre-flight : confirm permission codes exist on V3 dev**

```sql
SELECT code
  FROM public.permissions
 WHERE code IN (
   'cashier.view',
   'pos.access',
   'settings.view',
   'orders.view',
   'inventory.view',
   'reports.financial.read'
 )
 ORDER BY code;
```

Expected : at least `settings.view`, `orders.view`, `inventory.view`, `reports.financial.read` (per S13 RBAC seed). If `cashier.view` is missing, use `pos.access` as fallback for `cash_movements` (and document as DEV-S20-3.A-XX).

- [ ] **Step 2 — Confirm `has_kiosk_jwt()` helper exists**

```sql
SELECT proname, prosecdef
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
 WHERE n.nspname = 'public' AND p.proname = 'has_kiosk_jwt';
```

Expected : at least 1 row. Used by `print_queue` policy.

- [ ] **Step 3 — Apply migration via MCP `apply_migration`**

Substitute `cashier.view` → `pos.access` if Step 1 found it missing.

`name=tighten_authenticated_select_policies`, body :

```sql
-- 20260524000040_tighten_authenticated_select_policies.sql
-- Session 20 / Wave 3 — Permission-gate 5 operational SELECT policies that
-- currently use USING(true). The remaining 6 (display_screens, email_templates,
-- expense_categories, holidays, notification_templates, receipt_templates) are
-- intentionally readable by any authenticated user.

-- cash_movements : cashier reads own shift movements ; financial.read for admins
DROP POLICY IF EXISTS cash_movements_select_auth ON public.cash_movements;
CREATE POLICY cash_movements_select_auth
  ON public.cash_movements
  FOR SELECT
  TO authenticated
  USING (
    has_permission(auth.uid(), 'cashier.view')
    OR has_permission(auth.uid(), 'reports.financial.read')
  );

-- lan_devices : settings-level read
DROP POLICY IF EXISTS lan_devices_select_authenticated ON public.lan_devices;
CREATE POLICY lan_devices_select_authenticated
  ON public.lan_devices
  FOR SELECT
  TO authenticated
  USING (has_permission(auth.uid(), 'settings.view'));

-- notification_outbox : settings-level read
DROP POLICY IF EXISTS notification_outbox_select_authenticated ON public.notification_outbox;
CREATE POLICY notification_outbox_select_authenticated
  ON public.notification_outbox
  FOR SELECT
  TO authenticated
  USING (has_permission(auth.uid(), 'settings.view'));

-- print_queue : kiosk printers (kiosk-JWT) + orders.view operators
DROP POLICY IF EXISTS print_queue_select_authenticated ON public.print_queue;
CREATE POLICY print_queue_select_authenticated
  ON public.print_queue
  FOR SELECT
  TO authenticated
  USING (
    has_kiosk_jwt()
    OR has_permission(auth.uid(), 'orders.view')
  );

-- stock_reservations : inventory.view
DROP POLICY IF EXISTS stock_reservations_select_auth ON public.stock_reservations;
CREATE POLICY stock_reservations_select_auth
  ON public.stock_reservations
  FOR SELECT
  TO authenticated
  USING (has_permission(auth.uid(), 'inventory.view'));
```

- [ ] **Step 4 — Verify the 6 untouched policies still exist with USING(true)**

```sql
SELECT tablename, policyname, qual
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN (
     'display_screens', 'email_templates', 'expense_categories',
     'holidays', 'notification_templates', 'receipt_templates'
   )
   AND qual = 'true';
```

Expected : 6 rows. None of these policies should have been touched.

- [ ] **Step 5 — Verify the 5 tightened policies use permission checks**

```sql
SELECT tablename, policyname, qual
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN (
     'cash_movements', 'lan_devices', 'notification_outbox',
     'print_queue', 'stock_reservations'
   );
```

Expected : 5 rows, all with `qual` containing `has_permission` or `has_kiosk_jwt`.

- [ ] **Step 6 — Author pgTAP suite**

Create `supabase/tests/security_authenticated_policies.test.sql` :

```sql
-- S20 Wave 3 — tightened authenticated SELECT policies regression suite.
BEGIN;

SELECT plan(5);

-- A1 : cash_movements policy uses cashier.view OR reports.financial.read
SELECT ok(
  (SELECT qual ILIKE '%has_permission%cashier.view%'
      OR qual ILIKE '%has_permission%reports.financial.read%'
      OR (qual ILIKE '%has_permission%pos.access%' AND qual ILIKE '%has_permission%reports.financial.read%')
     FROM pg_policies
    WHERE schemaname='public' AND tablename='cash_movements'
      AND policyname='cash_movements_select_auth'),
  'cash_movements_select_auth is permission-gated'
);

-- A2 : lan_devices uses settings.view
SELECT ok(
  (SELECT qual ILIKE '%has_permission%settings.view%'
     FROM pg_policies
    WHERE schemaname='public' AND tablename='lan_devices'
      AND policyname='lan_devices_select_authenticated'),
  'lan_devices_select_authenticated is permission-gated'
);

-- A3 : notification_outbox uses settings.view
SELECT ok(
  (SELECT qual ILIKE '%has_permission%settings.view%'
     FROM pg_policies
    WHERE schemaname='public' AND tablename='notification_outbox'
      AND policyname='notification_outbox_select_authenticated'),
  'notification_outbox_select_authenticated is permission-gated'
);

-- A4 : print_queue allows kiosk-JWT OR orders.view
SELECT ok(
  (SELECT qual ILIKE '%has_kiosk_jwt%' AND qual ILIKE '%has_permission%orders.view%'
     FROM pg_policies
    WHERE schemaname='public' AND tablename='print_queue'
      AND policyname='print_queue_select_authenticated'),
  'print_queue_select_authenticated allows kiosk-JWT OR orders.view'
);

-- A5 : stock_reservations uses inventory.view
SELECT ok(
  (SELECT qual ILIKE '%has_permission%inventory.view%'
     FROM pg_policies
    WHERE schemaname='public' AND tablename='stock_reservations'
      AND policyname='stock_reservations_select_auth'),
  'stock_reservations_select_auth is permission-gated'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 7 — Run pgTAP via MCP ; expect 5 passes**

- [ ] **Step 8 — Live-role smoke test on V3 dev**

Manual verification with two test users :
- **ADMIN role** (`has_permission(uid, 'settings.view') = true`, `inventory.view = true`, etc.) :
  - Open BO `/settings` → lan_devices section loads
  - Open BO `/inventory/stock-reservations` → list loads
  - Open BO cash shift report → cash_movements loads
- **CASHIER role** (no `settings.view`, no `reports.financial.read`) :
  - Open BO `/settings` → expect 403 OR empty list (depending on UI gate)
  - Open POS → place order, complete with payment → cash_movements row written (RPC, bypasses RLS via SECURITY DEFINER)
  - Open POS cashier closing screen → see own shift's cash_movements (verify `pos.access` or `cashier.view` whichever is in policy works)
- **Print kiosk** (kiosk-JWT auth) :
  - Trigger an order with print → printer claims print_queue row via kiosk-JWT path

- [ ] **Step 9 — Commit Phase 3.A**

```bash
git add supabase/migrations/20260524000040_tighten_authenticated_select_policies.sql \
        supabase/tests/security_authenticated_policies.test.sql
git commit -m "$(cat <<'EOF'
fix(security): session 20 — phase 3.A — tighten 5 operational authenticated SELECT policies

Replace USING(true) with has_permission()/has_kiosk_jwt() gates on
cash_movements, lan_devices, notification_outbox, print_queue,
stock_reservations. The 6 reference-data policies (display_screens,
email_templates, expense_categories, holidays, notification_templates,
receipt_templates) intentionally remain USING(true) — any authenticated
user has legitimate read access.

Live-role smoke green: ADMIN reads all 5 tables; CASHIER blocked on
settings/financial; print kiosk claims jobs via kiosk-JWT.

pgTAP: 5 asserts (one per tightened policy) verifying qual contains
expected permission/JWT predicate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**DoD :**
- [ ] Permission codes verified pre-flight.
- [ ] Migration applied.
- [ ] 5 tightened policies have permission/JWT predicate.
- [ ] 6 reference-data policies untouched.
- [ ] pgTAP 5 passes.
- [ ] Live-role smoke green for ADMIN + CASHIER + kiosk.
- [ ] Commit staged.

**Complexity** : **M** (~2.5h, smoke is the slowest part).
**Dependencies** : Phase 2.A done (sync gate — anon REVOKE landed first to prove no anon dependency on these tables).
**Suggested executor** : lead (no subagent).

---

## 7. Wave 4 — Closeout

### Phase 4.A — Types regen + CLAUDE.md + roadmap + Status notes + PR

**Module(s)** : workplan docs + CLAUDE.md.

**Files :**
- `packages/supabase/src/types.generated.ts` (MODIFY — regen)
- `CLAUDE.md` (MODIFY — add critical pattern entry)
- `docs/workplan/backlog-by-module/00-roadmap-globale.md` (MODIFY)
- `docs/workplan/backlog-by-module/01-auth-permissions.md` (MODIFY — Status note append)
- `docs/workplan/backlog-by-module/25-security.md` (MODIFY — Status note append)
- `docs/workplan/backlog-by-module/08-customers-loyalty.md` (MODIFY — Status note append)
- `docs/workplan/plans/2026-05-17-session-20-INDEX.md` (MODIFY — fill §10 deviations, mark Phase 0.1 step 4 done)

- [ ] **Step 1 — Quality gates**

Run in parallel via Bash :

```bash
pnpm typecheck
pnpm exec turbo run test --concurrency=1
pnpm build
```

Expected : green (modulo pre-existing BO smoke flakes from DEV-S17-3.A-01 inherited through S19).

- [ ] **Step 2 — Types regen via MCP**

Call `mcp__plugin_supabase_supabase__generate_typescript_types` with `project_id=ikcyvlovptebroadgtvd`. Write the returned `types` payload to `packages/supabase/src/types.generated.ts`. RLS changes typically don't alter the type shape — verify via `git diff packages/supabase/src/types.generated.ts`. If non-empty diff, commit it.

- [ ] **Step 3 — Update CLAUDE.md "Critical patterns" section**

Find the existing block ending with "Supabase auto-grants EXECUTE on public functions to `anon`..." in CLAUDE.md "Critical patterns — don't break these". Append a new bullet :

```markdown
- **Anon GRANT defense-in-depth (S20)** — `REVOKE ALL FROM anon ON public.*` is the project-wide default for both tables and functions, future-proofed via `ALTER DEFAULT PRIVILEGES`. No public.* table, view, or function has anon GRANT/EXECUTE. EFs use service_role; clients use authenticated via custom-fetch; kiosks use kiosk-JWT under `authenticated`. If a future feature legitimately needs anon (public landing-page RPC, embeddable widget), grant explicitly per-object with a `COMMENT ON FUNCTION ... IS 'anon-callable: <reason>'`.
```

- [ ] **Step 4 — Refresh roadmap `00-roadmap-globale.md`**

Edit in place :

1. **Top priorités row #2** — change status of "Auditer & remplacer 16 RLS `anon USING(true)` par auth-only" to reflect both S13 (RLS) and S20 (GRANT defense-in-depth) closure. Reword to "DONE S13 (RLS) + S20 (GRANT defense-in-depth — tables, views, functions)" and move out of "Actifs" into the "DONE (référence)" section.

2. **Top priorités row #4** — phantom tables `system_alerts` / `customer_invoices` : mark "DONE S14 D2 decision pack ; verified absent on V3 dev S20" and move out of "Actifs".

3. **Indicateurs de santé** : add new row :
   - `anon GRANTs / EXECUTE on public.* | 0 | DONE S20 (tables + views + functions, ALTER DEFAULT PRIVILEGES future-proofed)`

4. **Cadence Sessions / Sessions complétées** : add the S20 row :
   - `S20 | 2026-05-17 | swarm/session-20 | Defense-in-depth GRANT hardening : refund_sequences RLS, anon table-GRANT sweep, anon function-EXECUTE sweep, 5 operational authenticated USING(true) policies tightened (4 migrations)`

5. **Prochains jalons** : update "Session 20+ : TBD" to "Session 21+ : TBD — triage post-S20 merge. Candidats : compliance fiscale (si PKP confirmé) | polish hardening (LAN dedup, Playwright CI) | WAC landed cost | mobile shell Capacitor | modal focus-trap migration".

- [ ] **Step 5 — Append Status notes (3 files)**

In `docs/workplan/backlog-by-module/01-auth-permissions.md` TASK-01-001 :

```markdown
**S20 update:** Defense-in-depth GRANT complement landed. S13 moved RLS policies anon→authenticated for the 5 PII tables; S20 revokes table-level anon GRANTs across all ~50 public base tables + 4 views (Wave 2) AND revokes anon EXECUTE on all 1431 public functions (Wave 2.5). ALTER DEFAULT PRIVILEGES future-proofs both. Migration block `20260524000020`/`...000030`. The "16 historic anon" item is now fully closed at both the RLS and GRANT layers.
```

In `docs/workplan/backlog-by-module/25-security.md` TASK-25-001 :

```markdown
**S20 update:** GRANT-level defense-in-depth complement. S13 closed the RLS layer; S20 closes the table/view GRANT layer (Wave 2, migration `20260524000020`) and the function EXECUTE layer (Wave 2.5, migration `20260524000030`). `pg_default_acl` re-targeted to prevent future auto-grants on new objects. Critical pattern recorded in CLAUDE.md.
```

In `docs/workplan/backlog-by-module/08-customers-loyalty.md` TASK-08-008 :

```markdown
**S20 update:** Verified absent on V3 dev (`information_schema.tables` query, 2026-05-17). Phantom table reference fully closed — D2 decision pack outcome (orders.invoice_number + view_b2b_invoices) is the canonical path. Marking [OBSOLETE] is correct.
```

- [ ] **Step 6 — Fill INDEX §10 deviations**

Edit `docs/workplan/plans/2026-05-17-session-20-INDEX.md` §10 with any deviations encountered during execution. Format :

```markdown
| DEV-S20-1.A-XX | 1.A | <severity> | <description> |
```

Severities : `informational` / `low` / `medium` / `high`. Document the actual `pg_default_acl` role discovered, any pgTAP extension re-grants needed, any permission-code substitutions made.

If no deviations : write "*No deviations — all phases executed per spec.*" in §10.

- [ ] **Step 7 — Final quality gates**

Repeat Step 1 commands. Expected : still green.

- [ ] **Step 8 — Wave 4 commit**

```bash
git add packages/supabase/src/types.generated.ts CLAUDE.md \
        docs/workplan/backlog-by-module/00-roadmap-globale.md \
        docs/workplan/backlog-by-module/01-auth-permissions.md \
        docs/workplan/backlog-by-module/25-security.md \
        docs/workplan/backlog-by-module/08-customers-loyalty.md \
        docs/workplan/plans/2026-05-17-session-20-INDEX.md
git commit -m "$(cat <<'EOF'
docs(workplan): session 20 — phase 4.A — closeout (types regen + CLAUDE.md + roadmap + Status notes)

Types regen via MCP. CLAUDE.md gains the anon-GRANT defense-in-depth
critical pattern entry (project-wide REVOKE + ALTER DEFAULT PRIVILEGES,
future-proofed for both tables and functions). Roadmap §"Top priorités"
items #2 (anon RLS audit) and #4 (phantom tables) moved to DONE
reference section. Sessions table gains the S20 row. Indicateurs gains
"anon GRANTs/EXECUTE on public.* = 0".

Status notes appended to 01-auth-permissions (TASK-01-001),
25-security (TASK-25-001), 08-customers-loyalty (TASK-08-008).

INDEX §10 deviations filled (see file for details).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 9 — Push branch + open PR**

```bash
git push -u origin swarm/session-20
gh pr create --title "session 20 — defense-in-depth GRANT hardening (refund_sequences RLS + anon REVOKE sweep + tighter authenticated policies)" --body "$(cat <<'EOF'
## Summary

Three-wave defense-in-depth GRANT hardening closing the "Supabase default permissive grants" pattern across tables, functions, and over-permissive RLS — built on S13's anon-RLS work and S19's `REVOKE-from-anon` precedent on a single function.

**Wave 1 — `refund_sequences` RLS hotfix (P0 by impact, contained to V3 dev):**
- Audit 2026-05-17 found `relrowsecurity=false` → anon could `TRUNCATE` with public anon key.
- New policy `refund_sequences_select_auth` (authenticated SELECT); writes only via `next_refund_number_v1` SECURITY DEFINER RPC.
- pgTAP `security_refund_sequences.test.sql` (3 asserts).

**Wave 2 — anon table+view GRANT sweep (~50 base tables + 4 views):**
- `REVOKE ALL ON public.<table|view> FROM anon` via DO-loop.
- `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES/SEQUENCES FROM anon` for the auto-grant role(s) discovered via `pg_default_acl`.
- pgTAP `security_anon_grants.test.sql` A1 asserts zero anon GRANTs remain.

**Wave 2.5 — anon function EXECUTE sweep (1431 functions, 100 SECURITY DEFINER + 1331 SECURITY INVOKER):**
- `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon` + `ALTER DEFAULT PRIVILEGES`.
- Project-wide sweep of the pattern that S19 patched on a single function.
- pgTAP A2 asserts zero anon EXECUTE remains.

**Wave 3 — tighten 5 operational `authenticated USING(true)` SELECT policies:**
- `cash_movements`, `lan_devices`, `notification_outbox`, `print_queue`, `stock_reservations` — replaced `USING(true)` with `has_permission()` and/or `has_kiosk_jwt()` predicates.
- 6 reference-data policies (`display_screens`, `email_templates`, `expense_categories`, `holidays`, `notification_templates`, `receipt_templates`) intentionally left at `USING(true)` (any authenticated user has legitimate read access).
- pgTAP `security_authenticated_policies.test.sql` (5 asserts).

**Wave 4 — closeout:**
- Types regen.
- CLAUDE.md gains the anon-GRANT defense-in-depth critical pattern entry.
- Roadmap §"Top priorités" items #2 + #4 moved to DONE reference.
- Status notes on TASK-01-001, TASK-25-001, TASK-08-008.

**Footprint:** 4 migrations (`20260524000010..040`), 3 pgTAP test files (~12 asserts), 0 application-code changes (DB-only).

## Test plan
- [ ] pgTAP all green via cloud MCP (`security_refund_sequences`, `security_anon_grants`, `security_authenticated_policies`).
- [ ] Golden-path smoke green on V3 dev: POS login + complete_order, BO reports + users + settings, kiosk display realtime, KDS station list, print kiosk claim.
- [ ] Live-role smoke green: ADMIN reads tightened tables; CASHIER blocked on settings/financial; kiosk-JWT claims print jobs.
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm build` green.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Return PR URL.

**DoD :**
- [ ] All quality gates green.
- [ ] Types regen committed.
- [ ] CLAUDE.md updated.
- [ ] Roadmap updated.
- [ ] 3 Status notes appended.
- [ ] INDEX §10 deviations filled.
- [ ] PR open against master.

**Complexity** : **M** (~2.5h).
**Dependencies** : 1.A, 2.A, 2.5.A, 3.A all done.
**Suggested executor** : lead (no subagent).

---

## 8. Parallelization map

| Wave | Phases | Parallel streams | Estim h (parallel) |
|---|---|---|---|
| 0 | 0.1 | sequential | 0.5 |
| 1 | 1.A | sequential | 1.5 |
| 2 + 2.5 | 2.A + 2.5.A | 2 parallel (subagent fan-out) or serial | max(3, 1.5) = 3 parallel ; 4.5 serial |
| 3 | 3.A | sequential (must follow 2.A) | 2.5 |
| 4 | 4.A | sequential | 2.5 |
| **TOTAL** | **5** | — | **~10h parallel ; ~11.5h serial** |

For this DB-heavy session, **serial execution by the lead is the suggested default** — Wave 2/2.5 parallelization saves only ~1.5h and adds dispatch overhead. Switch to subagent fan-out only if the session is being executed during a longer window where time matters.

---

## 9. Comms entre subagents (optional)

If using subagent fan-out for Wave 2/2.5 :

```
lead (Claude) ←→ table-grant-revoker     (Phase 2.A, parallel with 2.5.A)
              ←→ function-execute-revoker (Phase 2.5.A, parallel with 2.A)
              ←→ reviewer                 (between waves : 1↔2 gate, 2↔3 gate, 3↔4 gate)
```

After spawning Wave 2/2.5 parallel phases, lead WAITs (no polling — subagents `SendMessage` back when DoD met). Then runs the Wave 2/2.5 sync gate (golden-path smoke) before unblocking Wave 3.

For serial execution (default), no subagent comms : lead runs phases in order 1.A → 2.A → 2.5.A → 3.A → 4.A.

---

## 10. Deviation packs (Session 20 → Session 21+)

*Finalized post-execution Phase 4.A. All informational unless marked otherwise.*

*(Filled in during Phase 4.A Step 6 — placeholder until then.)*

| ID | Phase | Severity | Surface |
|---|---|---|---|
| `DEV-S20-X.X-XX` | — | — | *(placeholder — fill post-execution)* |

---

## 11. Out of scope (déféré Session 21+)

- The 6 reference-data `authenticated USING(true)` SELECT policies (`display_screens`, `email_templates`, `expense_categories`, `holidays`, `notification_templates`, `receipt_templates`) — intentionally permissive, by design.
- Function arg-level audits (which RPCs leak data via specific args).
- Schema-level isolation refactors (moving accounting tables to `private.` schema).
- LAN message dedup TTL 5s (D-W6-6B-02).
- Playwright E2E in CI (D-W6-6C-05).
- WAC landed cost shipping pro-rata (TASK-07-012 partial).
- Modal focus-trap migration to shadcn `Dialog` (cross-module P1).
- Mobile shell Capacitor (TASK-18-***).
- Compliance fiscale Indonésie I1/I2/I3 (blocked on PKP confirmation).
- Pre-existing 4-vs-6 PIN format mismatch fix (DEV-S19-3.B-01).
- All other S13-S19 deferred items (pg_net birthday cron, Cash Flow Investing/Financing, mv_pl_monthly reuse, staging-deploy secrets, "About to sign out" warning toast).
