# Session 19 — INDEX (Hardening polish: durable rate-limit + session timeout per role + PIN strength warn)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three P1/P2 hardening items from `01-auth-permissions.md` in one bundled session — durable Postgres-backed rate-limit (finishing S13's deferred follow-up), per-role session timeout (greenfield), and PIN strength warn (greenfield in BO + new POS self-change PIN UI).

**Architecture:** 3 independent hardening threads (A=durable rate-limit, B=session timeout per role, C=PIN strength warn) executed **phased by layer** : DB → utils+EF → UI → closeout. Phases inside a wave parallelize via subagent fan-out ; waves serialize via sync gates.

**Tech Stack:** Postgres + pg_cron + RLS, Deno Edge Functions, React + TanStack Query + Zustand stores, Vitest + pgTAP, Supabase MCP for DB ops.

**Date:** 2026-05-17
**Branch:** `swarm/session-19` (off `7239b8d` master, post-S18 merge PR #22)
**Spec:** [`../specs/2026-05-17-session-19-spec.md`](../specs/2026-05-17-session-19-spec.md)
**Migration block reserved:** `20260523000001..099`

---

## 1. Goal global

Close 3 hardening items (TASK-01-002 follow-up, TASK-01-006, TASK-01-008) bundled because they share the auth/EF/RBAC surface :

- **Thread A** — `record_rate_limit_v1` RPC + `pg_cron` purge ; wire `_shared/rate-limit.ts::checkRateLimitDurable` ; migrate 5 EFs (`auth-verify-pin`, `kiosk-issue-jwt` ×2 buckets, `refund-order`, `void-order`, `cancel-item`).
- **Thread B** — `roles.session_timeout_minutes` column + `update_role_session_timeout_v1` RPC ; `useIdleTimeout` hook in `packages/ui` ; `/settings/security` page ; mount in POS + BO.
- **Thread C** — `pin-strength.ts` util (+ Deno mirror) ; extend `auth-change-pin` response ; weak-banner in BO `UserDetailPage` ; new POS `ChangePinModal` + `SideMenuDrawer` "Change PIN" item.

**Total phases exécutables : 9** across 5 Waves (0..4).
**Effort estimé : ~18-22h solo, ~10-12h full parallel-optimized (max wave = Wave 3 with 3 parallel phases).**

---

## 2. Architecture en vagues

```
Wave 0 (planning) — Phase 0.1
  └─► Spec ✓ committed b151afc + INDEX (this doc)
        │
        ▼
Wave 1 (DB — 2 phases parallel)
  ├── Phase 1.A : record_rate_limit_v1 RPC + pg_cron rl-purge + pgTAP   [Thread A]
  └── Phase 1.B : roles.session_timeout_minutes + update RPC + pgTAP    [Thread B]
        │
        ▼ Wave 1 sync gate (typecheck + types regen NOT yet — defer to Wave 4)
Wave 2 (Utils + EF — 2 phases parallel)
  ├── Phase 2.A : wire checkRateLimitDurable + migrate 5 EFs            [Thread A]
  └── Phase 2.B : pin-strength util + Deno mirror + auth-change-pin     [Thread C]
        │
        ▼ Wave 2 sync gate
Wave 3 (UI surfaces — 3 phases parallel)
  ├── Phase 3.A : useIdleTimeout + /settings/security + auth-get-session [Thread B]
  ├── Phase 3.B : BO UserDetailPage weak banner                         [Thread C]
  └── Phase 3.C : POS ChangePinModal + SideMenuDrawer "Change PIN"      [Thread C]
        │
        ▼ Wave 3 sync gate
Wave 4 — Phase 4.A : tests + build + types regen + CLAUDE.md + roadmap refresh + Status notes + PR
```

---

## 3. Wave 0 — Prerequisites

### Phase 0.1 — Spec + INDEX + branch

**Files :**
- `docs/workplan/specs/2026-05-17-session-19-spec.md` ✓ (commit `b151afc`)
- `docs/workplan/plans/2026-05-17-session-19-INDEX.md` ✓ (this doc)

**Steps :**
- [x] Spec dated, 20 decisions D1-D20
- [x] INDEX dated, 5 waves
- [x] Branch `swarm/session-19` created off `7239b8d` (origin/master post-S18)
- [ ] INDEX committed
- [ ] Push branch to origin (any time — `git push -u origin swarm/session-19`)

**Complexity** : **S** (~1.5h, mostly done at this point).
**Suggested executor** : lead (no subagent).

---

## 4. Wave 1 — DB

### Phase 1.A — `record_rate_limit_v1` RPC + pg_cron purge + tests (Thread A)

**Module(s)** : 01 (Auth/Permissions), 25 (Security).

**Files :**
- `supabase/migrations/20260523000010_create_record_rate_limit_v1_rpc.sql` (CREATE)
- `supabase/migrations/20260523000011_schedule_rl_purge_cron.sql` (CREATE)
- `supabase/tests/record_rate_limit_v1.test.sql` (CREATE)
- `supabase/tests/functions/rate-limit-durable.test.ts` (CREATE — will fail until Phase 2.A wires the client, that's fine — keep skipped via `describe.skip` in 1.A and unskip in 2.A)

- [ ] **Step 1 — Read existing helper + table to ground signature**

Read in this order :
1. `supabase/functions/_shared/rate-limit.ts` (existing stub of `checkRateLimitDurable`, lines 88-101). The RPC signature must be callable from `getAdminClient().rpc('record_rate_limit_v1', {...})` with the arg names below.
2. `supabase/migrations/20260517000031_init_edge_function_rate_limits.sql` (table shape + indices). No DDL changes ; we reuse the existing table.

- [ ] **Step 2 — Author migration `20260523000010_create_record_rate_limit_v1_rpc.sql` (do NOT apply yet — pgTAP first)**

Write to disk only :

```sql
-- 20260523000010_create_record_rate_limit_v1_rpc.sql
-- Session 19 / Phase 1.A — Durable rate-limit primitive (Thread A).
--
-- Atomic upsert against edge_function_rate_limits (S13 migration
-- 20260517000031). Single CTE statement holds a brief row-lock on the
-- live bucket. SECURITY DEFINER ; service_role only.
--
-- Decision refs : D1 (mem + durable layered), D4 (5 EFs), D11 (svc-role only),
-- D19 (migration block 20260523000010..011 = Thread A).

CREATE OR REPLACE FUNCTION record_rate_limit_v1(
  p_function_name   TEXT,
  p_bucket_key      TEXT,
  p_ip_address      TEXT,
  p_max_per_window  INT,
  p_window_sec      INT DEFAULT 60
) RETURNS TABLE (
  allowed         BOOLEAN,
  retry_after_sec INT,
  current_count   INT
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_live_id          BIGINT;
  v_live_count       INT;
  v_live_window_end  TIMESTAMPTZ;
BEGIN
  IF p_function_name IS NULL OR length(p_function_name) = 0 THEN
    RAISE EXCEPTION 'function_name_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_bucket_key IS NULL OR length(p_bucket_key) = 0 THEN
    RAISE EXCEPTION 'bucket_key_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_max_per_window IS NULL OR p_max_per_window <= 0 THEN
    RAISE EXCEPTION 'max_per_window_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF p_window_sec IS NULL OR p_window_sec <= 0 THEN
    RAISE EXCEPTION 'window_sec_invalid' USING ERRCODE = 'P0001';
  END IF;

  -- Pick the live bucket for (function_name, bucket_key) if any.
  SELECT id, request_count, window_end
    INTO v_live_id, v_live_count, v_live_window_end
  FROM edge_function_rate_limits
  WHERE function_name = p_function_name
    AND bucket_key    = p_bucket_key
    AND window_end    > now()
  ORDER BY window_end DESC
  LIMIT 1
  FOR UPDATE;

  IF v_live_id IS NULL THEN
    -- No live bucket → open a new window with count=1.
    INSERT INTO edge_function_rate_limits
      (function_name, bucket_key, ip_address, request_count, window_start, window_end)
    VALUES
      (p_function_name, p_bucket_key, p_ip_address, 1, now(), now() + make_interval(secs => p_window_sec));
    RETURN QUERY SELECT TRUE, 0, 1;
    RETURN;
  END IF;

  IF v_live_count >= p_max_per_window THEN
    -- Bucket full → reject + report retry.
    RETURN QUERY SELECT
      FALSE,
      GREATEST(0, EXTRACT(EPOCH FROM (v_live_window_end - now()))::INT),
      v_live_count;
    RETURN;
  END IF;

  -- Bump the existing bucket.
  UPDATE edge_function_rate_limits
  SET request_count = v_live_count + 1
  WHERE id = v_live_id;

  RETURN QUERY SELECT TRUE, 0, v_live_count + 1;
END;
$$;

COMMENT ON FUNCTION record_rate_limit_v1(TEXT, TEXT, TEXT, INT, INT) IS
  'Session 19 — atomic rate-limit upsert. Called from Edge Functions via '
  'checkRateLimitDurable in _shared/rate-limit.ts. Service-role only.';

REVOKE ALL ON FUNCTION record_rate_limit_v1(TEXT, TEXT, TEXT, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_rate_limit_v1(TEXT, TEXT, TEXT, INT, INT) FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION record_rate_limit_v1(TEXT, TEXT, TEXT, INT, INT) TO service_role;
```

- [ ] **Step 3 — Author migration `20260523000011_schedule_rl_purge_cron.sql`**

```sql
-- 20260523000011_schedule_rl_purge_cron.sql
-- Session 19 / Phase 1.A — Daily purge of expired rate-limit buckets.
--
-- Decision ref : D3 (19:05 UTC, +5 min after pgTAP nightly at 19:00).

DO $$
DECLARE
  v_existing INT;
BEGIN
  -- Idempotent : drop a prior schedule with the same name if present.
  SELECT COUNT(*) INTO v_existing FROM cron.job WHERE jobname = 'rl-purge';
  IF v_existing > 0 THEN
    PERFORM cron.unschedule('rl-purge');
  END IF;

  PERFORM cron.schedule(
    'rl-purge',
    '5 19 * * *',
    $cron$DELETE FROM edge_function_rate_limits WHERE window_end < now() - interval '1 hour'$cron$
  );
END $$;

COMMENT ON EXTENSION pg_cron IS 'Used by Session 19 rl-purge job (+ pre-existing jobs if any).';
```

- [ ] **Step 4 — Write pgTAP test BEFORE applying the migration (TDD)**

Create `supabase/tests/record_rate_limit_v1.test.sql` :

```sql
BEGIN;

-- Test plan : 8 tests
SELECT plan(8);

-- Setup : a sandbox bucket key namespaced by test session.
SET LOCAL ROLE service_role;

-- 1. First call inserts and returns allowed=true, count=1.
SELECT is(
  (SELECT allowed FROM record_rate_limit_v1('test-fn', 'tkey-1', '127.0.0.1', 3, 60))::TEXT,
  'true',
  'First call → allowed=true'
);

-- 2. Second call within window bumps count to 2.
SELECT is(
  (SELECT current_count FROM record_rate_limit_v1('test-fn', 'tkey-1', '127.0.0.1', 3, 60)),
  2,
  'Second call → count=2'
);

-- 3. Third call still allowed.
SELECT is(
  (SELECT allowed FROM record_rate_limit_v1('test-fn', 'tkey-1', '127.0.0.1', 3, 60))::TEXT,
  'true',
  'Third call → still allowed (count=3 = max, but max is inclusive bound)'
);

-- 4. Fourth call (over max=3) rejected.
SELECT is(
  (SELECT allowed FROM record_rate_limit_v1('test-fn', 'tkey-1', '127.0.0.1', 3, 60))::TEXT,
  'false',
  'Fourth call → allowed=false (max exceeded)'
);

-- 5. Different bucket_key is isolated.
SELECT is(
  (SELECT allowed FROM record_rate_limit_v1('test-fn', 'tkey-2', '127.0.0.1', 3, 60))::TEXT,
  'true',
  'Different bucket_key → independent bucket'
);

-- 6. CHECK constraint : empty function_name raises P0001.
SELECT throws_ok(
  $$SELECT record_rate_limit_v1('', 'k', '1.2.3.4', 3, 60)$$,
  'P0001',
  'function_name_required',
  'Empty function_name → P0001'
);

-- 7. CHECK constraint : zero max_per_window raises P0001.
SELECT throws_ok(
  $$SELECT record_rate_limit_v1('fn', 'k', '1.2.3.4', 0, 60)$$,
  'P0001',
  'max_per_window_invalid',
  'Zero max → P0001'
);

-- 8. Cron job 'rl-purge' is registered.
SELECT is(
  (SELECT COUNT(*) FROM cron.job WHERE jobname = 'rl-purge')::INT,
  1,
  'rl-purge cron job registered'
);

-- Cleanup : delete our test rows.
DELETE FROM edge_function_rate_limits WHERE function_name = 'test-fn';

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 5 — Apply migrations via MCP**

Use `mcp__plugin_supabase_supabase__apply_migration` (project_id `ikcyvlovptebroadgtvd`) twice :
1. name = `create_record_rate_limit_v1_rpc`, body = the SQL from Step 2.
2. name = `schedule_rl_purge_cron`, body = the SQL from Step 3.

Expect : both return success. If pg_cron extension is missing on the project, run `CREATE EXTENSION IF NOT EXISTS pg_cron;` via `execute_sql` first (it should already exist on Pro plan).

- [ ] **Step 6 — Run pgTAP via MCP execute_sql**

Wrap the test file in `BEGIN; ... ROLLBACK;` (it already does). Use `mcp__plugin_supabase_supabase__execute_sql` with the contents of `supabase/tests/record_rate_limit_v1.test.sql`.

Expected output : `ok 1..8`, all tests pass.

If any test fails, fix the migration (Step 2) and re-apply via a new migration `20260523000012_fix_record_rate_limit_v1.sql` rather than mutating the existing `20260523000010` (migrations are immutable once applied).

- [ ] **Step 7 — Write Vitest live RPC test (Phase 2.A consumer, kept .skip for now)**

Create `supabase/tests/functions/rate-limit-durable.test.ts` :

```typescript
// supabase/tests/functions/rate-limit-durable.test.ts
// Session 19 / Phase 1.A — Live RPC smoke for record_rate_limit_v1.
// Note: this file is SKIPPED until Phase 2.A wires checkRateLimitDurable.

import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

describe.skip('record_rate_limit_v1 (live)', () => {
  const supabase = createClient(supabaseUrl, serviceKey);

  it('enforces max_per_window across two clients', async () => {
    const args = { p_function_name: 'vitest-fn', p_bucket_key: 'vitest-' + Date.now(), p_ip_address: '127.0.0.1', p_max_per_window: 3, p_window_sec: 60 };

    // 3 allowed
    for (let i = 0; i < 3; i++) {
      const { data, error } = await supabase.rpc('record_rate_limit_v1', args);
      expect(error).toBeNull();
      expect(data?.[0]?.allowed).toBe(true);
    }
    // 4th rejected
    const { data, error } = await supabase.rpc('record_rate_limit_v1', args);
    expect(error).toBeNull();
    expect(data?.[0]?.allowed).toBe(false);
    expect(data?.[0]?.retry_after_sec).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 8 — Commit**

```bash
git add supabase/migrations/20260523000010_create_record_rate_limit_v1_rpc.sql \
        supabase/migrations/20260523000011_schedule_rl_purge_cron.sql \
        supabase/tests/record_rate_limit_v1.test.sql \
        supabase/tests/functions/rate-limit-durable.test.ts
git commit -m "feat(db): session 19 — phase 1.A — record_rate_limit_v1 RPC + pg_cron purge + pgTAP"
```

**DoD :**
- [ ] 2 migrations applied to V3 dev (visible in `list_migrations`).
- [ ] `record_rate_limit_v1` callable from service role ; revoked from authenticated/anon.
- [ ] pgTAP 8 tests green via MCP `execute_sql`.
- [ ] `rl-purge` row exists in `cron.job`.
- [ ] Vitest live test file present but `describe.skip` (unblocked in 2.A).

**Complexity** : **M** (~3h).
**Dependencies** : none.
**Suggested executor** : `rate-limit-rpc-arch` (sql + pgTAP).
**Parallelization tag** : parallel with 1.B.

---

### Phase 1.B — `roles.session_timeout_minutes` column + RPC + tests (Thread B)

**Module(s)** : 01 (Auth/Permissions), 20 (Users/RBAC), 19 (Settings).

**Files :**
- `supabase/migrations/20260523000020_add_session_timeout_to_roles.sql` (CREATE)
- `supabase/migrations/20260523000021_create_update_role_session_timeout_v1_rpc.sql` (CREATE)
- `supabase/tests/update_role_session_timeout_v1.test.sql` (CREATE)
- `supabase/tests/functions/role-session-timeout.test.ts` (CREATE — .skip until Phase 3.A wires UI consumer)

- [ ] **Step 1 — Read existing `roles` shape + `has_permission` signature**

Read in this order :
1. `supabase/migrations/20260517000030_refactor_has_permission.sql` lines 60-95 (roles seed + permissions seed). Note role codes: `SUPER_ADMIN`, `ADMIN`, `MANAGER`, `CASHIER`, `waiter`.
2. Grep `has_permission(auth.uid()` in any recent RPC (e.g., `supabase/migrations/20260522000010_create_recipe_cost_history_v1_rpc.sql`) for the canonical permission gate pattern.
3. `audit_logs` table shape : grep `INSERT INTO audit_logs` in `supabase/functions/auth-change-pin/index.ts` (lines 80-85) for the column set we use elsewhere (`actor_id`, `action`, `entity_type`, `entity_id`).

- [ ] **Step 2 — Author migration `20260523000020_add_session_timeout_to_roles.sql`**

```sql
-- 20260523000020_add_session_timeout_to_roles.sql
-- Session 19 / Phase 1.B — Per-role session timeout (Thread B).
--
-- Decision refs : D6 (security-leaning defaults), D8 (per-role, not per-user),
-- D19 (migration block 20260523000020..021 = Thread B).

ALTER TABLE roles
  ADD COLUMN IF NOT EXISTS session_timeout_minutes INT NOT NULL DEFAULT 30
    CHECK (session_timeout_minutes BETWEEN 5 AND 480);

UPDATE roles SET session_timeout_minutes = 30  WHERE code = 'CASHIER';
UPDATE roles SET session_timeout_minutes = 30  WHERE code = 'waiter';
UPDATE roles SET session_timeout_minutes = 60  WHERE code = 'MANAGER';
UPDATE roles SET session_timeout_minutes = 120 WHERE code = 'ADMIN';
UPDATE roles SET session_timeout_minutes = 240 WHERE code = 'SUPER_ADMIN';

COMMENT ON COLUMN roles.session_timeout_minutes IS
  'Idle session timeout in minutes. Read by useIdleTimeout in apps. '
  'Editable via update_role_session_timeout_v1 RPC. Bounds: 5..480.';
```

- [ ] **Step 3 — Author migration `20260523000021_create_update_role_session_timeout_v1_rpc.sql`**

```sql
-- 20260523000021_create_update_role_session_timeout_v1_rpc.sql
-- Session 19 / Phase 1.B — Update RPC for per-role session timeout.
--
-- Gated by has_permission('settings.update') AND caller role IN ('SUPER_ADMIN','ADMIN').
-- Writes audit_logs row on every successful change (D9).

CREATE OR REPLACE FUNCTION update_role_session_timeout_v1(
  p_role_code TEXT,
  p_minutes   INT
) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_caller_role  TEXT;
  v_before       INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'P0003';
  END IF;

  -- Permission + role gate.
  IF NOT has_permission(v_uid, 'settings.update') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  SELECT r.code INTO v_caller_role
  FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = v_uid
  LIMIT 1;

  IF v_caller_role NOT IN ('SUPER_ADMIN', 'ADMIN') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = 'P0003';
  END IF;

  -- Bounds (the CHECK also catches this, but we want a friendlier error).
  IF p_minutes IS NULL OR p_minutes < 5 OR p_minutes > 480 THEN
    RAISE EXCEPTION 'invalid_minutes' USING ERRCODE = 'P0001';
  END IF;

  -- Capture before-value (also asserts the role exists).
  SELECT session_timeout_minutes INTO v_before FROM roles WHERE code = p_role_code;
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'role_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Mutate.
  UPDATE roles SET session_timeout_minutes = p_minutes WHERE code = p_role_code;

  -- Audit.
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (
    v_uid,
    'role.session_timeout_changed',
    'roles',
    p_role_code,
    jsonb_build_object('before', v_before, 'after', p_minutes)
  );

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION update_role_session_timeout_v1(TEXT, INT) IS
  'Session 19 — admin-only mutate of roles.session_timeout_minutes with audit log.';

REVOKE ALL ON FUNCTION update_role_session_timeout_v1(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_role_session_timeout_v1(TEXT, INT) TO authenticated;
```

> Note: the `audit_logs` table column set assumed above (`actor_id`, `action`, `entity_type`, `entity_id`, `payload`) matches what `auth-change-pin/index.ts` writes (lines 80-85), minus the `payload` JSONB column. If `payload` doesn't exist on `audit_logs`, drop the JSONB build in this RPC and append the before/after into the `entity_id` text in a structured format. Verify via `\d audit_logs` in MCP execute_sql before applying.

- [ ] **Step 4 — Verify `audit_logs` shape**

```sql
-- run via mcp__plugin_supabase_supabase__execute_sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'audit_logs'
ORDER BY ordinal_position;
```

If `payload` is JSONB and nullable → proceed with the RPC body as written.
If `payload` column does NOT exist → either (a) add it via a tiny migration `20260523000019_audit_logs_add_payload.sql`, or (b) rewrite the RPC to encode `{before, after}` into an existing TEXT column. Prefer (a) — clean.

- [ ] **Step 5 — Write pgTAP test (TDD)**

Create `supabase/tests/update_role_session_timeout_v1.test.sql` :

```sql
BEGIN;
SELECT plan(7);

-- 1. unauthenticated caller raises P0003.
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT update_role_session_timeout_v1('CASHIER', 60)$$,
  'P0003',
  'unauthenticated',
  'anon caller → P0003'
);

-- 2. authenticated but no settings.update perm raises P0003.
-- (Setup : create a test user with no perms, set its uid as auth.uid().)
-- Pseudo-pattern (adjust to project's pgTAP fixtures) :
--   SELECT set_test_user('00000000-0000-0000-0000-000000000099');  -- a known no-perm fixture user
--   SELECT throws_ok($$SELECT update_role_session_timeout_v1('CASHIER', 60)$$, 'P0003', 'forbidden', ...);

-- 3. bounds (4 minutes) raises P0001.
-- (Setup : promote to ADMIN.)
-- SELECT set_test_user('<known-admin-uuid>');
SELECT throws_ok(
  $$SELECT update_role_session_timeout_v1('CASHIER', 4)$$,
  'P0001',
  'invalid_minutes',
  '4 minutes → P0001'
);

-- 4. bounds (481 minutes) raises P0001.
SELECT throws_ok(
  $$SELECT update_role_session_timeout_v1('CASHIER', 481)$$,
  'P0001',
  'invalid_minutes',
  '481 minutes → P0001'
);

-- 5. nonexistent role raises P0002.
SELECT throws_ok(
  $$SELECT update_role_session_timeout_v1('NOPE', 60)$$,
  'P0002',
  'role_not_found',
  'unknown role → P0002'
);

-- 6. happy path mutates value.
SELECT update_role_session_timeout_v1('CASHIER', 45);
SELECT is(
  (SELECT session_timeout_minutes FROM roles WHERE code = 'CASHIER'),
  45,
  'CASHIER timeout updated to 45'
);

-- 7. audit log row written.
SELECT is(
  (SELECT COUNT(*)::INT FROM audit_logs
   WHERE action = 'role.session_timeout_changed'
     AND entity_id = 'CASHIER'),
  1,
  'audit log row written'
);

SELECT * FROM finish();
ROLLBACK;
```

> Tests 2 + 3 hint at a `set_test_user(uuid)` helper — this is project-specific. If no such helper exists, use `SET LOCAL "request.jwt.claims" = '{"sub":"<uuid>","role":"authenticated"}'::TEXT` pattern from existing pgTAP files (grep `SET LOCAL "request.jwt.claims"` for examples).

- [ ] **Step 6 — Apply both migrations via MCP**

`apply_migration` × 2 :
1. `add_session_timeout_to_roles` (Step 2)
2. `create_update_role_session_timeout_v1_rpc` (Step 3)

(If `audit_logs.payload` needs adding per Step 4 → that migration goes first as `20260523000019_audit_logs_add_payload.sql`.)

- [ ] **Step 7 — Run pgTAP via MCP execute_sql**

Expected : `ok 1..7`. Fix and re-migrate (`20260523000022_fix_*`) if needed.

- [ ] **Step 8 — Write Vitest live RPC test (.skip for now)**

Create `supabase/tests/functions/role-session-timeout.test.ts` :

```typescript
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

describe.skip('update_role_session_timeout_v1 (live)', () => {
  // Will be unskipped in Phase 3.A when the BO settings page consumes it.
  it('admin can update CASHIER timeout', async () => { expect(true).toBe(true); });
});
```

- [ ] **Step 9 — Commit**

```bash
git add supabase/migrations/20260523000020_add_session_timeout_to_roles.sql \
        supabase/migrations/20260523000021_create_update_role_session_timeout_v1_rpc.sql \
        supabase/tests/update_role_session_timeout_v1.test.sql \
        supabase/tests/functions/role-session-timeout.test.ts
git commit -m "feat(db): session 19 — phase 1.B — roles.session_timeout_minutes + update RPC + pgTAP"
```

**DoD :**
- [ ] 2 migrations applied to V3 dev.
- [ ] `roles.session_timeout_minutes` column exists, 5 rows seeded per the default profile (CASHIER 30, waiter 30, MANAGER 60, ADMIN 120, SUPER_ADMIN 240).
- [ ] `update_role_session_timeout_v1` RPC executable by `authenticated` ; gates verified by pgTAP.
- [ ] pgTAP 7 tests green via MCP `execute_sql`.
- [ ] Vitest stub file present (.skip).

**Complexity** : **M** (~3h).
**Dependencies** : none.
**Suggested executor** : `session-timeout-db-arch` (sql + pgTAP).
**Parallelization tag** : parallel with 1.A.

---

## 5. Wave 2 — Utils + Edge Functions

### Phase 2.A — Wire `checkRateLimitDurable` + migrate 5 EFs (Thread A)

**Module(s)** : 01 (Auth/Permissions), 02 (POS — refund/void/cancel), 17 (Tablet — kiosk-issue-jwt), 25 (Security).

**Files :**
- `supabase/functions/_shared/rate-limit.ts` (UPDATE — wire durable)
- `supabase/functions/auth-verify-pin/index.ts` (UPDATE)
- `supabase/functions/kiosk-issue-jwt/index.ts` (UPDATE)
- `supabase/functions/refund-order/index.ts` (UPDATE)
- `supabase/functions/void-order/index.ts` (UPDATE)
- `supabase/functions/cancel-item/index.ts` (UPDATE)
- `supabase/tests/functions/auth-verify-pin-rate-limit.test.ts` (EXTEND)
- `supabase/tests/functions/rate-limit-durable.test.ts` (UNSKIP — from Phase 1.A)

- [ ] **Step 1 — Read all 6 source files**

Read `_shared/rate-limit.ts` in full first (102 lines — quick). Then skim the 5 EFs to see the current `checkRateLimit(...)` call site shape. Confirm each EF already imports from `_shared/`.

- [ ] **Step 2 — Replace stub of `checkRateLimitDurable` in `_shared/rate-limit.ts`**

Open `supabase/functions/_shared/rate-limit.ts`. Replace lines 88-101 (the stub `checkRateLimitDurable` and its docstring) with :

```typescript
// ============================================================
// Durable (Postgres-backed) rate-limit — Session 19 (Phase 2.A).
// Wired to the record_rate_limit_v1 RPC (Phase 1.A migration).
//
// Layered model (D1) :
//   1) In-memory fast-fail pre-check (≤1ms). If memory says blocked, return
//      immediately without paying the DB round-trip.
//   2) Durable RPC call : atomic upsert against edge_function_rate_limits.
//      Cross-instance correct.
//
// Fail-open on DB error (D2) — losing rate-limit for one request is
// preferable to denying every caller during a transient DB outage.
// ============================================================

import { getAdminClient } from './supabase-admin.ts';

export interface DurableRateLimitArgs {
  functionName: string;
  bucketKey: string;
  ipAddress: string;
  maxPerWindow: number;
  windowSec?: number;
}

export async function checkRateLimitDurable(args: DurableRateLimitArgs): Promise<{
  allowed: boolean;
  retryAfterSec: number;
  fallback: 'memory' | 'durable';
}> {
  const { functionName, bucketKey, ipAddress, maxPerWindow, windowSec = 60 } = args;

  // Layer 1 : in-memory pre-check.
  const compositeKey = `${functionName}:${bucketKey}`;
  const memCheck = checkRateLimit(compositeKey, maxPerWindow);
  if (!memCheck.allowed) {
    return { allowed: false, retryAfterSec: memCheck.retryAfterSec, fallback: 'memory' };
  }

  // Layer 2 : durable RPC.
  try {
    const admin = getAdminClient();
    const { data, error } = await admin.rpc('record_rate_limit_v1', {
      p_function_name:  functionName,
      p_bucket_key:     bucketKey,
      p_ip_address:     ipAddress,
      p_max_per_window: maxPerWindow,
      p_window_sec:     windowSec,
    });
    if (error) throw error;
    const row = (data as Array<{ allowed: boolean; retry_after_sec: number; current_count: number }>)?.[0];
    if (!row) throw new Error('record_rate_limit_v1 returned no rows');
    return { allowed: row.allowed, retryAfterSec: row.retry_after_sec, fallback: 'durable' };
  } catch (e) {
    console.error('[rate-limit] durable check failed, falling back to memory-only', e);
    return { allowed: true, retryAfterSec: 0, fallback: 'memory' };
  }
}
```

(The in-memory `checkRateLimit` and `getClientIp` exports above stay unchanged.)

- [ ] **Step 3 — Migrate `auth-verify-pin` to durable**

Open `supabase/functions/auth-verify-pin/index.ts`. Find line 33 :

```typescript
const rl = checkRateLimit(`verify-pin:${ip}`, RATE_LIMIT_PER_MIN);
```

Replace with :

```typescript
const rl = await checkRateLimitDurable({
  functionName:  'auth-verify-pin',
  bucketKey:     `ip:${ip}`,
  ipAddress:     ip,
  maxPerWindow:  RATE_LIMIT_PER_MIN,
  windowSec:     60,
});
```

Also update the import line (if needed) so `checkRateLimitDurable` is imported from `_shared/rate-limit.ts`. The function around this call must already be `async` ; if not, mark it `async`.

- [ ] **Step 4 — Migrate `kiosk-issue-jwt` to durable (×2 buckets)**

Open `supabase/functions/kiosk-issue-jwt/index.ts`. Find lines 88 + 115 :

```typescript
const ipRL = checkRateLimit(`kiosk-jwt:ip:${ip}`, 10);
const kRL  = checkRateLimit(`kiosk-jwt:id:${kiosk_id}`, 1);
```

Replace both with their durable counterparts (D5 — both buckets stay) :

```typescript
const ipRL = await checkRateLimitDurable({
  functionName: 'kiosk-issue-jwt', bucketKey: `ip:${ip}`,         ipAddress: ip, maxPerWindow: 10, windowSec: 60,
});
// (existing if !ipRL.allowed → 429 block stays unchanged)

const kRL = await checkRateLimitDurable({
  functionName: 'kiosk-issue-jwt', bucketKey: `id:${kiosk_id}`,   ipAddress: ip, maxPerWindow: 1,  windowSec: 60,
});
```

- [ ] **Step 5 — Migrate `refund-order`, `void-order`, `cancel-item` to durable**

Same pattern, line numbers per the grep result :
- `refund-order/index.ts` line 36 : `checkRateLimit('refund-order:${ip}', 10)` → `checkRateLimitDurable({functionName: 'refund-order', bucketKey: 'ip:${ip}', ipAddress: ip, maxPerWindow: 10, windowSec: 60})`
- `void-order/index.ts` line 28 : ditto with `void-order`.
- `cancel-item/index.ts` line 32 : ditto with `cancel-item`.

- [ ] **Step 6 — Unskip + extend the live RPC test**

Open `supabase/tests/functions/rate-limit-durable.test.ts`. Replace `describe.skip` with `describe`. The cross-instance simulation already in place will now exercise the real wiring.

Open `supabase/tests/functions/auth-verify-pin-rate-limit.test.ts`. Add a new test case after the existing 3/min IP block test :

```typescript
it('enforces 3/min across two clients with the same IP header', async () => {
  // Cross-instance simulation : two separate supabase-js clients call auth-verify-pin
  // with the same x-forwarded-for header. Combined attempts above 3/min must 429
  // because the durable RPC binds them to the same bucket.
  const ip = '203.0.113.42';
  const client1 = createClient(supabaseUrl, anonKey, { global: { headers: { 'x-forwarded-for': ip } } });
  const client2 = createClient(supabaseUrl, anonKey, { global: { headers: { 'x-forwarded-for': ip } } });

  // Two attempts from each → 4 total, max=3.
  const r1 = await client1.functions.invoke('auth-verify-pin', { body: { user_id: 'nobody', pin: '000000' } });
  const r2 = await client2.functions.invoke('auth-verify-pin', { body: { user_id: 'nobody', pin: '000000' } });
  const r3 = await client1.functions.invoke('auth-verify-pin', { body: { user_id: 'nobody', pin: '000000' } });
  const r4 = await client2.functions.invoke('auth-verify-pin', { body: { user_id: 'nobody', pin: '000000' } });

  // First 3 should NOT be 429 (they may be 401 invalid_credentials — that's fine,
  // the durable RL allowed them through).
  expect(r1.error?.context?.status).not.toBe(429);
  expect(r2.error?.context?.status).not.toBe(429);
  expect(r3.error?.context?.status).not.toBe(429);
  // 4th attempt MUST be 429.
  expect(r4.error?.context?.status).toBe(429);
});
```

- [ ] **Step 7 — Deploy the 5 EFs to V3 dev**

For each EF :

```
mcp__plugin_supabase_supabase__deploy_edge_function
  project_id: ikcyvlovptebroadgtvd
  slug:       <ef-slug>
  source:     <file contents post-edit>
```

EFs to redeploy : `auth-verify-pin`, `kiosk-issue-jwt`, `refund-order`, `void-order`, `cancel-item`. Plus `_shared/rate-limit.ts` if the platform deploys `_shared` separately (Supabase EF deploy usually inlines shared via the import map ; verify by checking what the deploy tool expects — if a single `slug+source` per EF, each EF carries the shared module via the bundle).

- [ ] **Step 8 — Run live tests**

```bash
pnpm --filter @breakery/supabase test rate-limit-durable
pnpm --filter @breakery/supabase test auth-verify-pin-rate-limit
```

Expect : both green.

- [ ] **Step 9 — Commit**

```bash
git add supabase/functions/_shared/rate-limit.ts \
        supabase/functions/auth-verify-pin/index.ts \
        supabase/functions/kiosk-issue-jwt/index.ts \
        supabase/functions/refund-order/index.ts \
        supabase/functions/void-order/index.ts \
        supabase/functions/cancel-item/index.ts \
        supabase/tests/functions/rate-limit-durable.test.ts \
        supabase/tests/functions/auth-verify-pin-rate-limit.test.ts
git commit -m "feat(edge): session 19 — phase 2.A — durable rate-limit wiring in 5 EFs"
```

**DoD :**
- [ ] `_shared/rate-limit.ts::checkRateLimitDurable` calls `record_rate_limit_v1` RPC (no longer a stub).
- [ ] 5 EFs use `checkRateLimitDurable` (6 call-sites total — kiosk-issue-jwt has 2 buckets).
- [ ] Vitest cross-instance simulation green against V3 dev.
- [ ] Manual smoke : 4 PIN attempts with same x-forwarded-for header across 2 browser tabs → 4th gets HTTP 429.

**Complexity** : **M** (~4h).
**Dependencies** : Phase 1.A.
**Suggested executor** : `rate-limit-ef-coder` (deno + supabase-js + EF deploy).
**Parallelization tag** : parallel with 2.B.

---

### Phase 2.B — PIN strength util + Deno mirror + `auth-change-pin` extension (Thread C, layer 1)

**Module(s)** : 01 (Auth/Permissions), 20 (Users/RBAC).

**Files :**
- `packages/utils/src/pin-strength.ts` (CREATE)
- `packages/utils/src/__tests__/pin-strength.test.ts` (CREATE)
- `supabase/functions/_shared/pin-strength.ts` (CREATE — Deno mirror)
- `supabase/functions/auth-change-pin/index.ts` (UPDATE)
- `supabase/tests/functions/auth-change-pin-strength.test.ts` (CREATE)
- `supabase/tests/functions/_shared_pin-strength_sync.test.ts` (CREATE — drift detection)

- [ ] **Step 1 — Read auth-change-pin EF + packages/utils structure**

Read `supabase/functions/auth-change-pin/index.ts` in full (89 lines, already read once during brainstorming). Then check `packages/utils/src/` for existing exports (`ls packages/utils/src/`).

- [ ] **Step 2 — Write the pin-strength tests FIRST (TDD)**

Create `packages/utils/src/__tests__/pin-strength.test.ts` :

```typescript
import { describe, it, expect } from 'vitest';
import { evaluatePinStrength } from '../pin-strength';

describe('evaluatePinStrength', () => {
  describe('repetition', () => {
    it.each(['111111', '000000', '999999', '222222'])('detects %s', (pin) => {
      const r = evaluatePinStrength(pin);
      expect(r.weak).toBe(true);
      expect(r.reason).toBe('repetition');
    });

    it('treats 11 (too short) as not-weak', () => {
      expect(evaluatePinStrength('11')).toEqual({ weak: false, reason: null });
    });
  });

  describe('sequence', () => {
    it.each(['123456', '012345', '234567', '345678', '456789'])('detects ascending %s', (pin) => {
      expect(evaluatePinStrength(pin)).toEqual({ weak: true, reason: 'sequence' });
    });

    it.each(['654321', '987654', '543210'])('detects descending %s', (pin) => {
      expect(evaluatePinStrength(pin)).toEqual({ weak: true, reason: 'sequence' });
    });

    it('does NOT flag near-sequences like 123457', () => {
      expect(evaluatePinStrength('123457')).toEqual({ weak: false, reason: null });
    });
  });

  describe('common', () => {
    it.each(['121212', '159753', '147258', '112233', '696969'])('flags top-100 leaked PINs (%s)', (pin) => {
      const r = evaluatePinStrength(pin);
      expect(r.weak).toBe(true);
      expect(r.reason).toBe('common');
    });
  });

  describe('strong', () => {
    it.each(['285741', '936027', '472913', '601834'])('passes strong PIN %s', (pin) => {
      expect(evaluatePinStrength(pin)).toEqual({ weak: false, reason: null });
    });
  });

  describe('input guards', () => {
    it('null returns not-weak', () => {
      // @ts-expect-error : explicit null input
      expect(evaluatePinStrength(null)).toEqual({ weak: false, reason: null });
    });
    it('empty string returns not-weak', () => {
      expect(evaluatePinStrength('')).toEqual({ weak: false, reason: null });
    });
    it('non-digit characters return not-weak (defensive — invalid format)', () => {
      expect(evaluatePinStrength('abcd56')).toEqual({ weak: false, reason: null });
    });
  });
});
```

Run :
```bash
pnpm --filter @breakery/utils test pin-strength
```
Expected : **all FAIL** (module not yet defined).

- [ ] **Step 3 — Implement `pin-strength.ts`**

Create `packages/utils/src/pin-strength.ts` :

```typescript
// packages/utils/src/pin-strength.ts
// Session 19 / Phase 2.B — PIN strength evaluator (Thread C).
//
// Pure, IO-free TypeScript per CLAUDE.md domain-package convention.
// MIRROR : supabase/functions/_shared/pin-strength.ts (Deno copy ;
// kept in sync via _shared_pin-strength_sync.test.ts).
//
// Decision refs : D10 (live in utils), D12 (top-100 leaked list inlined),
// D13 (warn-only — this util has no opinion on enforce).

export type PinWeakReason = 'sequence' | 'repetition' | 'common' | null;

export interface PinStrengthResult {
  weak: boolean;
  reason: PinWeakReason;
}

const COMMON_PINS: ReadonlySet<string> = new Set([
  // Top ~100 leaked PINs (Datagenetics 2012 dataset, curated).
  // 6-digit subset (the EF requires exactly 6).
  '123456', '111111', '000000', '123123', '654321', '666666', '121212', '696969',
  '112233', '159753', '147258', '789456', '101010', '252525', '131313', '142536',
  '202020', '232323', '545454', '252627', '987654', '102030', '030303', '040404',
  '050505', '060606', '070707', '080808', '090909', '987456', '852456', '741741',
  '321321', '456789', '321654', '555555', '777777', '888888', '999999', '333333',
  '444444', '222222', '141414', '161616', '171717', '181818', '191919', '212121',
  '232425', '343434', '353535', '363636', '373737', '383838', '393939', '414141',
  '424242', '434343', '454545', '464646', '474747', '484848', '494949', '515151',
  '525252', '535353', '565656', '575757', '585858', '595959', '616161', '626262',
  '636363', '646464', '656565', '676767', '686868', '717171', '727272', '737373',
  '747474', '757575', '767676', '787878', '797979', '818181', '828282', '838383',
  '848484', '858585', '868686', '878787', '898989', '919191', '929292', '939393',
  '949494', '959595', '969696', '979797', '989898',
]);

/**
 * Evaluate a 6-digit PIN against weak-pattern heuristics.
 * Returns { weak: false, reason: null } for any input not matching format
 * (caller is responsible for format validation upstream).
 */
export function evaluatePinStrength(pin: string | null | undefined): PinStrengthResult {
  if (typeof pin !== 'string' || pin.length < 4) {
    return { weak: false, reason: null };
  }
  if (!/^\d+$/.test(pin)) {
    return { weak: false, reason: null };
  }

  // Repetition : all digits identical.
  if (/^(\d)\1+$/.test(pin)) {
    return { weak: true, reason: 'repetition' };
  }

  // Sequence : strictly +1 or -1 step throughout.
  let asc = true;
  let desc = true;
  for (let i = 1; i < pin.length; i++) {
    const a = Number(pin[i - 1]);
    const b = Number(pin[i]);
    if (b - a !== 1)  asc  = false;
    if (a - b !== 1)  desc = false;
  }
  if (asc || desc) {
    return { weak: true, reason: 'sequence' };
  }

  // Common leaked PIN.
  if (COMMON_PINS.has(pin)) {
    return { weak: true, reason: 'common' };
  }

  return { weak: false, reason: null };
}
```

Run :
```bash
pnpm --filter @breakery/utils test pin-strength
```
Expected : **all PASS**.

- [ ] **Step 4 — Export from `packages/utils/src/index.ts`**

Open `packages/utils/src/index.ts`. Add :

```typescript
export { evaluatePinStrength } from './pin-strength';
export type { PinStrengthResult, PinWeakReason } from './pin-strength';
```

- [ ] **Step 5 — Create the Deno mirror `_shared/pin-strength.ts`**

Create `supabase/functions/_shared/pin-strength.ts` — byte-identical body except for the leading comment :

```typescript
// supabase/functions/_shared/pin-strength.ts
// Session 19 / Phase 2.B — Deno mirror of packages/utils/src/pin-strength.ts.
// Keep in sync. Drift is caught by supabase/tests/functions/_shared_pin-strength_sync.test.ts.

export type PinWeakReason = 'sequence' | 'repetition' | 'common' | null;

export interface PinStrengthResult {
  weak: boolean;
  reason: PinWeakReason;
}

const COMMON_PINS: ReadonlySet<string> = new Set([
  '123456', '111111', '000000', '123123', '654321', '666666', '121212', '696969',
  '112233', '159753', '147258', '789456', '101010', '252525', '131313', '142536',
  '202020', '232323', '545454', '252627', '987654', '102030', '030303', '040404',
  '050505', '060606', '070707', '080808', '090909', '987456', '852456', '741741',
  '321321', '456789', '321654', '555555', '777777', '888888', '999999', '333333',
  '444444', '222222', '141414', '161616', '171717', '181818', '191919', '212121',
  '232425', '343434', '353535', '363636', '373737', '383838', '393939', '414141',
  '424242', '434343', '454545', '464646', '474747', '484848', '494949', '515151',
  '525252', '535353', '565656', '575757', '585858', '595959', '616161', '626262',
  '636363', '646464', '656565', '676767', '686868', '717171', '727272', '737373',
  '747474', '757575', '767676', '787878', '797979', '818181', '828282', '838383',
  '848484', '858585', '868686', '878787', '898989', '919191', '929292', '939393',
  '949494', '959595', '969696', '979797', '989898',
]);

export function evaluatePinStrength(pin: string | null | undefined): PinStrengthResult {
  if (typeof pin !== 'string' || pin.length < 4) return { weak: false, reason: null };
  if (!/^\d+$/.test(pin)) return { weak: false, reason: null };
  if (/^(\d)\1+$/.test(pin)) return { weak: true, reason: 'repetition' };

  let asc = true, desc = true;
  for (let i = 1; i < pin.length; i++) {
    const a = Number(pin[i - 1]);
    const b = Number(pin[i]);
    if (b - a !== 1) asc = false;
    if (a - b !== 1) desc = false;
  }
  if (asc || desc) return { weak: true, reason: 'sequence' };

  if (COMMON_PINS.has(pin)) return { weak: true, reason: 'common' };

  return { weak: false, reason: null };
}
```

- [ ] **Step 6 — Write the drift-detection sync test**

Create `supabase/tests/functions/_shared_pin-strength_sync.test.ts` :

```typescript
// supabase/tests/functions/_shared_pin-strength_sync.test.ts
// Session 19 / Phase 2.B — Detects drift between packages/utils/src/pin-strength.ts
// and supabase/functions/_shared/pin-strength.ts.

import { describe, it, expect } from 'vitest';
import { evaluatePinStrength as evalUtil } from '../../../packages/utils/src/pin-strength';
import { evaluatePinStrength as evalDeno } from '../../functions/_shared/pin-strength';

const SENTINELS: ReadonlyArray<string> = [
  '123456', '111111', '000000', '654321', '121212', '696969', '147258',
  '285741', '936027', '472913', '601834', 'abcd56', '', '11',
];

describe('pin-strength util/_shared sync', () => {
  for (const pin of SENTINELS) {
    it(`returns same result for "${pin || '<empty>'}"`, () => {
      const u = evalUtil(pin);
      const d = evalDeno(pin);
      expect(d).toEqual(u);
    });
  }
});
```

Run :
```bash
pnpm --filter @breakery/supabase test _shared_pin-strength_sync
```
Expected : all 14 sentinel cases pass.

- [ ] **Step 7 — Extend `auth-change-pin` EF to call the util**

Open `supabase/functions/auth-change-pin/index.ts`. Add at the top of imports :

```typescript
import { evaluatePinStrength } from '../_shared/pin-strength.ts';
```

Find line 87 (the final `return jsonResponse({ ok: true });`). Replace with :

```typescript
const strength = evaluatePinStrength(new_pin);
const responseBody: Record<string, unknown> = { ok: true, weak: strength.weak };
if (strength.weak && strength.reason) {
  responseBody.weak_reason = strength.reason;
}
return jsonResponse(responseBody);
```

- [ ] **Step 8 — Write Vitest live test for the EF**

Create `supabase/tests/functions/auth-change-pin-strength.test.ts` :

```typescript
// supabase/tests/functions/auth-change-pin-strength.test.ts
// Session 19 / Phase 2.B — Live smoke for auth-change-pin's weak flag.

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const adminId     = process.env.TEST_ADMIN_USER_ID!;  // fixture user with ADMIN role + known session

describe('auth-change-pin — strength flag', () => {
  let client: SupabaseClient;

  beforeAll(() => {
    client = createClient(supabaseUrl, serviceKey);
  });

  it('returns weak:true,reason:sequence for 123456', async () => {
    // (Test setup mirrors the existing auth-change-pin tests — reuse session bootstrap.)
    const { data } = await client.functions.invoke('auth-change-pin', {
      body: { user_id: adminId, current_pin: '654321', new_pin: '123456' },
    });
    expect(data?.ok).toBe(true);
    expect(data?.weak).toBe(true);
    expect(data?.weak_reason).toBe('sequence');
  });

  it('returns weak:false for 285741', async () => {
    const { data } = await client.functions.invoke('auth-change-pin', {
      body: { user_id: adminId, current_pin: '123456', new_pin: '285741' },
    });
    expect(data?.ok).toBe(true);
    expect(data?.weak).toBe(false);
    expect(data?.weak_reason).toBeUndefined();
  });
});
```

> Note : the test depends on a pre-existing fixture user. If the project does not yet expose `TEST_ADMIN_USER_ID`, mark this `describe.skip` and unblock in Wave 4 after fixture setup ; or use the existing `auth-change-pin` test's bootstrap (grep `supabase/tests/functions/` for any test that already authenticates a fixture user).

- [ ] **Step 9 — Deploy the EF + run tests**

Deploy `auth-change-pin` via MCP `deploy_edge_function`. Run :

```bash
pnpm --filter @breakery/utils test pin-strength
pnpm --filter @breakery/supabase test _shared_pin-strength_sync
pnpm --filter @breakery/supabase test auth-change-pin-strength
```

All green.

- [ ] **Step 10 — Commit**

```bash
git add packages/utils/src/pin-strength.ts \
        packages/utils/src/__tests__/pin-strength.test.ts \
        packages/utils/src/index.ts \
        supabase/functions/_shared/pin-strength.ts \
        supabase/functions/auth-change-pin/index.ts \
        supabase/tests/functions/auth-change-pin-strength.test.ts \
        supabase/tests/functions/_shared_pin-strength_sync.test.ts
git commit -m "feat(edge): session 19 — phase 2.B — pinStrength util + auth-change-pin extension"
```

**DoD :**
- [ ] `packages/utils` exports `evaluatePinStrength` + types.
- [ ] Deno mirror in `_shared/pin-strength.ts` exists ; sync test green (14 sentinels match).
- [ ] `auth-change-pin` deployed ; response now includes `weak: bool` and optional `weak_reason`.
- [ ] Vitest live + unit + sync tests all green.
- [ ] Existing `auth-change-pin` tests still green (backward-compat preserved per D16).

**Complexity** : **M** (~3h).
**Dependencies** : none (no DB work — pure code).
**Suggested executor** : `pin-strength-coder` (typescript + deno + EF deploy).
**Parallelization tag** : parallel with 2.A.

---

## 6. Wave 3 — UI surfaces

### Phase 3.A — `useIdleTimeout` + `/settings/security` + auth-get-session extension (Thread B)

**Module(s)** : 01 (Auth/Permissions), 02 (POS shell), 19 (Settings), 20 (Users/RBAC), 22 (Design System).

**Files :**
- `packages/ui/src/hooks/useIdleTimeout.ts` (CREATE)
- `packages/ui/src/hooks/__tests__/useIdleTimeout.test.ts` (CREATE)
- `packages/ui/src/index.ts` (UPDATE — export)
- `supabase/functions/auth-get-session/index.ts` (UPDATE — join roles + return timeout)
- `apps/pos/src/stores/authStore.ts` (UPDATE — store sessionTimeoutMinutes)
- `apps/backoffice/src/stores/authStore.ts` (UPDATE — same)
- `apps/pos/src/main.tsx` or root layout (UPDATE — mount hook)
- `apps/backoffice/src/layouts/RootLayout.tsx` or equivalent (UPDATE — mount hook)
- `apps/backoffice/src/routes/index.tsx` (UPDATE — /settings/security route)
- `apps/backoffice/src/pages/settings/SettingsHubPage.tsx` (UPDATE — drop "(Soon)")
- `apps/backoffice/src/pages/settings/security/SecuritySettingsPage.tsx` (CREATE)
- `apps/backoffice/src/pages/settings/security/__tests__/SecuritySettingsPage.smoke.test.tsx` (CREATE)
- `supabase/tests/functions/role-session-timeout.test.ts` (UNSKIP)

- [ ] **Step 1 — Write the `useIdleTimeout` test FIRST**

Create `packages/ui/src/hooks/__tests__/useIdleTimeout.test.ts` :

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIdleTimeout } from '../useIdleTimeout';

describe('useIdleTimeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires onTimeout after timeoutMinutes idle', () => {
    const onTimeout = vi.fn();
    renderHook(() => useIdleTimeout({ timeoutMinutes: 1, onTimeout }));
    expect(onTimeout).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(60_001); });
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('activity resets the timer', () => {
    const onTimeout = vi.fn();
    renderHook(() => useIdleTimeout({ timeoutMinutes: 1, onTimeout }));
    act(() => { vi.advanceTimersByTime(45_000); });
    act(() => { window.dispatchEvent(new Event('mousedown')); });
    act(() => { vi.advanceTimersByTime(45_000); });
    expect(onTimeout).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(16_000); });
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('does nothing when timeoutMinutes is 0 or falsy', () => {
    const onTimeout = vi.fn();
    renderHook(() => useIdleTimeout({ timeoutMinutes: 0, onTimeout }));
    act(() => { vi.advanceTimersByTime(600_000); });
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
```

Run, expect all FAIL (hook not defined).

- [ ] **Step 2 — Implement `useIdleTimeout.ts`**

Create `packages/ui/src/hooks/useIdleTimeout.ts` :

```typescript
// packages/ui/src/hooks/useIdleTimeout.ts
// Session 19 / Phase 3.A — Idle session timeout hook (Thread B).
//
// Mounts on POS + BO root. Listens for user activity events and signs out
// after `timeoutMinutes` of inactivity. timeoutMinutes is read from the
// current user's role (roles.session_timeout_minutes, Phase 1.B).
//
// Decision refs : D7 (lives in packages/ui), D8 (per-role authoritative).

import { useEffect, useRef } from 'react';

const DEFAULT_EVENTS: ReadonlyArray<string> = [
  'mousedown', 'keydown', 'touchstart', 'scroll',
];

export interface UseIdleTimeoutArgs {
  timeoutMinutes: number;
  onTimeout: () => void;
  events?: ReadonlyArray<string>;
}

export function useIdleTimeout({ timeoutMinutes, onTimeout, events = DEFAULT_EVENTS }: UseIdleTimeoutArgs): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTimeoutRef = useRef(onTimeout);

  useEffect(() => { onTimeoutRef.current = onTimeout; }, [onTimeout]);

  useEffect(() => {
    if (!timeoutMinutes || timeoutMinutes <= 0) return;

    const reset = (): void => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => { onTimeoutRef.current(); }, timeoutMinutes * 60_000);
    };

    reset();
    for (const ev of events) window.addEventListener(ev, reset, { passive: true });

    return (): void => {
      if (timerRef.current) clearTimeout(timerRef.current);
      for (const ev of events) window.removeEventListener(ev, reset);
    };
  }, [timeoutMinutes, events]);
}
```

Run tests : all PASS.

- [ ] **Step 3 — Export from `packages/ui`**

Open `packages/ui/src/index.ts`. Add :

```typescript
export { useIdleTimeout } from './hooks/useIdleTimeout';
export type { UseIdleTimeoutArgs } from './hooks/useIdleTimeout';
```

- [ ] **Step 4 — Extend `auth-get-session` EF to include `session_timeout_minutes`**

Open `supabase/functions/auth-get-session/index.ts`. Find the SQL query / response build. Add a JOIN on `roles` and include `session_timeout_minutes` in the response. Without seeing the exact line, the pattern looks like :

```typescript
// existing SELECT was something like :
//   .from('user_profiles').select('id, role:roles(code)').eq('id', userId)
// → replace with :
const { data, error } = await admin
  .from('user_profiles')
  .select('id, role:roles(code, session_timeout_minutes)')
  .eq('id', userId)
  .single();

// response shape extended :
return jsonResponse({
  ok: true,
  user_id: data.id,
  role_code: data.role.code,
  session_timeout_minutes: data.role.session_timeout_minutes,
  // ... other existing fields
});
```

(Use whatever shape `auth-get-session` already returns — just *add* the `session_timeout_minutes` key. Read the file first ; the JOIN may already be present without the new column.)

Deploy the EF.

- [ ] **Step 5 — Extend POS authStore + BO authStore to capture `sessionTimeoutMinutes`**

Open `apps/pos/src/stores/authStore.ts`. The store likely has a `session: { ... }` slice populated by the `auth-get-session` response. Add a `sessionTimeoutMinutes: number | null` field and a selector.

```typescript
// pos/src/stores/authStore.ts (delta)
interface AuthState {
  // ... existing
  sessionTimeoutMinutes: number | null;
}

// inside the setSession action (or wherever the session is hydrated)
set({
  // ... existing
  sessionTimeoutMinutes: response.session_timeout_minutes ?? null,
});
```

Repeat for `apps/backoffice/src/stores/authStore.ts`.

- [ ] **Step 6 — Mount `useIdleTimeout` in POS root**

Open `apps/pos/src/main.tsx` (or the highest-level component that has access to `authStore` *and* the React tree). Inside a top-level component (one component wrapper if needed) :

```tsx
import { useIdleTimeout } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore';

function App() {
  const timeoutMinutes = useAuthStore((s) => s.sessionTimeoutMinutes ?? 0);
  const signOut        = useAuthStore((s) => s.signOut);
  useIdleTimeout({ timeoutMinutes, onTimeout: signOut });
  return (/* existing root JSX */);
}
```

Mount once at the top so it's active across all routes.

Repeat for `apps/backoffice/src/layouts/RootLayout.tsx` (or the BO equivalent).

- [ ] **Step 7 — Create `SecuritySettingsPage`**

Create `apps/backoffice/src/pages/settings/security/SecuritySettingsPage.tsx` :

```tsx
// apps/backoffice/src/pages/settings/security/SecuritySettingsPage.tsx
// Session 19 / Phase 3.A — Per-role session timeout editor (Thread B).
//
// Gated by settings.update. Lists the 5 roles with an editable timeout (5-480).
// Saves via update_role_session_timeout_v1 RPC. Audit-logged server-side.

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUserPermissions } from '@/hooks/useUserPermissions';

interface Role {
  code: string;
  name: string;
  session_timeout_minutes: number;
}

export function SecuritySettingsPage(): JSX.Element {
  const perms = useUserPermissions();
  const canEdit = perms.has('settings.update');

  const qc = useQueryClient();
  const { data: roles, isLoading } = useQuery({
    queryKey: ['admin', 'roles', 'timeouts'],
    queryFn: async (): Promise<Role[]> => {
      const { data, error } = await supabase
        .from('roles')
        .select('code, name, session_timeout_minutes')
        .order('session_timeout_minutes', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const mutate = useMutation({
    mutationFn: async ({ code, minutes }: { code: string; minutes: number }) => {
      const { data, error } = await supabase.rpc('update_role_session_timeout_v1', {
        p_role_code: code,
        p_minutes:   minutes,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('Session timeout updated.');
      qc.invalidateQueries({ queryKey: ['admin', 'roles', 'timeouts'] });
    },
    onError: (e: Error) => toast.error(`Update failed : ${e.message}`),
  });

  if (isLoading) return <div className="p-6">Loading…</div>;

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-4">
      <header>
        <h1 className="text-xl font-semibold">Security &amp; PIN</h1>
        <p className="text-sm text-muted-foreground">
          Idle session timeout per role. Bounds 5-480 minutes.
        </p>
      </header>

      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-2">Role</th>
            <th className="py-2">Name</th>
            <th className="py-2">Timeout (min)</th>
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody>
          {roles?.map((r) => (
            <RoleRow key={r.code} role={r} canEdit={canEdit} onSave={(min) => mutate.mutate({ code: r.code, minutes: min })} pending={mutate.isPending} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface RoleRowProps {
  role: Role;
  canEdit: boolean;
  onSave: (minutes: number) => void;
  pending: boolean;
}
function RoleRow({ role, canEdit, onSave, pending }: RoleRowProps): JSX.Element {
  const [draft, setDraft] = useState<string>(String(role.session_timeout_minutes));
  const draftNum = Number(draft);
  const invalid  = !Number.isInteger(draftNum) || draftNum < 5 || draftNum > 480;
  const dirty    = draftNum !== role.session_timeout_minutes;

  return (
    <tr className="border-t">
      <td className="py-2 font-mono">{role.code}</td>
      <td className="py-2">{role.name}</td>
      <td className="py-2">
        <Input
          type="number"
          min={5} max={480}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="w-24"
          disabled={!canEdit}
          data-testid={`timeout-input-${role.code}`}
        />
      </td>
      <td className="py-2">
        <Button
          size="sm"
          disabled={!canEdit || !dirty || invalid || pending}
          onClick={() => onSave(draftNum)}
          data-testid={`timeout-save-${role.code}`}
        >
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </td>
    </tr>
  );
}
```

> The exact imports (`@/lib/supabase`, `@/components/ui/button`, `useUserPermissions`) may not match the project's actual paths. Before writing this file, grep an existing BO page (e.g., `ReportsIndexPage.tsx`) to see the canonical imports for supabase client + UI primitives + permissions hook.

- [ ] **Step 8 — Write smoke test for `SecuritySettingsPage`**

Create `apps/backoffice/src/pages/settings/security/__tests__/SecuritySettingsPage.smoke.test.tsx` :

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SecuritySettingsPage } from '../SecuritySettingsPage';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [
        { code: 'CASHIER',     name: 'Cashier',     session_timeout_minutes: 30 },
        { code: 'ADMIN',       name: 'Admin',       session_timeout_minutes: 120 },
      ], error: null }),
    })),
    rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
  },
}));

vi.mock('@/hooks/useUserPermissions', () => ({
  useUserPermissions: () => new Set(['settings.update']),
}));

function wrap(node: React.ReactElement): React.ReactElement {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

describe('SecuritySettingsPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the 2 mocked roles with their timeouts', async () => {
    render(wrap(<SecuritySettingsPage />));
    expect(await screen.findByText('CASHIER')).toBeInTheDocument();
    expect(screen.getByText('ADMIN')).toBeInTheDocument();
  });

  it('save button enables when input changes', async () => {
    render(wrap(<SecuritySettingsPage />));
    const input = await screen.findByTestId('timeout-input-CASHIER');
    fireEvent.change(input, { target: { value: '45' } });
    const save = screen.getByTestId('timeout-save-CASHIER');
    expect(save).not.toBeDisabled();
  });

  it('save button disabled for invalid input', async () => {
    render(wrap(<SecuritySettingsPage />));
    const input = await screen.findByTestId('timeout-input-CASHIER');
    fireEvent.change(input, { target: { value: '4' } });
    expect(screen.getByTestId('timeout-save-CASHIER')).toBeDisabled();
  });
});
```

- [ ] **Step 9 — Wire route + Sidebar/Hub tile**

Open `apps/backoffice/src/routes/index.tsx`. Add :

```tsx
import { SecuritySettingsPage } from '@/pages/settings/security/SecuritySettingsPage';

// inside the routes array :
{ path: '/settings/security', element: <SecuritySettingsPage /> },
```

Open `apps/backoffice/src/pages/settings/SettingsHubPage.tsx` line 75 (the Security & PIN tile). Remove `(Soon)` from the blurb and make the tile a real link to `/settings/security`. The blurb becomes : `'PIN policies, session timeout, 2FA placeholder.'`.

- [ ] **Step 10 — Unskip the live RPC test**

Open `supabase/tests/functions/role-session-timeout.test.ts`. Replace `describe.skip` with `describe` and flesh out :

```typescript
it('admin updates CASHIER timeout', async () => {
  // (test setup uses a known ADMIN fixture user — bootstrap similar to
  // existing rate-limit-durable.test.ts)
  const { data, error } = await adminClient.rpc('update_role_session_timeout_v1', {
    p_role_code: 'CASHIER',
    p_minutes:   45,
  });
  expect(error).toBeNull();
  expect(data).toBe(true);
  // Cleanup : reset to 30.
  await adminClient.rpc('update_role_session_timeout_v1', { p_role_code: 'CASHIER', p_minutes: 30 });
});
```

- [ ] **Step 11 — Run all tests + typecheck**

```bash
pnpm --filter @breakery/ui test useIdleTimeout
pnpm --filter @breakery/app-backoffice test SecuritySettingsPage.smoke
pnpm --filter @breakery/supabase test role-session-timeout
pnpm typecheck
```

All green.

- [ ] **Step 12 — Commit**

```bash
git add packages/ui/src/hooks/useIdleTimeout.ts \
        packages/ui/src/hooks/__tests__/useIdleTimeout.test.ts \
        packages/ui/src/index.ts \
        supabase/functions/auth-get-session/index.ts \
        apps/pos/src/stores/authStore.ts \
        apps/backoffice/src/stores/authStore.ts \
        apps/pos/src/main.tsx \
        apps/backoffice/src/layouts/RootLayout.tsx \
        apps/backoffice/src/routes/index.tsx \
        apps/backoffice/src/pages/settings/SettingsHubPage.tsx \
        apps/backoffice/src/pages/settings/security/SecuritySettingsPage.tsx \
        apps/backoffice/src/pages/settings/security/__tests__/SecuritySettingsPage.smoke.test.tsx \
        supabase/tests/functions/role-session-timeout.test.ts
git commit -m "feat(backoffice): session 19 — phase 3.A — session timeout per role (hook + page + auth-get-session)"
```

**DoD :**
- [ ] `useIdleTimeout` shipped in `packages/ui` ; unit tests green.
- [ ] `auth-get-session` returns `session_timeout_minutes` (verify with browser devtools).
- [ ] POS root mounts the hook ; idle 30 min (CASHIER) signs out — verify on V3 dev.
- [ ] BO root mounts the hook ; settings page edits per role ; toast on save.
- [ ] `/settings/security` route reachable from Settings hub (no "(Soon)").
- [ ] Audit log row written on each save (`role.session_timeout_changed`).

**Complexity** : **L** (~5h — touches 2 apps + 2 stores + 1 EF + 1 page + hook).
**Dependencies** : Phase 1.B.
**Suggested executor** : `session-timeout-ui-coder` (react + zustand + supabase).
**Parallelization tag** : parallel with 3.B + 3.C.

---

### Phase 3.B — BO `UserDetailPage` weak banner (Thread C, layer 2)

**Module(s)** : 01 (Auth/Permissions), 20 (Users/RBAC).

**Files :**
- `apps/backoffice/src/pages/users/UserDetailPage.tsx` (UPDATE)
- `apps/backoffice/src/pages/users/__tests__/UserDetailPage.smoke.test.tsx` (CREATE or UPDATE)

- [ ] **Step 1 — Read current UserDetailPage Reset PIN section**

Read `apps/backoffice/src/pages/users/UserDetailPage.tsx` lines 29-152 (PIN state + handler + JSX section). Note :
- State : `pinDraft`, `pinError`, `pinSuccess`.
- Handler : `handleResetPin()` calls a mutation (`pinReset.mutate({ user_id, new_pin: pinDraft })`).
- JSX : input + Reset PIN button + success/error messaging.

- [ ] **Step 2 — Extend state for weak feedback**

Add two state slots after `pinSuccess` :

```typescript
const [pinWeak, setPinWeak] = useState<boolean>(false);
const [pinWeakReason, setPinWeakReason] = useState<'sequence'|'repetition'|'common'|null>(null);
```

And import the util at the top :

```typescript
import { evaluatePinStrength, type PinWeakReason } from '@breakery/utils';
```

- [ ] **Step 3 — Add client-side pre-check while typing**

In the `onChange` handler for the PIN input (line ~147) :

```typescript
onChange={(e) => {
  const v = e.target.value.replace(/[^0-9]/g, '');
  setPinDraft(v);
  if (v.length >= 4) {
    const s = evaluatePinStrength(v);
    setPinWeak(s.weak);
    setPinWeakReason(s.reason);
  } else {
    setPinWeak(false);
    setPinWeakReason(null);
  }
}}
```

- [ ] **Step 4 — Show inline hint below the input**

After the `<Input>` JSX, add :

```tsx
{pinWeak && (
  <p className="text-xs italic text-amber-600" data-testid="pin-weak-hint">
    ⚠ Weak PIN ({pinWeakReason})
  </p>
)}
```

- [ ] **Step 5 — Consume EF response `weak` flag in success branch**

In `handleResetPin`'s mutation `onSuccess` (line ~47) :

```typescript
onSuccess: (response: { ok: true; weak?: boolean; weak_reason?: PinWeakReason }) => {
  setPinDraft('');
  setPinSuccess(true);
  if (response.weak) {
    setPinWeak(true);
    setPinWeakReason(response.weak_reason ?? null);
  } else {
    setPinWeak(false);
    setPinWeakReason(null);
  }
},
```

- [ ] **Step 6 — Render the post-save warning banner**

Inside the success branch JSX (find where `pinSuccess` is read for "PIN updated" message), append :

```tsx
{pinSuccess && pinWeak && (
  <div
    role="alert"
    className="mt-2 rounded border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-900"
    data-testid="pin-weak-banner"
  >
    ⚠ This PIN is weak ({pinWeakReason}). Consider a stronger PIN next time.
  </div>
)}
```

- [ ] **Step 7 — Create/extend the smoke test**

If `apps/backoffice/src/pages/users/__tests__/UserDetailPage.smoke.test.tsx` doesn't exist, create it. Otherwise extend with :

```tsx
it('shows weak hint while typing 123456', async () => {
  render(wrap(<UserDetailPage userId={MOCK_USER_ID} />));
  const input = await screen.findByPlaceholderText(/new pin/i);
  fireEvent.change(input, { target: { value: '123456' } });
  expect(await screen.findByTestId('pin-weak-hint')).toBeInTheDocument();
});

it('shows weak banner after EF returns weak:true', async () => {
  // Mock the EF call to return { ok: true, weak: true, weak_reason: 'sequence' }
  vi.mocked(pinResetMutation).mockResolvedValueOnce({ ok: true, weak: true, weak_reason: 'sequence' });
  render(wrap(<UserDetailPage userId={MOCK_USER_ID} />));
  const input = await screen.findByPlaceholderText(/new pin/i);
  fireEvent.change(input, { target: { value: '123456' } });
  fireEvent.click(screen.getByText(/reset pin/i));
  expect(await screen.findByTestId('pin-weak-banner')).toBeInTheDocument();
});

it('does NOT show weak banner for strong PIN', async () => {
  vi.mocked(pinResetMutation).mockResolvedValueOnce({ ok: true, weak: false });
  render(wrap(<UserDetailPage userId={MOCK_USER_ID} />));
  const input = await screen.findByPlaceholderText(/new pin/i);
  fireEvent.change(input, { target: { value: '285741' } });
  fireEvent.click(screen.getByText(/reset pin/i));
  await screen.findByText(/pin updated/i);
  expect(screen.queryByTestId('pin-weak-banner')).not.toBeInTheDocument();
});
```

> Adjust the mock target (`pinResetMutation`) to whatever the existing UserDetailPage uses. If the test file is being created from scratch, mirror the existing BO page test structure (look at `RecipeCostOverviewPage.smoke.test.tsx` for the wrap helper).

- [ ] **Step 8 — Run tests + typecheck**

```bash
pnpm --filter @breakery/app-backoffice test UserDetailPage.smoke
pnpm typecheck
```

- [ ] **Step 9 — Commit**

```bash
git add apps/backoffice/src/pages/users/UserDetailPage.tsx \
        apps/backoffice/src/pages/users/__tests__/UserDetailPage.smoke.test.tsx
git commit -m "feat(backoffice): session 19 — phase 3.B — PIN strength warn banner in UserDetailPage"
```

**DoD :**
- [ ] Inline weak hint appears while typing a weak PIN (`123456`).
- [ ] Yellow banner appears after submit when EF returns `weak: true`.
- [ ] No banner for strong PIN.
- [ ] 3+ smoke assertions green.

**Complexity** : **S** (~2h).
**Dependencies** : Phase 2.B.
**Suggested executor** : `pin-warn-bo-coder` (react).
**Parallelization tag** : parallel with 3.A + 3.C.

---

### Phase 3.C — POS `ChangePinModal` + `SideMenuDrawer` "Change PIN" item (Thread C, layer 3)

**Module(s)** : 02 (POS shell), 01 (Auth/Permissions), 22 (Design System).

**Files :**
- `apps/pos/src/features/auth/hooks/useChangePin.ts` (CREATE)
- `apps/pos/src/features/auth/ChangePinModal.tsx` (CREATE)
- `apps/pos/src/features/auth/__tests__/ChangePinModal.smoke.test.tsx` (CREATE)
- `apps/pos/src/features/nav/SideMenuDrawer.tsx` (UPDATE — add prop + item)
- `apps/pos/src/features/nav/__tests__/SideMenuDrawer.test.tsx` (UPDATE)
- `apps/pos/src/pages/Pos.tsx` (UPDATE — mount + state)

- [ ] **Step 1 — Read `SideMenuDrawer.tsx` + `Pos.tsx` (mount point)**

Already grepped : `SideMenuDrawer.tsx` exposes `onLogout?: () => void` (line 82, dispatched at line 235 of the file). Read both files in full to internalize the prop list + state shape.

- [ ] **Step 2 — Read existing `PinPad` component (will be reused)**

Read `apps/pos/src/features/auth/PinPad.tsx`. Identify how the parent provides callbacks (`onChange`, `onComplete`, etc.) so `ChangePinModal` can drive 3 successive steps with the same component instance.

- [ ] **Step 3 — Create `useChangePin` hook**

Create `apps/pos/src/features/auth/hooks/useChangePin.ts` :

```typescript
// apps/pos/src/features/auth/hooks/useChangePin.ts
// Session 19 / Phase 3.C — react-query mutation hook for self-change PIN.

import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { PinWeakReason } from '@breakery/utils';

export interface ChangePinArgs {
  userId: string;
  currentPin: string;
  newPin: string;
}

export interface ChangePinResult {
  ok: true;
  weak: boolean;
  weak_reason?: PinWeakReason;
}

export function useChangePin() {
  return useMutation({
    mutationFn: async ({ userId, currentPin, newPin }: ChangePinArgs): Promise<ChangePinResult> => {
      const { data, error } = await supabase.functions.invoke('auth-change-pin', {
        body: { user_id: userId, current_pin: currentPin, new_pin: newPin },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? 'change_pin_failed');
      return data as ChangePinResult;
    },
  });
}
```

- [ ] **Step 4 — Create `ChangePinModal.tsx` (3-step)**

Create `apps/pos/src/features/auth/ChangePinModal.tsx` :

```tsx
// apps/pos/src/features/auth/ChangePinModal.tsx
// Session 19 / Phase 3.C — Self-change PIN modal (Thread C).
//
// 3 steps : current → new → confirm.
// Step 2 shows live weak-PIN hint via packages/utils evaluatePinStrength.
// On success : toast ; if weak, append non-blocking warning.

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { PinPad } from '@/features/auth/PinPad';
import { useChangePin } from './hooks/useChangePin';
import { evaluatePinStrength, type PinWeakReason } from '@breakery/utils';

type Step = 'current' | 'new' | 'confirm';

export interface ChangePinModalProps {
  open: boolean;
  onClose: () => void;
  userId: string;
}

export function ChangePinModal({ open, onClose, userId }: ChangePinModalProps): JSX.Element {
  const [step, setStep] = useState<Step>('current');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  const change = useChangePin();

  const newStrength = evaluatePinStrength(newPin);

  function reset(): void {
    setStep('current');
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
    change.reset();
  }

  function handleStepComplete(pin: string): void {
    if (step === 'current') {
      setCurrentPin(pin);
      setStep('new');
    } else if (step === 'new') {
      setNewPin(pin);
      setStep('confirm');
    } else {
      setConfirmPin(pin);
      if (pin !== newPin) {
        toast.error('PINs do not match. Start over.');
        reset();
        return;
      }
      change.mutate(
        { userId, currentPin, newPin },
        {
          onSuccess: (res) => {
            const msg = res.weak
              ? `PIN updated. ⚠ This PIN is weak (${res.weak_reason}). Consider a stronger one next time.`
              : 'PIN updated.';
            toast.success(msg);
            reset();
            onClose();
          },
          onError: (e: Error) => {
            toast.error(e.message === 'invalid_current_pin' ? 'Current PIN is wrong.' : `Change failed : ${e.message}`);
            reset();
          },
        }
      );
    }
  }

  const title = step === 'current' ? 'Enter current PIN' : step === 'new' ? 'Enter new PIN' : 'Confirm new PIN';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>

        <PinPad onComplete={handleStepComplete} />

        {step === 'new' && newPin.length >= 4 && newStrength.weak && (
          <p className="text-xs italic text-amber-600" data-testid="pin-weak-hint">
            ⚠ Weak PIN ({newStrength.reason})
          </p>
        )}

        <Button variant="ghost" onClick={() => { reset(); onClose(); }} data-testid="change-pin-cancel">
          Cancel
        </Button>
      </DialogContent>
    </Dialog>
  );
}
```

> The exact import paths (`@/components/ui/dialog`, `PinPad`) may differ — verify by grepping existing modals (e.g., `apps/pos/src/features/order-history/components/RefundOrderModal.tsx`) for the canonical Dialog import.

- [ ] **Step 5 — Smoke test the modal**

Create `apps/pos/src/features/auth/__tests__/ChangePinModal.smoke.test.tsx` :

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChangePinModal } from '../ChangePinModal';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: vi.fn().mockResolvedValue({ data: { ok: true, weak: true, weak_reason: 'sequence' }, error: null }),
    },
  },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function wrap(node: React.ReactElement): React.ReactElement {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>;
}

describe('ChangePinModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders step 1 with title "Enter current PIN"', () => {
    render(wrap(<ChangePinModal open={true} onClose={vi.fn()} userId="u1" />));
    expect(screen.getByText(/enter current pin/i)).toBeInTheDocument();
  });

  // Additional flow tests depend on PinPad's onComplete trigger which is
  // component-specific ; mock PinPad if needed to fire onComplete synthetically.
  it('mocks the 3-step flow and shows weak hint at step 2', () => {
    // ... synthetic flow exercising the state transitions
  });

  it('cancel button closes the modal', () => {
    const onClose = vi.fn();
    render(wrap(<ChangePinModal open={true} onClose={onClose} userId="u1" />));
    fireEvent.click(screen.getByTestId('change-pin-cancel'));
    expect(onClose).toHaveBeenCalled();
  });
});
```

> The 3-step flow test is conditioned on how `PinPad` exposes `onComplete`. If `PinPad` doesn't accept a callback that we can synthetically fire in tests, mock it inline (`vi.mock('@/features/auth/PinPad', () => ({ PinPad: ({ onComplete }) => <button onClick={() => onComplete('123456')}>fire</button> }))`).

- [ ] **Step 6 — Add "Change PIN" item to `SideMenuDrawer`**

Open `apps/pos/src/features/nav/SideMenuDrawer.tsx`. Around line 82, add `onChangePin?: () => void` to the props interface. Around line 96, destructure in component args. Around line 231 (where Sign out lives), add a sibling item :

```tsx
{onChangePin && (
  <button
    type="button"
    className="…matching styling of sign-out…"
    onClick={() => dispatch(onChangePin)}
    data-testid="side-menu-change-pin"
  >
    Change PIN
  </button>
)}
```

> Match the visual + classname pattern of the existing Sign out item exactly. The `dispatch(onChangePin)` wrapper is the same closure pattern used by the existing `onLogout`.

- [ ] **Step 7 — Extend the SideMenu test**

Open `apps/pos/src/features/nav/__tests__/SideMenuDrawer.test.tsx`. Add :

```tsx
it('renders Change PIN item when onChangePin prop provided', () => {
  const onChangePin = vi.fn();
  render(<SideMenuDrawer open={true} onClose={vi.fn()} onChangePin={onChangePin} />);
  expect(screen.getByTestId('side-menu-change-pin')).toBeInTheDocument();
});

it('dispatches onChangePin on click', () => {
  const onChangePin = vi.fn();
  render(<SideMenuDrawer open={true} onClose={vi.fn()} onChangePin={onChangePin} />);
  fireEvent.click(screen.getByTestId('side-menu-change-pin'));
  expect(onChangePin).toHaveBeenCalled();
});
```

- [ ] **Step 8 — Wire mount in `Pos.tsx`**

Open `apps/pos/src/pages/Pos.tsx`. After the existing `setMenuOpen` state (around the other booleans like `historyOpen`/`liveSessionsOpen`), add :

```tsx
const [changePinOpen, setChangePinOpen] = useState(false);
```

Around line 166 (the `<SideMenuDrawer>` JSX), add the prop :

```tsx
onChangePin={() => setChangePinOpen(true)}
```

Below the existing modal mounts, add :

```tsx
{currentUserId && (
  <ChangePinModal
    open={changePinOpen}
    onClose={() => setChangePinOpen(false)}
    userId={currentUserId}
  />
)}
```

Add import at top :

```tsx
import { ChangePinModal } from '@/features/auth/ChangePinModal';
```

`currentUserId` should come from `useAuthStore` — find the existing selector pattern (likely `useAuthStore((s) => s.userId)`).

- [ ] **Step 9 — Run tests + typecheck + smoke**

```bash
pnpm --filter @breakery/app-pos test ChangePinModal.smoke
pnpm --filter @breakery/app-pos test SideMenuDrawer
pnpm typecheck
```

Manual smoke on V3 dev :
1. Log in as a CASHIER on POS.
2. Open SideMenuDrawer → click "Change PIN".
3. Modal opens at step 1 (Current PIN). Enter the cashier's actual PIN.
4. Step 2 (New PIN). Enter `123456` — yellow hint appears below pad.
5. Step 3 (Confirm). Re-enter `123456`.
6. Toast : "PIN updated. ⚠ This PIN is weak (sequence). Consider a stronger one next time."
7. Re-login with `123456` → still works (warn-only).

- [ ] **Step 10 — Commit**

```bash
git add apps/pos/src/features/auth/hooks/useChangePin.ts \
        apps/pos/src/features/auth/ChangePinModal.tsx \
        apps/pos/src/features/auth/__tests__/ChangePinModal.smoke.test.tsx \
        apps/pos/src/features/nav/SideMenuDrawer.tsx \
        apps/pos/src/features/nav/__tests__/SideMenuDrawer.test.tsx \
        apps/pos/src/pages/Pos.tsx
git commit -m "feat(pos): session 19 — phase 3.C — ChangePinModal + SideMenuDrawer Change PIN item"
```

**DoD :**
- [ ] POS "Change PIN" item in SideMenuDrawer dispatches.
- [ ] 3-step modal works for the happy path.
- [ ] Step 2 shows weak hint live.
- [ ] Success toast includes weak warning when EF returns `weak: true`.
- [ ] Wrong current PIN → error toast + reset to step 1.
- [ ] 5+ smoke assertions green ; SideMenu test extended.

**Complexity** : **M-L** (~4h — greenfield modal + 2 wiring points).
**Dependencies** : Phase 2.B.
**Suggested executor** : `pos-change-pin-coder` (react + react-query + modal).
**Parallelization tag** : parallel with 3.A + 3.B.

---

## 7. Wave 4 — Closeout

### Phase 4.A — Tests + build + types regen + CLAUDE.md + roadmap + Status notes + PR

**Files :**
- `packages/supabase/src/types.generated.ts` (UPDATE — regen)
- `CLAUDE.md` (UPDATE — workplan pointer)
- `docs/workplan/backlog-by-module/00-roadmap-globale.md` (UPDATE — drop done items, add S19 row)
- `docs/workplan/backlog-by-module/01-auth-permissions.md` (UPDATE — S19 Status notes ×3)

- [ ] **Step 1 — Full local quality gates**

```bash
pnpm typecheck                                      # turbo run typecheck
pnpm exec turbo run test --concurrency=1           # full test suite
pnpm build                                          # production build
```

All green (modulo the pre-existing 10 BO smoke flakes from DEV-S17-3.A-01).

- [ ] **Step 2 — pgTAP nightly suites via MCP**

Run via `mcp__plugin_supabase_supabase__execute_sql` (wrapped in `BEGIN; … ROLLBACK;`) :
- `supabase/tests/record_rate_limit_v1.test.sql` (8 tests)
- `supabase/tests/update_role_session_timeout_v1.test.sql` (7 tests)
- S17/S18 regression suites :
  - `supabase/tests/recipe_cost_history_v1.test.sql`
  - `supabase/tests/recipe_cascade_snapshot.test.sql`
  - `supabase/tests/recipe_bom_full_v1.test.sql`

All green.

- [ ] **Step 3 — Types regen**

```
mcp__plugin_supabase_supabase__generate_typescript_types
  project_id: ikcyvlovptebroadgtvd
```

Write the returned `types` to `packages/supabase/src/types.generated.ts`. Verify the two new RPCs appear (`record_rate_limit_v1`, `update_role_session_timeout_v1`) and `roles.session_timeout_minutes` is present.

```bash
pnpm typecheck
```

Green.

- [ ] **Step 4 — Update CLAUDE.md « Active Workplan »**

Open `CLAUDE.md`. Find the « Active Workplan » block (lines ~12-35 currently). Apply :

- Demote S18 to "Previous session" pointer, S19 becomes "Current session" with merge note.
- Move S17 to historical reference rank (already done in S18 closeout — verify).
- List S19 follow-ups (DEV-S19-… anticipated in spec §6 ; finalize after execution).
- Update "Migration sequence active" line : S19 used `20260523000010..021` block (4 migrations applied + 0/1 corrective).

- [ ] **Step 5 — Refresh `00-roadmap-globale.md`**

Open `docs/workplan/backlog-by-module/00-roadmap-globale.md`. Apply :

1. Update header date to `2026-05-17`.
2. In Top priorités cross-modules → Actifs : **DELETE** row 2 (rate limiting) and row 3 (RLS anon). Renumber remaining rows.
3. Add to "Top 10 historique — items DONE (référence)" :
   - `~~Rate limiting durable Postgres backstop~~ → **DONE S13+S19** TASK-01-002 (in-memory S13, Postgres-backed S19)`
   - (RLS anon was already mentioned implicitly ; ensure the audit P1-01 mention is annotated DONE S13.)
4. Update « Ce qui reste » section : remove "rate limiting" mention from item 2 (Hardening résiduel).
5. Add S19 row to "Cadence Sessions → Sessions complétées" table :
   - `| S19 | 2026-05-17 | swarm/session-19 | Hardening polish : durable rate-limit + session timeout per role + PIN strength warn (14-16 commits, 4 migrations) |`
6. Update "Cadence prévisionnelle → Session 19" placeholder to "Session 20+ : TBD" with candidates from the residual backlog.

- [ ] **Step 6 — Append Status notes to `01-auth-permissions.md`**

Open `docs/workplan/backlog-by-module/01-auth-permissions.md`. For each task, append a new line under the existing `**Status note (…)**` (append-only — do NOT rewrite existing notes) :

- **TASK-01-002** — append :
  > **S19 update:** Durable Postgres-backed rate-limit completes the Phase 1.B follow-up. New RPC `record_rate_limit_v1` (migration `20260523000010`) + pg_cron `rl-purge` (migration `20260523000011`) + `checkRateLimitDurable` now actually calls the RPC + 5 EFs migrated (`auth-verify-pin`, `kiosk-issue-jwt` ×2 buckets, `refund-order`, `void-order`, `cancel-item`). Cross-instance correctness verified via Vitest live RPC + manual smoke (4 PIN attempts across 2 browser tabs → 4th gets 429).

- **TASK-01-006** — append (transition `[TODO]` → `[DONE]`) :
  > **S19 update:** DONE. `roles.session_timeout_minutes INT NOT NULL DEFAULT 30 CHECK (5..480)` + per-role seed (CASHIER 30, waiter 30, MANAGER 60, ADMIN 120, SUPER_ADMIN 240). `update_role_session_timeout_v1` RPC gated `settings.update` + admin role + audit log. `useIdleTimeout` hook in `packages/ui` mounted in POS + BO. `/settings/security` page wires the existing `(Soon)` tile.

- **TASK-01-008** — append (transition `[TODO]` → `[DONE]` partial) :
  > **S19 update:** DONE (warn-only mode per D13). `evaluatePinStrength` util in `packages/utils` + Deno mirror in `_shared/pin-strength.ts` (drift detected by sync test). `auth-change-pin` EF extends response with `{ weak: bool, weak_reason? }`. Surfaces : BO `UserDetailPage` Reset PIN section (banner + inline hint) and POS `ChangePinModal` (greenfield 3-step modal + SideMenuDrawer "Change PIN" item). `pos_config.enforce_strong_pin` deferred to a future session.

- [ ] **Step 7 — Update task title statuses**

In `01-auth-permissions.md`, change H3 suffix tokens :
- TASK-01-006 `[TODO]` → `[DONE]`
- TASK-01-008 `[TODO]` → `[DONE]`

(TASK-01-002 was already `[DONE]` per S13 ; the new note refines, not transitions.)

- [ ] **Step 8 — Final commit + push + open PR**

```bash
git add packages/supabase/src/types.generated.ts \
        CLAUDE.md \
        docs/workplan/backlog-by-module/00-roadmap-globale.md \
        docs/workplan/backlog-by-module/01-auth-permissions.md
git commit -m "docs(workplan): session 19 — phase 4.A — closeout (types regen + CLAUDE.md + roadmap + Status notes)"
git push -u origin swarm/session-19
```

Open PR :

```bash
gh pr create --title "Session 19 — Hardening polish: durable rate-limit + session timeout + PIN strength warn" --body "$(cat <<'EOF'
## Summary

Three-thread hardening session closing TASK-01-002 follow-up + TASK-01-006 + TASK-01-008.

**Thread A — Durable rate-limit (finishes S13's deferred Phase 1.B):**
- New SECURITY DEFINER RPC `record_rate_limit_v1` (atomic upsert against S13's `edge_function_rate_limits` table).
- New pg_cron job `rl-purge` daily at 19:05 UTC.
- Wired `checkRateLimitDurable` (was a stub since S13) ; 5 EFs migrated (`auth-verify-pin`, `kiosk-issue-jwt` ×2 buckets, `refund-order`, `void-order`, `cancel-item`). In-memory stays as fast pre-check (layered defense, fail-open on DB error).

**Thread B — Session timeout per role (TASK-01-006):**
- New `roles.session_timeout_minutes INT NOT NULL DEFAULT 30 CHECK (5..480)` ; seeded per role profile (CASHIER 30, waiter 30, MANAGER 60, ADMIN 120, SUPER_ADMIN 240).
- New RPC `update_role_session_timeout_v1` (admin-gated, audit-logged).
- New `useIdleTimeout` hook in `packages/ui`, mounted in POS + BO roots.
- New `/settings/security` page wires the existing `(Soon)` tile in Settings hub.
- `auth-get-session` EF extended to return `session_timeout_minutes`.

**Thread C — PIN strength warn (TASK-01-008, warn-only):**
- New `evaluatePinStrength` util in `packages/utils` (repetition / sequence / top-100 leaked) + Deno mirror with cross-package drift test.
- `auth-change-pin` EF response extended : `{ ok, weak, weak_reason? }` (backward compatible).
- BO `UserDetailPage` Reset PIN section : yellow banner on weak + live inline hint while typing.
- POS : new greenfield `ChangePinModal` (3-step) + "Change PIN" item in `SideMenuDrawer` ; `useChangePin` hook.

## Footprint

- 4 migrations (block `20260523000010..021`).
- 2 new RPCs, 1 pg_cron job.
- 5 EFs migrated to durable rate-limit, 2 EFs response-extended (`auth-change-pin`, `auth-get-session`).
- 1 new BO page (`/settings/security`), 1 new POS modal (`ChangePinModal`).
- New `useIdleTimeout` hook (`packages/ui`), new `pin-strength` util (`packages/utils`).
- pgTAP : 8 tests (record_rate_limit_v1) + 7 tests (update_role_session_timeout_v1).
- Vitest : cross-instance RL simulation + EF weak-flag smoke + util/_shared sync test.

## Test plan

- [ ] `pnpm typecheck` green.
- [ ] `pnpm exec turbo run test --concurrency=1` green (modulo pre-existing 10 BO smoke flakes from DEV-S17-3.A-01).
- [ ] `pnpm build` green.
- [ ] pgTAP green via cloud MCP (both new test files + S17/S18 regression).
- [ ] Manual smoke on V3 dev :
  - 4 `auth-verify-pin` from same IP across 2 browser tabs → 4th 429.
  - CASHIER login + 30 min idle → auto-logout. Change CASHIER timeout to 5 via `/settings/security`, re-login, idle 5 min → auto-logout.
  - POS self-change PIN to `123456` → success toast with weak warning.
  - BO reset another user's PIN to `000000` → success banner with weak warning.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Return PR URL.

**DoD :**
- [ ] All quality gates green.
- [ ] Types regen committed.
- [ ] CLAUDE.md, roadmap, 01-auth-permissions Status notes updated.
- [ ] PR open against master.

**Complexity** : **S-M** (~2.5h).
**Dependencies** : 3.A, 3.B, 3.C all done.

---

## 8. Parallelization map

| Wave | Phases | Parallel streams | Estim h (parallel) |
|---|---|---|---|
| 0 | 0.1 | sequential | 1.5 |
| 1 | 1.A + 1.B parallel | 2 parallel | max(3, 3) = 3 |
| 2 | 2.A + 2.B parallel | 2 parallel | max(4, 3) = 4 |
| 3 | 3.A + 3.B + 3.C parallel | 3 parallel | max(5, 2, 4) = 5 |
| 4 | 4.A | sequential | 2.5 |
| **TOTAL** | **9** | **5 waves** | **~16h** (full parallel-optimized, ~21h solo) |

---

## 9. Comms entre subagents

```
lead (Claude) ←→ rate-limit-rpc-arch       (Phase 1.A, parallel with 1.B)
              ←→ session-timeout-db-arch   (Phase 1.B, parallel with 1.A)
              ←→ rate-limit-ef-coder       (Phase 2.A, parallel with 2.B)
              ←→ pin-strength-coder        (Phase 2.B, parallel with 2.A)
              ←→ session-timeout-ui-coder  (Phase 3.A, parallel with 3.B + 3.C)
              ←→ pin-warn-bo-coder         (Phase 3.B, parallel with 3.A + 3.C)
              ←→ pos-change-pin-coder      (Phase 3.C, parallel with 3.A + 3.B)
              ←→ reviewer                  (between waves : 1↔2 gate, 2↔3 gate, 3↔4 gate)
```

After spawning a wave's parallel phases, lead WAITs (no polling — subagents `SendMessage` back when phase DoD met). Then runs the Wave gate (typecheck + lint + targeted tests) before unblocking the next wave.

---

## 10. Deviation packs (Session 19 → Session 20+)

*Filled during execution. Anticipated buckets (from spec §6) :*

| ID (anticipated) | Phase | Severity | Surface |
|---|---|---|---|
| `DEV-S19-1.A-01` | 1.A | informational | RPC holds a row-lock during upsert ; under sustained attack volume (≥100 req/sec on the same bucket) attacker + defender requests serialize on the same bucket. Inconsequential at Breakery's traffic. |
| `DEV-S19-1.A-02` | 1.A | informational | Fail-open on DB error is a deliberate trade-off (D2). Investigate pool sizing before reconsidering fail-closed. |
| `DEV-S19-1.B-01` | 1.B | informational | `roles.session_timeout_minutes` is read once at session start ; changing it doesn't kick already-logged-in users until next login. |
| `DEV-S19-2.B-01` | 2.B | informational | `pin-strength.ts` duplicated in `packages/utils` and `supabase/functions/_shared`. Sync test catches drift but doesn't prevent it ; consider build-time copy in S20+. |
| `DEV-S19-2.B-02` | 2.B | informational | Top-100 leaked PIN list inlined as a literal array. Manual refresh cadence. |
| `DEV-S19-3.A-01` | 3.A | informational | `useIdleTimeout` fires `signOut()` immediately ; no "you are about to be signed out" warning toast. |
| `DEV-S19-3.B-01` | 3.B | informational | Pre-existing : `UserDetailPage` validates 4-8 digits, EF requires exactly 6. One-line regex fix for S20+. |
| `DEV-S19-3.C-01` | 3.C | informational | POS `ChangePinModal` mounts in `Pos.tsx` only ; tablet ordering shell + KDS don't expose self-change. |

---

## 11. Out of scope (déféré Session 20+)

- `pos_config.enforce_strong_pin` setting (warn-only is S19 scope).
- 2FA admin / TOTP (TASK-01-010).
- POS PIN-change for *another* user (admin override on POS device) — BO is canonical.
- "About to sign out" warning toast before idle timeout.
- Pre-existing 4-vs-6 PIN format mismatch fix (DEV-S19-3.B-01).
- Phantom tables verification (`system_alerts`, `customer_invoices`).
- WAC landed cost shipping pro-rata (TASK-07-012).
- Mobile shell Capacitor (TASK-18-***).
- Modal focus traps migration to shadcn Dialog.
- Compliance fiscale Indonésie (blocked on PKP confirmation).
- All other S13-S18 deferred items (Playwright CI, pg_net birthday cron, Cash Flow Investing/Financing, mv_pl_monthly reuse, staging-deploy secrets).

---

*INDEX écrit 2026-05-17 sur `swarm/session-19` par lead. Spec : [`../specs/2026-05-17-session-19-spec.md`](../specs/2026-05-17-session-19-spec.md). Brainstorm + design via `superpowers:brainstorming` (5 clarifying Qs + 4 design-section approvals). Plan via `superpowers:writing-plans`.*
