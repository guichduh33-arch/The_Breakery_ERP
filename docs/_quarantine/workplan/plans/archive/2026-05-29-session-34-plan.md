> 🗄️ **ARCHIVED / SUPERSEDED (banner added 2026-06-12).** This draft numbered the POS Critical Fixes as **Session 34** before the **Station Ticket Printing** track took the S34 slot (merged PR #54/#56). Never executed under this scope (no INDEX). Les findings se sont dissous ailleurs : **F-002/F-008 → S36** (PR #68), **F-006 PIN-en-body → PR #53**, **F-004 receipt/drawer → S35/S35a** (PR #62/#61), **F-001 Option B (draft-order RPCs) → abandonné** — le S35 INDEX l'acte comme « S34 draft-RPC myth » (DEV-S35-PLAN-01) ; les held orders ont shippé en Option A (`orders.is_held`, S35). Kept verbatim for history — do not act on the session number.

# Session 34 — POS Critical Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each Wave is isolated → one subagent per Task, parallelizable per Wave. Waves 3, 4, 5 are **independent** of Waves 1-2 and of each other → fully parallelizable.

**Goal:** Fermer les 4 dettes critiques POS de l'audit 2026-05-28 (F-001 Send-to-Kitchen no-op, F-002 enum drift, F-004 receipt/drawer fraud risk, F-006 PIN-en-body) + le durcissement F-008 anon + 3 minor (F-016/017/018).

**Architecture:** F-001 réutilise l'infra checkout existante `pickedUpOrderId → pay_existing_order_v6` (`useCheckout.ts:66`) en ajoutant 2 RPCs de persistance draft-order (`create_draft_order_with_items_v1` + `append_draft_order_items_v1`, mirror de `create_tablet_order_v2`) + un helper interne `_insert_draft_order_items`. Les autres findings sont des fixes ciblés indépendants. DB-first sur Supabase cloud V3 dev, puis wiring POS/EF, puis sweep tests.

**Tech Stack:** PostgreSQL 15 + plpgsql (Supabase cloud `ikcyvlovptebroadgtvd`), pgTAP via MCP, Deno Edge Functions, React 18 + @tanstack/react-query + Zustand, TypeScript monorepo pnpm/turbo, Vitest + @testing-library/react.

**Spec:** [`../specs/2026-05-29-session-34-spec.md`](../specs/2026-05-29-session-34-spec.md)

**Source audit:** [`docs/audit/archive/2026-05-28-pos-audit.md`](../../../audit/archive/2026-05-28-pos-audit.md)

**Branch:** `swarm/session-34` (créée depuis `master` post-merge S33)

---

## Wave 0 — Plan + spec commit

### Task 0.1 : Commit spec & plan

- [ ] **Step 1: Stage and commit**

```bash
git add docs/workplan/specs/2026-05-29-session-34-spec.md docs/workplan/plans/2026-05-29-session-34-plan.md
git commit -m "docs(s34): wave 0 — spec + plan session 34 (POS critical fixes)"
```

---

## Wave 1 — DB layer (F-001 draft RPCs + F-008 REVOKE)

> Depends on S33 helper `_recalc_order_totals`. All migrations via `mcp__plugin_supabase_supabase__apply_migration` (`project_id='ikcyvlovptebroadgtvd'`). **NEVER** Docker.

### Task 1.A : Schema discovery (read-only)

**Files:** none. Verification only.

- [ ] **Step 1: Confirm `_recalc_order_totals` exists (S33 dependency)**

`mcp__plugin_supabase_supabase__execute_sql`:
```sql
SELECT proname FROM pg_proc WHERE proname = '_recalc_order_totals';
```
Expected: 1 row. **If 0 rows** (S33 not merged): create it first as migration `20260619000009_create_recalc_order_totals_helper.sql` copying the body from S33 spec §3.3, then continue.

- [ ] **Step 2: Read `create_tablet_order_v2` body (the mirror source)**

```bash
cat supabase/migrations/20260602000011_bump_create_tablet_order_v2.sql
```
Note: exact `order_items` columns inserted, how `is_locked`/`sent_to_kitchen_at`/`kitchen_status` are set, dispatch_station resolution, modifiers handling, idempotency replay pattern. The two new RPCs mirror this structure.

- [ ] **Step 3: Verify `pay_existing_order_v6` stock behaviour (R-S34-2 / R-S34-3)**

```sql
SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'pay_existing_order_v6';
```
Confirm whether it INSERTs `stock_movements` for the order's items. **Record the answer** — it decides whether `_insert_draft_order_items` must skip stock (it must, to avoid double-decrement; spec decision R-S34-2). If `pay_existing_order_v6` does NOT decrement stock for pre-persisted items, flag a deviation (DEV-S34-1.A-xx) and plan a corrective.

- [ ] **Step 4: Check `order_items` realtime publication (decides `_017`)**

```sql
SELECT tablename FROM pg_publication_tables
WHERE pubname='supabase_realtime' AND tablename='order_items';
```
Expected: 1 row (tablet KDS flow works → already published). If 0 rows → migration `_017` required.

- [ ] **Step 5: Check `order_items` NOT NULL / defaults for safe INSERT**

```sql
SELECT column_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='order_items'
ORDER BY ordinal_position;
```
Record any NOT NULL column without default (must be populated by the helper INSERT).

- [ ] **Step 6: If any discovery diverges from spec, edit spec §3 then commit**

```bash
# only if spec corrected:
git add docs/workplan/specs/2026-05-29-session-34-spec.md
git commit -m "docs(s34): wave 1.A — spec corrections post schema discovery"
```

---

### Task 1.B : `draft_order_idempotency_keys` table

**Files:** Create `supabase/migrations/20260619000010_create_draft_order_idempotency_keys_table.sql`

- [ ] **Step 1: Write migration**

```sql
-- 20260619000010_create_draft_order_idempotency_keys_table.sql
-- Session 34 / Wave 1.B — dedicated idempotency table for draft-order RPCs.
-- Mirror of tablet_order_idempotency_keys (S25). PK = client_uuid.

CREATE TABLE IF NOT EXISTS public.draft_order_idempotency_keys (
  client_uuid UUID PRIMARY KEY,
  order_id    UUID NOT NULL,
  result      JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.draft_order_idempotency_keys ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.draft_order_idempotency_keys FROM anon, authenticated, PUBLIC;
GRANT SELECT ON public.draft_order_idempotency_keys TO authenticated;

COMMENT ON TABLE public.draft_order_idempotency_keys IS
  'S34 — idempotency keys for create_draft_order_with_items_v1 / append_draft_order_items_v1. PK client_uuid, replay returns stored result.';
```

- [ ] **Step 2: Apply via MCP `apply_migration`** (`name='create_draft_order_idempotency_keys_table'`). Expected: success.

- [ ] **Step 3: Verify**
```sql
SELECT to_regclass('public.draft_order_idempotency_keys');
```
Expected: non-null.

- [ ] **Step 4: Commit**
```bash
git add supabase/migrations/20260619000010_create_draft_order_idempotency_keys_table.sql
git commit -m "feat(db): s34 wave 1.B — draft_order_idempotency_keys table"
```

---

### Task 1.C : `_insert_draft_order_items` helper

**Files:** Create `supabase/migrations/20260619000011_create_insert_draft_order_items_helper.sql`

**Why:** DRY the order_items INSERT loop shared by both new RPCs. SECURITY DEFINER, REVOKE all (internal helper, S28 `_emit_expense_je` pattern). **Does NOT insert stock_movements** (draft is not a finalized sale — decision R-S34-2).

- [ ] **Step 1: Write migration — mirror the loop from `create_tablet_order_v2` (Task 1.A Step 2), minus stock_movements**

```sql
-- 20260619000011_create_insert_draft_order_items_helper.sql
-- Session 34 / Wave 1.C — internal helper: insert order_items for a draft order.
-- Mirrors create_tablet_order_v2 item loop. NO stock_movements (draft != sale).
-- p_lock=true → items go to KDS immediately (is_locked + sent_to_kitchen_at).

CREATE OR REPLACE FUNCTION public._insert_draft_order_items(
  p_order_id UUID,
  p_items    JSONB,     -- [{ client_line_id, product_id, quantity, unit_price, modifiers, modifiers_total, discount_* }]
  p_lock     BOOLEAN
)
RETURNS JSONB           -- { "<client_line_id>": "<order_item_id>", ... }
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item            JSONB;
  v_product_id      UUID;
  v_quantity        INT;
  v_unit_price      NUMERIC;
  v_modifiers       JSONB;
  v_modifiers_total NUMERIC;
  v_line_total      NUMERIC;
  v_dispatch        TEXT;
  v_new_id          UUID;
  v_map             JSONB := '{}'::jsonb;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id      := (v_item->>'product_id')::uuid;
    v_quantity        := (v_item->>'quantity')::int;
    v_unit_price      := COALESCE((v_item->>'unit_price')::numeric, 0);
    v_modifiers       := COALESCE(v_item->'modifiers', '[]'::jsonb);
    v_modifiers_total := COALESCE((v_item->>'modifiers_total')::numeric, 0);
    v_line_total      := round_idr((v_unit_price + v_modifiers_total) * v_quantity);

    SELECT c.dispatch_station INTO v_dispatch
      FROM products p JOIN categories c ON c.id = p.category_id
      WHERE p.id = v_product_id;

    INSERT INTO order_items (
      order_id, product_id, name_snapshot, unit_price, quantity, line_total,
      modifiers, modifiers_total, dispatch_station,
      is_locked, sent_to_kitchen_at, kitchen_status
    )
    SELECT
      p_order_id, p.id, p.name, v_unit_price, v_quantity, v_line_total,
      v_modifiers, v_modifiers_total, v_dispatch,
      p_lock,
      CASE WHEN p_lock THEN now() ELSE NULL END,
      CASE WHEN p_lock THEN 'pending' ELSE NULL END
    FROM products p WHERE p.id = v_product_id
    RETURNING id INTO v_new_id;

    v_map := v_map || jsonb_build_object(COALESCE(v_item->>'client_line_id', v_new_id::text), v_new_id::text);
  END LOOP;

  RETURN v_map;
END $$;

REVOKE ALL ON FUNCTION public._insert_draft_order_items(UUID, JSONB, BOOLEAN) FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public._insert_draft_order_items(UUID, JSONB, BOOLEAN) IS
  'S34 internal — inserts order_items for a draft order. No stock_movements. Called only by SECURITY DEFINER draft RPCs.';
```

> **NB worker:** Adjust column names to match Task 1.A Step 5 discovery (e.g. if `name_snapshot`/`modifiers_total`/`dispatch_station` differ). If `round_idr` is not the helper name, use the one used in `complete_order_v9`.

- [ ] **Step 2: Apply via MCP. Expected: success.**

- [ ] **Step 3: Verify REVOKE**
```sql
SELECT has_function_privilege('authenticated', '_insert_draft_order_items(uuid,jsonb,boolean)', 'EXECUTE');
```
Expected: `false`.

- [ ] **Step 4: Commit**
```bash
git add supabase/migrations/20260619000011_create_insert_draft_order_items_helper.sql
git commit -m "feat(db): s34 wave 1.C — _insert_draft_order_items helper"
```

---

### Task 1.D : `create_draft_order_with_items_v1` RPC + REVOKE pair

**Files:**
- Create `supabase/migrations/20260619000012_create_create_draft_order_with_items_v1_rpc.sql`
- Create `supabase/migrations/20260619000013_revoke_anon_create_draft_order_with_items_v1.sql`

- [ ] **Step 1: Write the RPC migration**

```sql
-- 20260619000012_create_create_draft_order_with_items_v1_rpc.sql
-- Session 34 / Wave 1.D — create a POS counter draft order + locked items (Send to Kitchen).
-- Mirrors create_tablet_order_v2 but created_via='pos'. Idempotency via draft_order_idempotency_keys.

CREATE OR REPLACE FUNCTION public.create_draft_order_with_items_v1(
  p_session_id   UUID,
  p_order_type   order_type,
  p_table_number TEXT,
  p_customer_id  UUID,
  p_items        JSONB,
  p_client_uuid  UUID
)
RETURNS JSONB    -- { order_id, order_number, item_ids: {client_line_id: order_item_id} }
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile_id UUID := auth.uid();
  v_order_id   UUID;
  v_order_num  TEXT;
  v_item_ids   JSONB;
  v_existing   RECORD;
BEGIN
  -- Auth-first
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  -- Permission gate: sales.create
  IF NOT public.has_permission(v_profile_id, 'sales.create') THEN
    RAISE EXCEPTION 'forbidden: sales.create required' USING ERRCODE = '42501';
  END IF;

  -- Idempotency replay
  SELECT * INTO v_existing FROM draft_order_idempotency_keys WHERE client_uuid = p_client_uuid;
  IF FOUND THEN
    RETURN v_existing.result || jsonb_build_object('idempotent_replay', true);
  END IF;

  -- Create the draft order
  INSERT INTO orders (session_id, order_type, status, table_number, customer_id, served_by, created_via)
  VALUES (p_session_id, p_order_type, 'draft', p_table_number, p_customer_id, v_profile_id, 'pos')
  RETURNING id, order_number INTO v_order_id, v_order_num;

  -- Insert locked items (go to KDS now)
  v_item_ids := public._insert_draft_order_items(v_order_id, p_items, true);

  -- Recompute totals (S33 helper)
  PERFORM public._recalc_order_totals(v_order_id);

  -- Audit
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_profile_id, 'order.draft_created', 'orders', v_order_id,
          jsonb_build_object('client_uuid', p_client_uuid, 'item_count', jsonb_array_length(p_items)));

  -- Persist idempotency result
  INSERT INTO draft_order_idempotency_keys (client_uuid, order_id, result)
  VALUES (p_client_uuid, v_order_id,
          jsonb_build_object('order_id', v_order_id, 'order_number', v_order_num, 'item_ids', v_item_ids));

  RETURN jsonb_build_object('order_id', v_order_id, 'order_number', v_order_num, 'item_ids', v_item_ids);
EXCEPTION WHEN unique_violation THEN
  -- Concurrency race on client_uuid → re-read
  SELECT * INTO v_existing FROM draft_order_idempotency_keys WHERE client_uuid = p_client_uuid;
  RETURN v_existing.result || jsonb_build_object('idempotent_replay', true);
END $$;
```

> **NB worker:** Confirm `has_permission(uuid, text)` is the gate helper used elsewhere (grep `has_permission` in existing RPCs). Confirm `orders` columns `created_via`, `served_by`, `order_number` (auto-generated?) match Task 1.A. Match `create_tablet_order_v2`'s exact INSERT column set.

- [ ] **Step 2: Write the REVOKE pair migration**

```sql
-- 20260619000013_revoke_anon_create_draft_order_with_items_v1.sql
REVOKE EXECUTE ON FUNCTION public.create_draft_order_with_items_v1(UUID, order_type, TEXT, UUID, JSONB, UUID) FROM anon, PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

- [ ] **Step 3: Apply both via MCP. Expected: success.**

- [ ] **Step 4: Smoke-verify with a throwaway call** (use a real open session + product ids from the dev DB, wrapped in `BEGIN ... ROLLBACK`):
```sql
BEGIN;
SELECT public.create_draft_order_with_items_v1(
  (SELECT id FROM pos_sessions WHERE status='open' LIMIT 1),
  'take_out', NULL, NULL,
  jsonb_build_array(jsonb_build_object('client_line_id','l1','product_id',(SELECT id FROM products WHERE is_active LIMIT 1),'quantity',1,'unit_price',15000)),
  gen_random_uuid()
);
ROLLBACK;
```
Expected: JSONB with `order_id`, `order_number`, `item_ids`.

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/20260619000012_*.sql supabase/migrations/20260619000013_*.sql
git commit -m "feat(db): s34 wave 1.D — create_draft_order_with_items_v1 RPC + revoke pair"
```

---

### Task 1.E : `append_draft_order_items_v1` RPC + REVOKE pair

**Files:**
- Create `supabase/migrations/20260619000014_create_append_draft_order_items_v1_rpc.sql`
- Create `supabase/migrations/20260619000015_revoke_anon_append_draft_order_items_v1.sql`

- [ ] **Step 1: Write the RPC migration**

```sql
-- 20260619000014_create_append_draft_order_items_v1_rpc.sql
-- Session 34 / Wave 1.E — append items to an existing draft order.
-- p_lock=true → send to KDS now ; p_lock=false → add without sending (checkout auto-flush).

CREATE OR REPLACE FUNCTION public.append_draft_order_items_v1(
  p_order_id    UUID,
  p_items       JSONB,
  p_lock        BOOLEAN,
  p_client_uuid UUID
)
RETURNS JSONB    -- { item_ids: {client_line_id: order_item_id} }
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile_id UUID := auth.uid();
  v_status     order_status;
  v_item_ids   JSONB;
  v_existing   RECORD;
BEGIN
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.has_permission(v_profile_id, 'sales.create') THEN
    RAISE EXCEPTION 'forbidden: sales.create required' USING ERRCODE = '42501';
  END IF;

  -- Idempotency replay
  SELECT * INTO v_existing FROM draft_order_idempotency_keys WHERE client_uuid = p_client_uuid;
  IF FOUND THEN
    RETURN v_existing.result || jsonb_build_object('idempotent_replay', true);
  END IF;

  -- Status check: only draft orders accept appends
  SELECT status INTO v_status FROM orders WHERE id = p_order_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'order not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'cannot append to order with status %', v_status USING ERRCODE = 'P0002';
  END IF;

  v_item_ids := public._insert_draft_order_items(p_order_id, p_items, p_lock);
  PERFORM public._recalc_order_totals(p_order_id);

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_profile_id, 'order.draft_appended', 'orders', p_order_id,
          jsonb_build_object('client_uuid', p_client_uuid, 'locked', p_lock, 'item_count', jsonb_array_length(p_items)));

  INSERT INTO draft_order_idempotency_keys (client_uuid, order_id, result)
  VALUES (p_client_uuid, p_order_id, jsonb_build_object('item_ids', v_item_ids));

  RETURN jsonb_build_object('item_ids', v_item_ids);
EXCEPTION WHEN unique_violation THEN
  SELECT * INTO v_existing FROM draft_order_idempotency_keys WHERE client_uuid = p_client_uuid;
  RETURN v_existing.result || jsonb_build_object('idempotent_replay', true);
END $$;
```

- [ ] **Step 2: Write REVOKE pair**

```sql
-- 20260619000015_revoke_anon_append_draft_order_items_v1.sql
REVOKE EXECUTE ON FUNCTION public.append_draft_order_items_v1(UUID, JSONB, BOOLEAN, UUID) FROM anon, PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

- [ ] **Step 3: Apply both. Expected: success.**

- [ ] **Step 4: Commit**
```bash
git add supabase/migrations/20260619000014_*.sql supabase/migrations/20260619000015_*.sql
git commit -m "feat(db): s34 wave 1.E — append_draft_order_items_v1 RPC + revoke pair"
```

---

### Task 1.F : F-008 — REVOKE anon on `send_items_to_kitchen`

**Files:** Create `supabase/migrations/20260619000016_revoke_anon_send_items_to_kitchen.sql`

- [ ] **Step 1: Write migration**

```sql
-- 20260619000016_revoke_anon_send_items_to_kitchen.sql
-- Session 34 / Wave 1.F — F-008: send_items_to_kitchen was GRANTed to anon (pre-S20).
-- Enforce anon defense-in-depth (S20 canonical).

REVOKE EXECUTE ON FUNCTION public.send_items_to_kitchen(UUID[]) FROM anon, PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

- [ ] **Step 2: Apply. Verify**
```sql
SELECT has_function_privilege('anon', 'send_items_to_kitchen(uuid[])', 'EXECUTE');
```
Expected: `false`.

- [ ] **Step 3: (Bonus sweep) grep pre-S20 anon grants**
```bash
grep -rn "TO authenticated, anon\|TO anon" supabase/migrations/2026050*.sql
```
List any other RPC with anon GRANT in the deviation log (DEV-S34-1.F-xx). REVOKE in this same migration if trivial (≤3); else defer to backlog `S36+ anon-sweep`.

- [ ] **Step 4: Commit**
```bash
git add supabase/migrations/20260619000016_revoke_anon_send_items_to_kitchen.sql
git commit -m "fix(db): s34 wave 1.F — F-008 revoke anon on send_items_to_kitchen"
```

---

### Task 1.G : Conditional `order_items` realtime publication

**Files:** Create `supabase/migrations/20260619000017_alter_publication_realtime_order_items.sql` **only if** Task 1.A Step 4 returned 0 rows.

- [ ] **Step 1: If `order_items` already published → SKIP this task entirely** (note in deviation log).

- [ ] **Step 2: Else write migration**
```sql
-- 20260619000017_alter_publication_realtime_order_items.sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.order_items;
```

- [ ] **Step 3: Apply + commit** (only if created).

---

### Task 1.H : Types regen

**Files:** Modify `packages/supabase/src/types.generated.ts`

- [ ] **Step 1: Regen via MCP `generate_typescript_types`** (`project_id='ikcyvlovptebroadgtvd'`). Write the returned `types` to `packages/supabase/src/types.generated.ts`.

- [ ] **Step 2: Verify new symbols present**
```bash
grep -n "create_draft_order_with_items_v1\|append_draft_order_items_v1\|draft_order_idempotency_keys" packages/supabase/src/types.generated.ts
```
Expected: matches for all three.

- [ ] **Step 3: typecheck the supabase package**
```bash
pnpm --filter @breakery/supabase typecheck
```
Expected: PASS.

- [ ] **Step 4: Commit**
```bash
git add packages/supabase/src/types.generated.ts
git commit -m "chore(db): s34 wave 1.H — regen types (draft order RPCs)"
```

---

### Task 1.I : pgTAP `draft_order_flow` + `send_items_revoke`

**Files:**
- Create `supabase/tests/draft_order_flow.test.sql`
- Create `supabase/tests/send_items_revoke.test.sql`

- [ ] **Step 1: Write `draft_order_flow.test.sql`** covering T1-T12 (spec §6.1). Wrap in `BEGIN ... ROLLBACK`. Use `SET LOCAL role` / `SET request.jwt.claims` patterns from existing pgTAP files (read `supabase/tests/orders_list_v2.test.sql` or S32 test for the auth-as-role helper pattern). Key assertions:

```sql
-- T1: create_draft_order_with_items_v1 → status='draft', items locked
SELECT is(
  (SELECT status::text FROM orders WHERE id = (v_result->>'order_id')::uuid),
  'draft', 'T1: draft order created with status=draft');
SELECT is(
  (SELECT bool_and(is_locked) FROM order_items WHERE order_id = (v_result->>'order_id')::uuid),
  true, 'T1b: all items is_locked=true');
-- ... T2 perm 42501, T3 idempotency replay, T4 totals, T5 mapping,
-- ... T6-T9 append, T10 helper revoke, T11 KDS visibility, T12 transition
```

> **NB:** pgTAP cannot easily call SECURITY DEFINER under a switched role without a JWT claim; follow the GUC pattern documented in CLAUDE.md DEV-S25-2.A-03 (chain pass/fail flags via `current_setting`).

- [ ] **Step 2: Write `send_items_revoke.test.sql`** (T1 anon has no EXECUTE; T2 authenticated still has EXECUTE — it's a legit caller path):
```sql
SELECT is(has_function_privilege('anon','send_items_to_kitchen(uuid[])','EXECUTE'), false, 'T1: anon revoked');
SELECT is(has_function_privilege('authenticated','send_items_to_kitchen(uuid[])','EXECUTE'), true, 'T2: authenticated kept');
```

- [ ] **Step 3: Run both via MCP `execute_sql`.** Expected: all PASS.

- [ ] **Step 4: Commit**
```bash
git add supabase/tests/draft_order_flow.test.sql supabase/tests/send_items_revoke.test.sql
git commit -m "test(db): s34 wave 1.I — draft_order_flow 12 + send_items_revoke 2 pgTAP"
```

---

## Wave 2 — POS F-001 wiring (depends on Wave 1)

### Task 2.A : cartStore draftOrderId + serverItemIds + clientUuid

**Files:** Modify `apps/pos/src/stores/cartStore.ts`

- [ ] **Step 1: Read the full file** to locate `CartState` interface (line ~50), the initial state (line ~147), `markLocked` (line ~238), and the reset paths (`reset` ~272, `resetCartAfterCheckout` ~411).

- [ ] **Step 2: Add fields to `CartState` interface**
```ts
  draftOrderId: string | null;
  serverItemIds: Record<string, string>;   // client_line_id → order_item_id
  clientUuid: string;
  setDraftOrder: (orderId: string, mapping: Record<string, string>) => void;
  mergeServerItemIds: (mapping: Record<string, string>) => void;
```

- [ ] **Step 3: Initialize in create()** (alongside `lockedItemIds: []`):
```ts
  draftOrderId: null,
  serverItemIds: {},
  clientUuid: crypto.randomUUID(),
```

- [ ] **Step 4: Implement actions**
```ts
  setDraftOrder: (orderId, mapping) =>
    set((s) => ({ draftOrderId: orderId, serverItemIds: { ...s.serverItemIds, ...mapping } })),
  mergeServerItemIds: (mapping) =>
    set((s) => ({ serverItemIds: { ...s.serverItemIds, ...mapping } })),
```

- [ ] **Step 5: Clear on every reset path** — in `reset`, `resetCartAfterCheckout`, and the held/picked-up restore reset, add:
```ts
  draftOrderId: null,
  serverItemIds: {},
  clientUuid: crypto.randomUUID(),
```
And ensure `partialize`/persist (line ~375) does NOT persist `clientUuid` regeneration incorrectly — `draftOrderId` + `serverItemIds` MAY persist (survive reload mid-order) but `clientUuid` should persist with them so a reload reuses the same idempotency key.

- [ ] **Step 6: typecheck**
```bash
pnpm --filter @breakery/pos typecheck
```
Expected: PASS.

- [ ] **Step 7: Commit**
```bash
git add apps/pos/src/stores/cartStore.ts
git commit -m "feat(pos): s34 wave 2.A — cartStore draftOrderId + serverItemIds + clientUuid"
```

---

### Task 2.B : `useSendToKitchen` rewrite (TDD)

**Files:**
- Modify `apps/pos/src/features/cart/hooks/useSendToKitchen.ts`
- Test `apps/pos/src/features/cart/__tests__/send-to-kitchen.smoke.test.tsx`

- [ ] **Step 1: Write the failing smoke test** (mock `supabase.rpc`):
```tsx
// asserts: first send → rpc('create_draft_order_with_items_v1') called,
//          draftOrderId set in store, items marked locked;
//          second send with draftOrderId → rpc('append_draft_order_items_v1', { p_lock: true });
//          rpc error → store unchanged + throws.
```

- [ ] **Step 2: Run → FAIL**
```bash
pnpm --filter @breakery/pos test send-to-kitchen
```
Expected: FAIL (hook still no-op).

- [ ] **Step 3: Rewrite the hook**
```ts
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useCartStore } from '@/stores/cartStore';

interface DraftResult { order_id: string; item_ids: Record<string, string>; }

export function useSendToKitchen() {
  return useMutation({
    mutationFn: async (lineIds: string[]): Promise<string[]> => {
      if (lineIds.length === 0) return [];
      const s = useCartStore.getState();
      const items = s.unlockedItems()
        .filter((i) => lineIds.includes(i.id))
        .map((i) => ({
          client_line_id: i.id,
          product_id: i.product_id,
          quantity: i.quantity,
          unit_price: i.unit_price,
          modifiers: i.modifiers,
          modifiers_total: i.modifiers.reduce((a, m) => a + m.price_adjustment, 0) * i.quantity,
        }));

      if (!s.draftOrderId && !s.pickedUpOrderId) {
        const { data, error } = await supabase.rpc('create_draft_order_with_items_v1', {
          p_session_id: useShiftSessionId(),       // see NB below
          p_order_type: s.cart.order_type,
          p_table_number: s.cart.tableNumber ?? null,
          p_customer_id: s.cart.customerId ?? null,
          p_items: items,
          p_client_uuid: s.clientUuid,
        });
        if (error) throw error;
        const r = data as DraftResult;
        s.setDraftOrder(r.order_id, r.item_ids);
      } else {
        const targetId = s.draftOrderId ?? s.pickedUpOrderId!;
        const { data, error } = await supabase.rpc('append_draft_order_items_v1', {
          p_order_id: targetId,
          p_items: items,
          p_lock: true,
          p_client_uuid: crypto.randomUUID(),       // fresh key per append
        });
        if (error) throw error;
        const r = data as { item_ids: Record<string, string> };
        s.mergeServerItemIds(r.item_ids);
        if (!s.draftOrderId) s.setDraftOrder(targetId, r.item_ids);
      }

      useCartStore.getState().markLocked(lineIds);
      return lineIds;
    },
  });
}
```

> **NB worker:** `p_session_id` must come from `useShiftStore.getState().current?.id` (read how `useCheckout.ts:40` gets `sessionId`). Don't invent `useShiftSessionId()` — inline `useShiftStore.getState().current?.id` and throw `no_open_shift` if null. Confirm `CartItem` field names (`product_id`, `unit_price`, `modifiers`, `modifiers[].price_adjustment`) against `cartStore.ts` / `@breakery/domain` Cart type.

- [ ] **Step 4: Run → PASS.** Iterate until green.

- [ ] **Step 5: Commit**
```bash
git add apps/pos/src/features/cart/hooks/useSendToKitchen.ts apps/pos/src/features/cart/__tests__/send-to-kitchen.smoke.test.tsx
git commit -m "feat(pos): s34 wave 2.B — useSendToKitchen persists draft order (F-001)"
```

---

### Task 2.C : SendToKitchenButton honest copy

**Files:** Modify `apps/pos/src/features/cart/SendToKitchenButton.tsx`

- [ ] **Step 1: Replace the stale v1 caveat comment (lines 1-14)** with a one-line description ("Persists/append draft order items to the kitchen via useSendToKitchen"). No behaviour change — the toast already only fires after `mutateAsync` resolves.

- [ ] **Step 2: typecheck + commit**
```bash
pnpm --filter @breakery/pos typecheck
git add apps/pos/src/features/cart/SendToKitchenButton.tsx
git commit -m "docs(pos): s34 wave 2.C — SendToKitchenButton remove stale no-op caveat"
```

---

### Task 2.D : useCheckout reuse draftOrderId + auto-flush (TDD)

**Files:**
- Modify `apps/pos/src/features/payment/hooks/useCheckout.ts`
- Test `apps/pos/src/features/payment/__tests__/checkout-draft.smoke.test.tsx`

- [ ] **Step 1: Write failing test** — three cases:
  - draftOrderId set + no unlocked items → `pay_existing_order_v6` called with `p_order_id = draftOrderId`, no append.
  - draftOrderId set + 1 unlocked item → `append_draft_order_items_v1({ p_lock: false })` called THEN `pay_existing_order_v6`.
  - neither draftOrderId nor pickedUpOrderId → falls through to `process-payment` EF (existing behaviour).

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Edit `useCheckout`** — change line 50 + the `if (pickedUpOrderId)` block (line 66):
```ts
const { attachedCustomer, pickedUpOrderId, draftOrderId, appliedPromotions } = cartState;
const existingOrderId = pickedUpOrderId ?? draftOrderId;
// ...
if (existingOrderId) {
  // Auto-flush: persist any items added but never sent to kitchen, else they'd be lost
  const unsent = cartState.unlockedItems();
  if (unsent.length > 0) {
    const flushItems = unsent.map((i) => ({
      client_line_id: i.id, product_id: i.product_id, quantity: i.quantity,
      unit_price: i.unit_price, modifiers: i.modifiers,
      modifiers_total: i.modifiers.reduce((a, m) => a + m.price_adjustment, 0) * i.quantity,
    }));
    const { error: flushErr } = await supabase.rpc('append_draft_order_items_v1', {
      p_order_id: existingOrderId, p_items: flushItems, p_lock: false, p_client_uuid: crypto.randomUUID(),
    });
    if (flushErr) throw Object.assign(new Error(flushErr.message), { details: flushErr });
  }
  // ... existing pay_existing_order_v6 block, replacing `pickedUpOrderId` with `existingOrderId`
}
```
Replace the two `pickedUpOrderId` references inside the block (`p_order_id` and the return `order_id`) with `existingOrderId`.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: typecheck + commit**
```bash
pnpm --filter @breakery/pos typecheck
git add apps/pos/src/features/payment/hooks/useCheckout.ts apps/pos/src/features/payment/__tests__/checkout-draft.smoke.test.tsx
git commit -m "feat(pos): s34 wave 2.D — checkout reuses draft order + auto-flush (F-001)"
```

---

### Task 2.E : KDS visibility verification

**Files:** none (verification) — possibly extend `apps/pos/src/features/kds/__tests__/`.

- [ ] **Step 1: Confirm KDS query reads is_locked**
```bash
grep -n "is_locked" apps/pos/src/features/kds/hooks/useKdsOrders.ts
```
Expected: `.eq('is_locked', true)`. No change needed.

- [ ] **Step 2: (Optional) runtime verify via MCP Preview / manual** — create a counter draft order, confirm it appears on `/kds`. Record result in INDEX. If automated, add a smoke asserting a locked order_item with `kitchen_status='pending'` is returned by the KDS query shape.

- [ ] **Step 3: Commit only if a test was added.**

---

## Wave 3 — F-002 enum drift (independent, parallelizable)

### Task 3.A : `orderTypeLabel` domain helper (TDD)

**Files:**
- Create `packages/domain/src/orders/orderTypeLabel.ts`
- Create `packages/domain/src/orders/__tests__/orderTypeLabel.test.ts`
- Modify `packages/domain/src/index.ts`

- [ ] **Step 1: Write failing test**
```ts
import { describe, it, expect } from 'vitest';
import { orderTypeLabel, ORDER_TYPE_LABELS } from '../orderTypeLabel';

describe('orderTypeLabel', () => {
  it('maps take_out → Takeaway', () => expect(orderTypeLabel('take_out')).toBe('Takeaway'));
  it('maps dine_in → Dine-in', () => expect(orderTypeLabel('dine_in')).toBe('Dine-in'));
  it('maps delivery + b2b', () => {
    expect(orderTypeLabel('delivery')).toBe('Delivery');
    expect(orderTypeLabel('b2b')).toBe('B2B');
  });
  it('falls back to raw value for unknown', () => expect(orderTypeLabel('mystery')).toBe('mystery'));
  it('covers the full enum (type-level)', () => {
    // forces ORDER_TYPE_LABELS to have every OrderType key
    expect(Object.keys(ORDER_TYPE_LABELS).sort()).toEqual(['b2b','delivery','dine_in','take_out']);
  });
});
```

- [ ] **Step 2: Run → FAIL**
```bash
pnpm --filter @breakery/domain test orderTypeLabel
```

- [ ] **Step 3: Implement** (use the exact `OrderType` import path — grep `export type OrderType` in `packages/domain/src`):
```ts
import type { OrderType } from '../types';
export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  dine_in: 'Dine-in', take_out: 'Takeaway', delivery: 'Delivery', b2b: 'B2B',
};
export function orderTypeLabel(t: string): string {
  return (ORDER_TYPE_LABELS as Record<string, string>)[t] ?? t;
}
```

- [ ] **Step 4: Re-export from `packages/domain/src/index.ts`**
```ts
export { ORDER_TYPE_LABELS, orderTypeLabel } from './orders/orderTypeLabel';
```

- [ ] **Step 5: Run → PASS + typecheck**
```bash
pnpm --filter @breakery/domain test orderTypeLabel && pnpm --filter @breakery/domain typecheck
```

- [ ] **Step 6: Commit**
```bash
git add packages/domain/src/orders/orderTypeLabel.ts packages/domain/src/orders/__tests__/orderTypeLabel.test.ts packages/domain/src/index.ts
git commit -m "feat(domain): s34 wave 3.A — orderTypeLabel helper (F-002)"
```

---

### Task 3.B : Migrate the 5 POS sites + fix fixture

**Files:**
- Modify `apps/pos/src/features/display/components/OrderQueueTicker.tsx`
- Modify `apps/pos/src/features/display/components/CurrentOrderCard.tsx`
- Modify `apps/pos/src/features/order-history/OrderHistoryPanel.tsx`
- Modify `apps/pos/src/features/cart/HeldOrdersModal.tsx`
- Modify `apps/pos/src/features/display/__tests__/OrderQueueTicker.test.tsx`

- [ ] **Step 1: `OrderQueueTicker.tsx:33`** — replace the `take_away` branch. Read the function: it returns a short label ("Pickup"/"Dine"). Decide: keep its short-code semantics but base the branch on `'take_out'`:
```ts
if (orderType === 'take_out') return 'Pickup';
```
(Or use `orderTypeLabel(orderType)` if a full label is wanted — match the existing UI intent.)

- [ ] **Step 2: `CurrentOrderCard.tsx:55`** — replace `order.order_type === 'take_away'` with `order.order_type === 'take_out'` (or `orderTypeLabel`).

- [ ] **Step 3: `OrderHistoryPanel.tsx:189`** — replace the ternary with `{orderTypeLabel(row.order_type)}` (import from `@breakery/domain`).

- [ ] **Step 4: `HeldOrdersModal.tsx:276`** — cosmetic; replace `'takeaway'` literal with `orderTypeLabel('take_out')` or keep the human string but align to the same source.

- [ ] **Step 5: `OrderQueueTicker.test.tsx:48`** — change fixture `order_type: 'take_away'` → `'take_out'`. Update the assertion to expect the label the component now renders.

- [ ] **Step 6: Run POS display + order-history tests**
```bash
pnpm --filter @breakery/pos test OrderQueueTicker CurrentOrderCard OrderHistoryPanel
```
Expected: PASS.

- [ ] **Step 7: Confirm no remaining drift**
```bash
grep -rn "take_away\|'takeaway'" apps/pos/src --include=*.ts --include=*.tsx
```
Expected: only comments/JPEG filenames (ActiveOrderPanel:15, HeldOrdersModal:5 ref comments) remain — no code comparisons.

- [ ] **Step 8: Commit**
```bash
git add apps/pos/src/features/display apps/pos/src/features/order-history/OrderHistoryPanel.tsx apps/pos/src/features/cart/HeldOrdersModal.tsx
git commit -m "fix(pos): s34 wave 3.B — F-002 take_away drift → orderTypeLabel/take_out"
```

---

## Wave 4 — F-004 receipt tenders + conditional drawer (independent)

### Task 4.A : printService ReceiptTender[] type

**Files:** Modify `apps/pos/src/services/print/printService.ts`

- [ ] **Step 1: Add `ReceiptTender` + change `ReceiptPayload`** (spec §4.4). Change `order.order_type` to the full union and `payment` to `ReceiptTender[]`.

- [ ] **Step 2: typecheck (will surface SuccessModal break — expected)**
```bash
pnpm --filter @breakery/pos typecheck
```
Expected: error in `SuccessModal.tsx` (fixed in Task 4.B). That's the failing signal.

- [ ] **Step 3: Commit (type only)**
```bash
git add apps/pos/src/services/print/printService.ts
git commit -m "feat(pos): s34 wave 4.A — ReceiptPayload.payment is ReceiptTender[] (F-004)"
```

---

### Task 4.B : SuccessModal tenders + conditional drawer (TDD)

**Files:**
- Modify `apps/pos/src/features/payment/SuccessModal.tsx`
- Test `apps/pos/src/features/payment/__tests__/success-modal-tenders.smoke.test.tsx`
- Modify the call-site of `SuccessModal` (grep `<SuccessModal`)

- [ ] **Step 1: Find the call-site**
```bash
grep -rn "<SuccessModal" apps/pos/src
```
Read how `paymentMethod`/`cashReceived` are passed and whether split-tender state is available (`TenderListBuilder`/`paymentStore`). This determines how to build `tenders` (R-S34-7).

- [ ] **Step 2: Write failing smoke test**
```tsx
// Case A: tenders=[{method:'cash',amount,cash_received,change_given}] →
//   printReceipt called with payload.payment being an array containing the cash tender,
//   openCashDrawer CALLED.
// Case B: tenders=[{method:'qris',amount}] → openCashDrawer NOT called.
// Case C: tenders=[{method:'card',amount},{method:'cash',amount}] → drawer CALLED (cash present).
```
Mock `printReceipt` + `openCashDrawer` from `printService`.

- [ ] **Step 3: Run → FAIL.**

- [ ] **Step 4: Edit `SuccessModal`**
  - Add prop `tenders: ReceiptTender[]` to `SuccessModalProps`.
  - `buildReceiptPayload`: set `payment: props.tenders` (remove the hardcoded `{ method: 'cash', ... }`); set `order_type: props.cart.order_type` (full value, no coercion).
  - `useEffect`:
```ts
useEffect(() => {
  if (!open) return;
  void handlePrint();
  if (props.tenders.some((t) => t.method === 'cash')) void openCashDrawer();
}, [open]); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 5: Update the call-site** to pass `tenders`. If only a scalar `paymentMethod` + `cashReceived` is available (single-tender path), construct a one-element array:
```ts
tenders={[{ method: paymentMethod as ReceiptTender['method'], amount: total,
  ...(paymentMethod === 'cash' ? { cash_received: cashReceived, change_given: changeGiven ?? 0 } : {}) }]}
```
For split-pay, map the `paymentStore` tenders array.

- [ ] **Step 6: Run → PASS + typecheck (should now be clean from Task 4.A)**
```bash
pnpm --filter @breakery/pos test success-modal-tenders && pnpm --filter @breakery/pos typecheck
```

- [ ] **Step 7: Commit**
```bash
git add apps/pos/src/features/payment/SuccessModal.tsx apps/pos/src/features/payment/__tests__/success-modal-tenders.smoke.test.tsx
git commit -m "fix(pos): s34 wave 4.B — receipt multi-tender + conditional cash drawer (F-004)"
```

- [ ] **Step 8: Note print-server template TODO (R-S34-8)** — add a line to the INDEX deviation log: external print-server template at `localhost:3001` must iterate `payment[]` (out-of-repo follow-up).

---

## Wave 5 — F-006 PIN-en-header sweep (independent)

### Task 5.A : void-order EF header read

**Files:** Modify `supabase/functions/void-order/index.ts` (+ optional `supabase/functions/_shared/manager-pin.ts`)

- [ ] **Step 1: Read the EF** — find where it reads `body.manager_pin`.
```bash
grep -n "manager_pin" supabase/functions/void-order/index.ts
```

- [ ] **Step 2: (Optional) create shared helper `supabase/functions/_shared/manager-pin.ts`**
```ts
export function getManagerPin(req: Request): string {
  const pin = req.headers.get('x-manager-pin');
  if (!pin) throw new Error('missing_manager_pin_header');
  return pin;
}
```

- [ ] **Step 3: Replace body read with header read** — `const managerPin = getManagerPin(req);` (or inline). Remove `manager_pin` from the body destructuring (hard cutover).

- [ ] **Step 4: Deploy the EF** via MCP supabase EF deploy tool (or note manual `supabase functions deploy void-order` is Docker — use MCP deploy). Record deploy in INDEX.

- [ ] **Step 5: Commit**
```bash
git add supabase/functions/void-order/index.ts supabase/functions/_shared/manager-pin.ts
git commit -m "fix(edge): s34 wave 5.A — void-order reads PIN from x-manager-pin header (F-006)"
```

---

### Task 5.B : cancel-item EF header read

**Files:** Modify `supabase/functions/cancel-item/index.ts`

- [ ] **Step 1-3: Same pattern as 5.A** — replace `body.manager_pin` with `getManagerPin(req)`, remove body field.

- [ ] **Step 4: Deploy + commit**
```bash
git add supabase/functions/cancel-item/index.ts
git commit -m "fix(edge): s34 wave 5.B — cancel-item reads PIN from x-manager-pin header (F-006)"
```

---

### Task 5.C : POS hooks send PIN via header

**Files:**
- Modify `apps/pos/src/features/order-history/hooks/useVoidOrder.ts`
- Modify `apps/pos/src/features/cart/hooks/useCancelOrderItem.ts`

- [ ] **Step 1: `useVoidOrder.ts:42-46`** — move `manager_pin` out of body into headers:
```ts
headers: {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${accessToken}`,
  'x-manager-pin': managerPin,
},
body: JSON.stringify({ order_id: orderId, reason }),
```

- [ ] **Step 2: `useCancelOrderItem.ts:48-55`** — same: add `'x-manager-pin': managerPin` header, remove `manager_pin` from body.

- [ ] **Step 3: Extend/adjust existing smoke tests** to assert the header is set and body no longer contains `manager_pin`.
```bash
pnpm --filter @breakery/pos test useVoidOrder useCancelOrderItem
```

- [ ] **Step 4: Commit**
```bash
git add apps/pos/src/features/order-history/hooks/useVoidOrder.ts apps/pos/src/features/cart/hooks/useCancelOrderItem.ts
git commit -m "fix(pos): s34 wave 5.C — void/cancel hooks send PIN via header (F-006)"
```

---

### Task 5.D : Vitest live EF PIN-header test

**Files:** Create `supabase/tests/functions/pin-header-sweep.test.ts`

- [ ] **Step 1: Author 4 cases** (env-gated like S25 `idempotency-hardening.test.ts` — requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`):
  - void-order with valid `x-manager-pin` header → 200/success
  - void-order with PIN in body only (no header) → rejected (missing header)
  - cancel-item with valid header → success
  - cancel-item with PIN in body only → rejected

- [ ] **Step 2: Note env-gating in INDEX** (live run requires user-exported env vars — same project gap as S25/S19).

- [ ] **Step 3: Commit**
```bash
git add supabase/tests/functions/pin-header-sweep.test.ts
git commit -m "test(edge): s34 wave 5.D — pin-header-sweep live EF tests (F-006)"
```

---

## Wave 6 — Minor fixes + sweep + close-out

### Task 6.A : F-016 / F-017 / F-018 minor

**Files:**
- Modify `apps/pos/src/pages/Pos.tsx`
- Modify `apps/pos/src/features/products/ProductGrid.tsx`

- [ ] **Step 1: F-016 — wire SideMenuDrawer callbacks (`Pos.tsx:170-180`)**. Read the block. Pass the existing handlers:
```tsx
onOpenHeldOrders={() => setHeldOrdersOpen(true)}
onOpenCustomers={() => setCustomersOpen(true)}
```
Confirm those state setters / modal open mechanisms exist (grep `HeldOrdersModal`, `CustomerAttachModal` mount in `Pos.tsx`). If a handler has no target yet, leave `onLockTerminal` unwired (S35 F-014) and note it.

- [ ] **Step 2: F-018 — `Pos.tsx:196`** replace `onRecover={() => toast.info('Recover shift not implemented yet')}` with a disabled state + tooltip (or remove the Recover affordance). Decision: pass `onRecover={undefined}` and let `ShiftClosedState` render the button disabled with title "Coming soon" (verify the component supports a disabled/absent handler; if not, add a `recoverDisabled` prop).

- [ ] **Step 3: F-017 — `ProductGrid.tsx:124`** add an explanatory comment on the `<= 3` threshold (decision: 3 is correct for bakery rotation) and align the module doc. Edit `docs/reference/04-modules/02-pos-cart-orders.md` (or `docs/objectif travail/POS.md`) where it states `<10` → note the implemented threshold is `<= 3` with rationale.

- [ ] **Step 4: typecheck + relevant tests**
```bash
pnpm --filter @breakery/pos typecheck
```

- [ ] **Step 5: Commit**
```bash
git add apps/pos/src/pages/Pos.tsx apps/pos/src/features/products/ProductGrid.tsx docs/reference/04-modules/02-pos-cart-orders.md
git commit -m "fix(pos): s34 wave 6.A — F-016 drawer callbacks + F-017 stock threshold doc + F-018 recover button"
```

---

### Task 6.B : Full test sweep + typecheck

- [ ] **Step 1: Run full POS + domain test suites**
```bash
pnpm --filter @breakery/pos test
pnpm --filter @breakery/domain test
```
Expected: all PASS (no regressions, incl. tablet flow `pay_existing_order_v6`).

- [ ] **Step 2: Full typecheck**
```bash
pnpm typecheck
```
Expected: 6/6 PASS.

- [ ] **Step 3: Re-run pgTAP suites via MCP** (`draft_order_flow`, `send_items_revoke`, + non-regression on existing order/tablet pgTAP). Expected: all PASS.

- [ ] **Step 4: If any failure → systematic-debugging skill, fix, re-run. Do not proceed until green.**

---

### Task 6.C : INDEX + CLAUDE.md bump

**Files:**
- Create `docs/workplan/plans/2026-05-29-session-34-INDEX.md`
- Modify `CLAUDE.md` (Active Workplan section)

- [ ] **Step 1: Write the INDEX** — wave-by-wave summary, migration block `20260619000010..017`, test counts (target ~46), deviation log (DEV-S34-* incl. R-S34-2/3 stock decision outcome, F-008 sweep findings, print-server external TODO, env-gated EF tests), and the runtime-verification note for F-001 KDS.

- [ ] **Step 2: Bump CLAUDE.md Active Workplan** — add the S34 reference paragraph (mirror the S32/S33 style), update "Current session" and "Migration sequence active" (`20260619000010..017`).

- [ ] **Step 3: Commit**
```bash
git add docs/workplan/plans/2026-05-29-session-34-INDEX.md CLAUDE.md
git commit -m "docs(s34): wave 6.C — session 34 INDEX + CLAUDE.md workplan bump"
```

---

## Self-review checklist (run before declaring the plan executable)

- [ ] Every spec §3-§6 requirement maps to a Task above (F-001→W1+W2, F-002→W3, F-004→W4, F-006→W5, F-008→W1.F, minor→W6).
- [ ] No placeholders: all SQL/TS shown or anchored on a named existing file to mirror.
- [ ] Type consistency: `draftOrderId`/`serverItemIds`/`clientUuid` names identical across cartStore (2.A), useSendToKitchen (2.B), useCheckout (2.D). `ReceiptTender` identical across printService (4.A) + SuccessModal (4.B). `orderTypeLabel`/`ORDER_TYPE_LABELS` identical across domain (3.A) + sites (3.B).
- [ ] Frequent commits: one per Task.
- [ ] TDD: tests-first in 2.B, 2.D, 3.A, 4.B.

---

## Execution handoff

Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per Task, review between Tasks. Waves 3, 4, 5 run in parallel (independent of Waves 1-2 and each other); Wave 2 waits on Wave 1; Wave 6 last. Use `superpowers:subagent-driven-development`.

**2. Inline Execution** — execute Tasks in-session with checkpoints. Use `superpowers:executing-plans`.
