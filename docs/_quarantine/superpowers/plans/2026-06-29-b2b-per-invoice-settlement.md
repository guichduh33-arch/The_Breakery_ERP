# B2B Per-Invoice Settlement (P1.2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make B2B payments settle individual invoices (real allocation ledger), set `paid_at` on full settlement, give the POS and BackOffice one reconciled source of truth, and add clean B2B order cancellation — closing audit findings T5/C3/C4.

**Architecture:** A new append-only `b2b_payment_allocations` table links each `b2b_payments` row to specific `orders` (invoices). All "outstanding" is derived from `orders.total − Σ amount_applied`. RPCs are bumped monotonically (v1→v2, DROP v1 same migration); views and the POS debts RPC are rebuilt on the allocation ledger; a read-only reconcile RPC alerts on cache↔ledger drift.

**Tech Stack:** PostgreSQL (Supabase cloud V3 dev `ikcyvlovptebroadgtvd`), plpgsql SECURITY DEFINER RPCs, pgTAP, React + TanStack Query (BO/POS), TypeScript.

**Spec:** `docs/superpowers/specs/2026-06-29-b2b-per-invoice-settlement-design.md`

## Global Constraints

- **DB target = Supabase cloud `ikcyvlovptebroadgtvd`** via MCP `mcp__claude_ai_Supabase__*`. NEVER `pnpm db:reset` / `supabase start` (Docker retired). Apply via `apply_migration`, run SQL/pgTAP via `execute_sql` (BEGIN/ROLLBACK envelope), regen types via `generate_typescript_types`.
- **CONTROLLER-ONLY DB steps:** Subagents CANNOT reach Supabase MCP. Subagents AUTHOR the `.sql` / `.ts` files; the controller (lead) APPLIES migrations, RUNS pgTAP, REGENERATES types, and VERIFIES on cloud. Every "apply / run pgTAP / regen types" step below is a controller action.
- **RPC versioning is monotonic** — never edit a published `_vN` signature; CREATE `_vN+1` and `DROP FUNCTION ... vN(<old args>)` in the SAME migration.
- **REVOKE pair (canonical, CLAUDE.md §S20/S25)** on every new function AND the new table: `REVOKE ALL ... FROM PUBLIC; REVOKE ALL ... FROM anon; GRANT EXECUTE/appropriate TO authenticated;` plus `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;` once per migration that adds functions.
- **Migration NAME-blocks are monotonic** — next free is `20260710000065` (highest existing is `20260710000064`). Local file names use the NAME-block; cloud `version` is clock-assigned at apply.
- **`stock_movements` append-only** — writes go through the same flag-aware raw pattern `create_b2b_order_v1` uses today (`supabase/migrations/20260710000059...`). Unifying via `record_stock_movement_v1` is OUT OF SCOPE (T2/P1.4).
- **Always regen types after schema change** — write to `packages/supabase/src/types.generated.ts` and commit. Missing regen = #1 CI breakage cause.
- **Order writes go through RPCs** — never raw inserts from app code.
- **Money/IDR rounding** uses the existing `round_idr(...)` helper. Account resolution uses `resolve_mapping_account('<KEY>')`. JE numbering uses `next_journal_entry_number(<date>)`. Fiscal guard `check_fiscal_period_open(<date>)`.
- **Idempotency** — RPC arg flavor (`p_idempotency_key UUID`), replay returns first result + `idempotent_replay: true`.

---

## File Structure

**Migrations (create):**
- `supabase/migrations/20260710000065_create_b2b_payment_allocations.sql` — table + RLS + REVOKE pair + indexes + FK.
- `supabase/migrations/20260710000066_seed_b2b_payment_record_cancel_perms.sql` — `b2b.payment.record` + `b2b.order.cancel` perms + role grants.
- `supabase/migrations/20260710000067_record_b2b_payment_v2.sql` — v2 (targeted+FIFO, real allocations, paid_at) + DROP v1 + REVOKE pair.
- `supabase/migrations/20260710000068_cancel_b2b_order_v1.sql` — new RPC + REVOKE pair.
- `supabase/migrations/20260710000069_create_b2b_order_v2_toctou.sql` — v2 (credit re-check post-lock) + DROP v1 + REVOKE pair.
- `supabase/migrations/20260710000070_rebuild_b2b_views_outstanding.sql` — `view_b2b_invoices` + `view_ar_aging` rebuilt on outstanding.
- `supabase/migrations/20260710000071_get_pos_b2b_debts_v3.sql` — v3 (B2B paid from allocations) + DROP v2 + REVOKE pair.
- `supabase/migrations/20260710000072_reconcile_b2b_balance_v1.sql` — read-only reconcile + REVOKE pair.

**Tests (create):**
- `supabase/tests/b2b_settlement.test.sql` — pgTAP acceptance suite.

**Types (modify, controller):**
- `packages/supabase/src/types.generated.ts` — regen after all migrations.

**UI (modify):**
- `apps/backoffice/src/features/btob/hooks/useRecordB2bPayment.ts` → v2 (+ optional `invoiceIds`).
- `apps/backoffice/src/features/btob/components/RecordB2bPaymentModal.tsx` → optional invoice multi-select.
- `apps/backoffice/src/features/btob/hooks/useCreateB2bOrder.ts` → v2.
- `apps/backoffice/src/features/btob/hooks/useCancelB2bOrder.ts` (create) + a Cancel action in the B2B invoices list component.
- POS: `apps/pos/src/features/.../CustomerDebtsPanel` + `useOutstandingDebts` → `get_pos_b2b_debts_v3`.

---

## WAVE 1 — Allocation ledger + permissions (DB foundation)

### Task 1: `b2b_payment_allocations` table

**Files:**
- Create: `supabase/migrations/20260710000065_create_b2b_payment_allocations.sql`

**Interfaces:**
- Produces: table `public.b2b_payment_allocations(id uuid, payment_id uuid, invoice_id uuid, amount_applied numeric(14,2), created_at timestamptz)`, UNIQUE `(payment_id, invoice_id)`. Consumed by Tasks 3, 5, 6, 7, 8.

- [ ] **Step 1: Author the migration SQL**

```sql
-- 20260710000065_create_b2b_payment_allocations.sql
-- S52 P1.2 — append-only ledger linking a B2B payment to specific invoices.
-- Outstanding-per-invoice = orders.total − Σ amount_applied. Single derivation point.
CREATE TABLE IF NOT EXISTS public.b2b_payment_allocations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id     uuid NOT NULL REFERENCES public.b2b_payments(id) ON DELETE RESTRICT,
  invoice_id     uuid NOT NULL REFERENCES public.orders(id)       ON DELETE RESTRICT,
  amount_applied numeric(14,2) NOT NULL CHECK (amount_applied > 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_b2b_alloc_invoice ON public.b2b_payment_allocations(invoice_id);
CREATE INDEX IF NOT EXISTS idx_b2b_alloc_payment ON public.b2b_payment_allocations(payment_id);

ALTER TABLE public.b2b_payment_allocations ENABLE ROW LEVEL SECURITY;

-- SELECT for authenticated; no INSERT/UPDATE/DELETE policy (written only by SECURITY DEFINER RPCs).
DROP POLICY IF EXISTS b2b_alloc_auth_read ON public.b2b_payment_allocations;
CREATE POLICY b2b_alloc_auth_read ON public.b2b_payment_allocations
  FOR SELECT TO authenticated USING (true);

-- Anon defense-in-depth + revoke writes (mirror b2b_payments _010).
REVOKE ALL ON public.b2b_payment_allocations FROM PUBLIC;
REVOKE ALL ON public.b2b_payment_allocations FROM anon;
GRANT SELECT ON public.b2b_payment_allocations TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;

COMMENT ON TABLE public.b2b_payment_allocations IS
  'S52 P1.2 — append-only allocation ledger (payment → invoice). Written only by '
  'record_b2b_payment_v2 (SECURITY DEFINER). invoice_outstanding = orders.total − Σ amount_applied.';
```

- [ ] **Step 2: (CONTROLLER) Apply via MCP**

Run `mcp__claude_ai_Supabase__apply_migration` with `project_id='ikcyvlovptebroadgtvd'`, `name='create_b2b_payment_allocations'`, body = the SQL above.
Expected: success (no error).

- [ ] **Step 3: (CONTROLLER) Verify table + grants**

Run `execute_sql`:
```sql
SELECT has_table_privilege('anon','public.b2b_payment_allocations','SELECT') AS anon_select,
       has_table_privilege('authenticated','public.b2b_payment_allocations','SELECT') AS auth_select,
       has_table_privilege('authenticated','public.b2b_payment_allocations','INSERT') AS auth_insert;
```
Expected: `anon_select=false`, `auth_select=true`, `auth_insert=false`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260710000065_create_b2b_payment_allocations.sql
git commit -m "feat(b2b): append-only b2b_payment_allocations ledger (S52 P1.2)"
```

---

### Task 2: New permissions `b2b.payment.record` + `b2b.order.cancel`

**Files:**
- Create: `supabase/migrations/20260710000066_seed_b2b_payment_record_cancel_perms.sql`

**Interfaces:**
- Produces: permission codes `b2b.payment.record`, `b2b.order.cancel` granted to SUPER_ADMIN/ADMIN/MANAGER. Consumed by Tasks 3 (gate) and 4 (gate).

- [ ] **Step 1: Author the migration SQL**

```sql
-- 20260710000066_seed_b2b_payment_record_cancel_perms.sql
-- S52 P1.2 — dedicated B2B perms (replace generic customers.update gate; new cancel gate).
-- Grant set mirrors current customers.update holders: SUPER_ADMIN/ADMIN/MANAGER (no CASHIER).
INSERT INTO permissions (code, module, action, description) VALUES
  ('b2b.payment.record', 'b2b', 'payment_record', 'Record a B2B customer payment and allocate it to invoices'),
  ('b2b.order.cancel',   'b2b', 'order_cancel',   'Cancel an unpaid B2B invoice (reverses JE + stock + AR balance)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code, is_granted, granted_at) VALUES
  ('SUPER_ADMIN', 'b2b.payment.record', true, now()),
  ('ADMIN',       'b2b.payment.record', true, now()),
  ('MANAGER',     'b2b.payment.record', true, now()),
  ('SUPER_ADMIN', 'b2b.order.cancel',   true, now()),
  ('ADMIN',       'b2b.order.cancel',   true, now()),
  ('MANAGER',     'b2b.order.cancel',   true, now())
ON CONFLICT (role_code, permission_code) DO NOTHING;
```

- [ ] **Step 2: (CONTROLLER) Apply via MCP**

`apply_migration` name=`seed_b2b_payment_record_cancel_perms`, body = SQL above. Expected: success.

- [ ] **Step 3: (CONTROLLER) Verify grants**

```sql
SELECT permission_code, count(*) FILTER (WHERE is_granted) AS roles
FROM role_permissions WHERE permission_code IN ('b2b.payment.record','b2b.order.cancel')
GROUP BY permission_code;
```
Expected: each = 3.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260710000066_seed_b2b_payment_record_cancel_perms.sql
git commit -m "feat(b2b): dedicated b2b.payment.record + b2b.order.cancel perms (S52 P1.2)"
```

---

## WAVE 2 — RPCs (DB write-path)

### Task 3: `record_b2b_payment_v2` (targeted + FIFO allocation, paid_at)

**Files:**
- Create: `supabase/migrations/20260710000067_record_b2b_payment_v2.sql`
- Reference (mirror boilerplate verbatim): `supabase/migrations/20260601000020_create_record_b2b_payment_v1.sql`

**Interfaces:**
- Consumes: `b2b_payment_allocations` (Task 1), `b2b.payment.record` (Task 2).
- Produces: `record_b2b_payment_v2(p_customer_id uuid, p_amount numeric, p_method payment_method, p_reference text DEFAULT NULL, p_paid_at timestamptz DEFAULT now(), p_notes text DEFAULT NULL, p_idempotency_key uuid DEFAULT NULL, p_invoice_ids uuid[] DEFAULT NULL) RETURNS jsonb`. Return keys: `payment_id, payment_number, allocations (jsonb array of {invoice_id, amount_applied, fully_settled}), allocation (legacy snapshot), je_id, customer_balance_after, idempotent_replay`. `v1` dropped.

- [ ] **Step 1: Author the migration SQL**

Mirror v1 (`20260601000020...`) blocks 1–6 verbatim (auth + profile lookup; **change the gate** to `has_permission(v_uid, 'b2b.payment.record')`; idempotency replay — return existing row plus reconstruct `allocations` from `b2b_payment_allocations WHERE payment_id = existing.id`; amount/customer validation; fiscal guard; `FOR UPDATE` customer lock; overpayment guard). Then JE block (8) and `b2b_payments` INSERT (9) and balance UPDATE (11) and audit (12) verbatim. **Replace block 7** (the metadata-only FIFO snapshot) with the real allocation algorithm below, and run it AFTER the `b2b_payments` row exists (so `payment_id` FK is available):

```sql
  -- (after INSERT b2b_payments ... RETURNING id INTO v_payment_id, and after wiring JE reference_id)
  -- === Allocation: targeted (p_invoice_ids in order) then FIFO remainder ===
  v_remaining := p_amount;
  v_alloc_json := '[]'::jsonb;

  -- helper inline: outstanding of an invoice = total − COALESCE(Σ alloc,0)
  -- 7a) Targeted invoices first, honoring array order.
  IF p_invoice_ids IS NOT NULL THEN
    FOREACH v_target_id IN ARRAY p_invoice_ids LOOP
      EXIT WHEN v_remaining <= 0;
      SELECT o.id, o.total, o.paid_at, o.status,
             o.total - COALESCE((SELECT SUM(a.amount_applied) FROM b2b_payment_allocations a WHERE a.invoice_id = o.id), 0)
        INTO v_inv
        FROM orders o
       WHERE o.id = v_target_id
         AND o.customer_id = p_customer_id
         AND o.order_type = 'b2b'
         AND o.status <> 'voided'
       FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'invalid_target_invoice: %', v_target_id USING ERRCODE = 'P0001'; -- check_violation-class
      END IF;
      IF v_inv.outstanding <= 0 THEN
        RAISE EXCEPTION 'target_invoice_already_settled: %', v_target_id USING ERRCODE = 'P0001';
      END IF;
      v_apply := LEAST(v_inv.outstanding, v_remaining);
      INSERT INTO b2b_payment_allocations (payment_id, invoice_id, amount_applied)
        VALUES (v_payment_id, v_target_id, v_apply);
      IF v_apply >= v_inv.outstanding THEN
        UPDATE orders SET paid_at = p_paid_at, status = 'paid' WHERE id = v_target_id;
        v_fully := TRUE;
      ELSE
        v_fully := FALSE;
      END IF;
      v_alloc_json := v_alloc_json || jsonb_build_object('invoice_id', v_target_id, 'amount_applied', v_apply, 'fully_settled', v_fully);
      v_remaining := v_remaining - v_apply;
    END LOOP;
  END IF;

  -- 7b) FIFO remainder over oldest unpaid b2b invoices not already fully covered.
  FOR v_inv IN
    SELECT o.id, o.total,
           o.total - COALESCE((SELECT SUM(a.amount_applied) FROM b2b_payment_allocations a WHERE a.invoice_id = o.id), 0) AS outstanding
      FROM orders o
     WHERE o.customer_id = p_customer_id
       AND o.order_type  = 'b2b'
       AND o.status      = 'b2b_pending'
     ORDER BY o.created_at ASC
     FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    CONTINUE WHEN v_inv.outstanding <= 0;
    -- skip if already allocated in 7a this call
    CONTINUE WHEN EXISTS (SELECT 1 FROM b2b_payment_allocations a WHERE a.payment_id = v_payment_id AND a.invoice_id = v_inv.id);
    v_apply := LEAST(v_inv.outstanding, v_remaining);
    INSERT INTO b2b_payment_allocations (payment_id, invoice_id, amount_applied)
      VALUES (v_payment_id, v_inv.id, v_apply);
    IF v_apply >= v_inv.outstanding THEN
      UPDATE orders SET paid_at = p_paid_at, status = 'paid' WHERE id = v_inv.id;
      v_fully := TRUE;
    ELSE
      v_fully := FALSE;
    END IF;
    v_alloc_json := v_alloc_json || jsonb_build_object('invoice_id', v_inv.id, 'amount_applied', v_apply, 'fully_settled', v_fully);
    v_remaining := v_remaining - v_apply;
  END LOOP;
```

Declare the new variables in the `DECLARE` block: `v_remaining numeric(14,2); v_apply numeric(14,2); v_alloc_json jsonb; v_target_id uuid; v_fully boolean; v_inv record;` (with `v_inv` having `.outstanding`). Persist `v_alloc_json` into both `b2b_payments.allocation` (legacy snapshot — set it via an `UPDATE b2b_payments SET allocation = v_alloc_json WHERE id = v_payment_id;` after the loops, since the row is inserted before allocation runs) and the return payload key `allocations`. Note: `p_amount` may legitimately exceed total outstanding only down to 0 by the overpayment guard at block 6 (balance−amount≥0), so leftover `v_remaining` after FIFO should be 0 in practice; if `v_remaining > 0` after both loops it means cache drift — leave it (balance already decremented; reconcile RPC will surface it). Append the REVOKE pair + DROP v1:

```sql
DROP FUNCTION IF EXISTS public.record_b2b_payment_v1(uuid, numeric, payment_method, text, timestamptz, text, uuid);

REVOKE ALL ON FUNCTION public.record_b2b_payment_v2(uuid, numeric, payment_method, text, timestamptz, text, uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_b2b_payment_v2(uuid, numeric, payment_method, text, timestamptz, text, uuid, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_b2b_payment_v2(uuid, numeric, payment_method, text, timestamptz, text, uuid, uuid[]) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

- [ ] **Step 2: (CONTROLLER) Apply via MCP** — `apply_migration` name=`record_b2b_payment_v2`. Expected: success.

- [ ] **Step 3: (CONTROLLER) Smoke verify** — `execute_sql` (BEGIN/ROLLBACK): confirm `record_b2b_payment_v1` is gone and v2 exists:
```sql
SELECT proname, pg_get_function_identity_arguments(oid)
FROM pg_proc WHERE proname IN ('record_b2b_payment_v1','record_b2b_payment_v2');
```
Expected: only `record_b2b_payment_v2` with the 8-arg signature.

- [ ] **Step 4: Commit**
```bash
git add supabase/migrations/20260710000067_record_b2b_payment_v2.sql
git commit -m "feat(b2b): record_b2b_payment_v2 — targeted+FIFO allocation, sets paid_at (S52 P1.2, C3)"
```

---

### Task 4: `cancel_b2b_order_v1`

**Files:**
- Create: `supabase/migrations/20260710000068_cancel_b2b_order_v1.sql`
- Reference (mirror reversal of): `supabase/migrations/20260710000059_create_b2b_order_flag_aware_stock.sql`

**Interfaces:**
- Consumes: `b2b_payment_allocations` (Task 1), `b2b.order.cancel` (Task 2).
- Produces: `cancel_b2b_order_v1(p_order_id uuid, p_reason text, p_idempotency_key uuid DEFAULT NULL) RETURNS jsonb`. Return: `order_id, order_number, reversed_je_id, balance_after, idempotent_replay`.

- [ ] **Step 1: Author the migration SQL**

```sql
-- 20260710000068_cancel_b2b_order_v1.sql
-- S52 P1.2 (T5) — cancel an UNPAID b2b invoice: reverse JE + stock + AR balance, set voided.
-- Blocked if any allocation exists (decision D2). Idempotent via audit_logs replay.
CREATE OR REPLACE FUNCTION public.cancel_b2b_order_v1(
  p_order_id uuid, p_reason text, p_idempotency_key uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_uid          uuid := auth.uid();
  v_profile_id   uuid;
  v_order        record;
  v_balance_before numeric(14,2);
  v_balance_after  numeric(14,2);
  v_je_id        uuid;
  v_entry_no     text;
  v_ar_id        uuid;
  v_revenue_id   uuid;
  v_now          timestamptz := now();
  v_existing     jsonb;
  v_line         record;
  v_cons         record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM user_profiles WHERE auth_user_id=v_uid AND deleted_at IS NULL LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'user_profile_not_found' USING ERRCODE='P0001'; END IF;
  IF NOT has_permission(v_uid, 'b2b.order.cancel') THEN
    RAISE EXCEPTION 'permission_denied: b2b.order.cancel' USING ERRCODE='P0003';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE='P0001';
  END IF;

  -- Idempotency replay (mirror adjust_b2b_balance_v2).
  IF p_idempotency_key IS NOT NULL THEN
    SELECT metadata INTO v_existing FROM audit_logs
     WHERE action='b2b.order.cancelled' AND metadata->>'idempotency_key'=p_idempotency_key::text LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'order_id', (v_existing->>'order_id')::uuid,
        'order_number', v_existing->>'order_number',
        'reversed_je_id', NULLIF(v_existing->>'reversed_je_id','')::uuid,
        'balance_after', (v_existing->>'balance_after')::numeric,
        'idempotent_replay', TRUE);
    END IF;
  END IF;

  SELECT id, order_number, customer_id, total, status, order_type
    INTO v_order FROM orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE='P0002'; END IF;
  IF v_order.order_type <> 'b2b' THEN RAISE EXCEPTION 'not_a_b2b_order' USING ERRCODE='P0001'; END IF;
  IF v_order.status <> 'b2b_pending' THEN
    RAISE EXCEPTION 'order_not_cancellable (status: %)', v_order.status USING ERRCODE='P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM b2b_payment_allocations WHERE invoice_id = p_order_id) THEN
    RAISE EXCEPTION 'order_has_payments' USING ERRCODE='P0011';
  END IF;

  -- Reverse stock flag-aware (mirror create_b2b_order_v1 _059, positive quantities).
  FOR v_line IN SELECT oi.product_id, oi.quantity FROM order_items oi WHERE oi.order_id = p_order_id LOOP
    DECLARE v_track boolean; v_deduct boolean; v_unit text; BEGIN
      SELECT track_inventory, deduct_stock, unit INTO v_track, v_deduct, v_unit FROM products WHERE id=v_line.product_id;
      IF v_track THEN
        INSERT INTO stock_movements (product_id, movement_type, quantity, unit, reference_type, reference_id, created_by)
          VALUES (v_line.product_id, 'adjustment', v_line.quantity, COALESCE(v_unit,'pcs'), 'orders', p_order_id, v_profile_id);
        UPDATE products SET current_stock = current_stock + v_line.quantity, updated_at=now() WHERE id=v_line.product_id;
      ELSIF v_deduct THEN
        FOR v_cons IN SELECT * FROM _resolve_recipe_consumption_v1(v_line.product_id, v_line.quantity) LOOP
          INSERT INTO stock_movements (product_id, movement_type, quantity, unit, reference_type, reference_id, created_by)
            VALUES (v_cons.product_id, 'adjustment', v_cons.qty_base, COALESCE(v_cons.unit,'pcs'), 'orders', p_order_id, v_profile_id);
          UPDATE products SET current_stock = current_stock + v_cons.qty_base, updated_at=now() WHERE id=v_cons.product_id;
        END LOOP;
      END IF;
    END;
  END LOOP;

  -- Reverse JE: DR Revenue / CR AR (contra of creation DR AR / CR Revenue).
  v_ar_id      := resolve_mapping_account('B2B_AR');
  v_revenue_id := resolve_mapping_account('SALE_B2B_REVENUE');
  PERFORM check_fiscal_period_open(v_now::date);
  v_entry_no   := next_journal_entry_number(v_now::date);
  INSERT INTO journal_entries (entry_number, entry_date, description, reference_type, reference_id, status, total_debit, total_credit, created_by)
    VALUES (v_entry_no, v_now::date, 'B2B order cancel '||v_order.order_number||' — '||left(p_reason,120),
            'b2b_order_cancel', p_order_id, 'posted', v_order.total, v_order.total, v_profile_id)
    RETURNING id INTO v_je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
    (v_je_id, v_revenue_id, v_order.total, 0, 'Reverse B2B revenue — '||v_order.order_number),
    (v_je_id, v_ar_id,      0, v_order.total, 'Reverse B2B AR — '||v_order.order_number);

  -- Decrement AR balance, guard >= 0.
  SELECT b2b_current_balance INTO v_balance_before FROM customers WHERE id=v_order.customer_id FOR UPDATE;
  v_balance_before := COALESCE(v_balance_before,0);
  v_balance_after  := v_balance_before - v_order.total;
  IF v_balance_after < 0 THEN
    RAISE EXCEPTION 'balance_underflow_on_cancel (before: %, total: %)', v_balance_before, v_order.total USING ERRCODE='P0011';
  END IF;
  UPDATE customers SET b2b_current_balance=v_balance_after, updated_at=now() WHERE id=v_order.customer_id;

  UPDATE orders SET status='voided', updated_at=now() WHERE id=p_order_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_profile_id, 'b2b.order.cancelled', 'orders', p_order_id, jsonb_build_object(
    'order_id', p_order_id, 'order_number', v_order.order_number, 'customer_id', v_order.customer_id,
    'total', v_order.total, 'reason', p_reason, 'reversed_je_id', v_je_id,
    'balance_before', v_balance_before, 'balance_after', v_balance_after,
    'idempotency_key', p_idempotency_key, 'rpc_version', 'v1'));

  RETURN jsonb_build_object('order_id', p_order_id, 'order_number', v_order.order_number,
    'reversed_je_id', v_je_id, 'balance_after', v_balance_after, 'idempotent_replay', FALSE);
END $func$;

REVOKE ALL ON FUNCTION public.cancel_b2b_order_v1(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_b2b_order_v1(uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_b2b_order_v1(uuid, text, uuid) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

> NOTE for implementer: verify `stock_movements` accepts `movement_type='adjustment'` with a single `reference` section (CLAUDE.md says `adjustment*` requires at least one section; this raw insert omits section ids as the creation path does — match the creation path exactly; if the creation path's `sale` insert worked without section ids, `adjustment` here will too since the constraint relaxation `_020` allows it). Also confirm `je_reference_type` enum (or check constraint) includes `'b2b_order_cancel'` — `20260710000060_extend_je_reference_type_b2b.sql` extended it for B2B; if `b2b_order_cancel` is missing, ADD it in THIS migration before the INSERT (controller verifies in Step 2).

- [ ] **Step 2: (CONTROLLER) Pre-check enum + apply** — first `execute_sql`:
```sql
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid='journal_entries'::regclass AND pg_get_constraintdef(oid) ILIKE '%reference_type%';
-- and/or: SELECT enum_range(NULL::je_reference_type);  -- if it is an enum
```
If `b2b_order_cancel` is absent, prepend the enum/constraint extension to the migration. Then `apply_migration` name=`cancel_b2b_order_v1`. Expected: success.

- [ ] **Step 3: Commit**
```bash
git add supabase/migrations/20260710000068_cancel_b2b_order_v1.sql
git commit -m "feat(b2b): cancel_b2b_order_v1 — reverse JE/stock/balance, block if allocated (S52 P1.2, T5)"
```

---

### Task 5: `create_b2b_order_v2` (TOCTOU credit re-check post-lock)

**Files:**
- Create: `supabase/migrations/20260710000069_create_b2b_order_v2_toctou.sql`
- Reference (copy verbatim, reorder): `supabase/migrations/20260710000059_create_b2b_order_flag_aware_stock.sql`

**Interfaces:**
- Produces: `create_b2b_order_v2(p_customer_id uuid, p_items jsonb, p_notes text DEFAULT NULL, p_delivery_date date DEFAULT NULL, p_idempotency_key uuid DEFAULT NULL) RETURNS jsonb` (same signature/return as v1). `v1` dropped.

- [ ] **Step 1: Author the migration SQL** — Copy the ENTIRE body of `create_b2b_order_v1` from `_059` verbatim, renamed to `create_b2b_order_v2`, with ONE change: **move the credit-limit validation to after the customer `FOR UPDATE` lock.** Specifically, delete the `v_credit_check := validate_b2b_credit_limit_v1(...)` block currently at lines ~164-169 (which runs before the lock), and re-insert it immediately AFTER the `SELECT b2b_current_balance INTO v_balance_before ... FOR UPDATE;` block (currently ~182-187), so the gate sees the locked balance:

```sql
  -- (after) SELECT b2b_current_balance INTO v_balance_before FROM customers WHERE id=p_customer_id FOR UPDATE;
  v_balance_before := COALESCE(v_balance_before, 0);

  -- TOCTOU fix (S52): re-check credit AFTER the lock, against the locked balance.
  v_credit_check := validate_b2b_credit_limit_v1(p_customer_id, v_items_total);
  IF (v_credit_check->>'allowed')::boolean = FALSE THEN
    RAISE EXCEPTION 'credit_limit_exceeded: %', v_credit_check::text
      USING ERRCODE='P0011', DETAIL = v_credit_check::text;
  END IF;

  v_balance_after := v_balance_before + v_items_total;
```

Keep the idempotency-replay early-return (which references `journal_entries` by `reference_type='b2b_order'`) and update the audit `rpc_version` to `'v2-toctou-s52'`. Append:
```sql
DROP FUNCTION IF EXISTS public.create_b2b_order_v1(uuid, jsonb, text, date, uuid);
REVOKE ALL ON FUNCTION public.create_b2b_order_v2(uuid, jsonb, text, date, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_b2b_order_v2(uuid, jsonb, text, date, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_b2b_order_v2(uuid, jsonb, text, date, uuid) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```
> Gate note: v1 used `has_permission(v_uid,'pos.sale.create')` — KEEP that gate in v2 (creating a B2B order is a sale; do not change it).

- [ ] **Step 2: (CONTROLLER) Apply + verify v1 dropped**
`apply_migration` name=`create_b2b_order_v2_toctou`; then `execute_sql` confirming only `create_b2b_order_v2` exists.

- [ ] **Step 3: Commit**
```bash
git add supabase/migrations/20260710000069_create_b2b_order_v2_toctou.sql
git commit -m "fix(b2b): create_b2b_order_v2 — credit re-check after FOR UPDATE lock (S52 P1.2, TOCTOU)"
```

---

## WAVE 3 — Views + POS reconciliation + reconcile RPC

### Task 6: Rebuild `view_b2b_invoices` + `view_ar_aging` on outstanding

**Files:**
- Create: `supabase/migrations/20260710000070_rebuild_b2b_views_outstanding.sql`
- Reference: `supabase/migrations/20260601000011_create_view_b2b_invoices.sql` + `20260601000012_create_view_ar_aging.sql`

**Interfaces:**
- Produces: `view_b2b_invoices` with added columns `amount_paid numeric`, `outstanding numeric`, `is_unpaid boolean` (= outstanding>0), excludes `voided`. `view_ar_aging` re-bucketed on `outstanding`. Consumed by BO hooks + pgTAP.

- [ ] **Step 1: Author the migration SQL**

```sql
-- 20260710000070_rebuild_b2b_views_outstanding.sql
-- S52 P1.2 (C3/C4) — views derive unpaid from the allocation ledger, not paid_at alone; exclude voided.
CREATE OR REPLACE VIEW public.view_b2b_invoices AS
SELECT
  o.id                                     AS invoice_id,
  o.order_number,
  o.customer_id,
  c.b2b_company_name,
  c.name                                   AS customer_name,
  o.total                                  AS invoice_total,
  COALESCE(a.amount_paid, 0)               AS amount_paid,
  (o.total - COALESCE(a.amount_paid, 0))   AS outstanding,
  o.created_at                             AS invoice_date,
  o.paid_at,
  o.status                                 AS order_status,
  (CURRENT_DATE - o.created_at::date)::int AS age_days,
  ((o.total - COALESCE(a.amount_paid, 0)) > 0) AS is_unpaid
FROM orders o
JOIN customers c ON c.id = o.customer_id
LEFT JOIN LATERAL (
  SELECT SUM(amount_applied) AS amount_paid FROM b2b_payment_allocations WHERE invoice_id = o.id
) a ON TRUE
WHERE c.customer_type = 'b2b'
  AND c.deleted_at IS NULL
  AND o.order_type = 'b2b'
  AND o.status <> 'voided';

COMMENT ON VIEW public.view_b2b_invoices IS
  'S52 — outstanding = total − Σ b2b_payment_allocations; is_unpaid = outstanding>0; excludes voided. SECURITY INVOKER.';

-- Rebuild view_ar_aging on outstanding (partial-payment aware). Mirror original bucket logic
-- but key the amount on outstanding rather than full total, and source from view_b2b_invoices.
CREATE OR REPLACE VIEW public.view_ar_aging AS
SELECT
  customer_id,
  customer_name,
  b2b_company_name,
  SUM(outstanding) FILTER (WHERE age_days <= 30)               AS bucket_current,
  SUM(outstanding) FILTER (WHERE age_days BETWEEN 31 AND 60)   AS bucket_31_60,
  SUM(outstanding) FILTER (WHERE age_days BETWEEN 61 AND 90)   AS bucket_61_90,
  SUM(outstanding) FILTER (WHERE age_days > 90)                AS bucket_90_plus,
  SUM(outstanding)                                             AS total_outstanding
FROM public.view_b2b_invoices
WHERE is_unpaid = TRUE
GROUP BY customer_id, customer_name, b2b_company_name;

COMMENT ON VIEW public.view_ar_aging IS 'S52 — AR aging by outstanding (partial-payment aware). SECURITY INVOKER.';
```
> Implementer: open `20260601000012_create_view_ar_aging.sql` first and MATCH its exact column names/bucket boundaries so BO `useB2bDashboard` keeps working (if the original used different column aliases like `current`/`d31_60`, reuse those exact aliases instead of the ones above). Controller verifies BO smoke in Wave 5.

- [ ] **Step 2: (CONTROLLER) Read original aging view, reconcile aliases, apply** — `execute_sql` `SELECT pg_get_viewdef('view_ar_aging'::regclass, true);` to capture current column names, adjust the SQL to match, then `apply_migration` name=`rebuild_b2b_views_outstanding`.

- [ ] **Step 3: Commit**
```bash
git add supabase/migrations/20260710000070_rebuild_b2b_views_outstanding.sql
git commit -m "feat(b2b): rebuild view_b2b_invoices/view_ar_aging on allocation ledger (S52 P1.2, C3)"
```

---

### Task 7: `get_pos_b2b_debts_v3` (B2B paid from allocations)

**Files:**
- Create: `supabase/migrations/20260710000071_get_pos_b2b_debts_v3.sql`
- Reference: `supabase/migrations/20260621000020_bump_get_pos_b2b_debts_v2.sql`

**Interfaces:**
- Produces: `get_pos_b2b_debts_v3(p_customer_id uuid DEFAULT NULL, p_lookback_days int DEFAULT 180)` — same RETURNS TABLE shape as v2. `v2` dropped.

- [ ] **Step 1: Author the migration SQL** — Copy v2 verbatim; change the `paid` derivation so B2B orders use `b2b_payment_allocations` while non-B2B keep `order_payments`:

```sql
DROP FUNCTION IF EXISTS public.get_pos_b2b_debts_v2(uuid, int);

CREATE OR REPLACE FUNCTION public.get_pos_b2b_debts_v3(
  p_customer_id uuid DEFAULT NULL, p_lookback_days int DEFAULT 180
) RETURNS TABLE (
  order_id uuid, order_number text, order_type text, total numeric, paid numeric,
  outstanding numeric, created_at timestamptz, customer_id uuid, customer_name text,
  customer_phone text, b2b_credit_limit numeric, b2b_current_balance numeric
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lookback int := LEAST(GREATEST(COALESCE(p_lookback_days,180),1),730);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='P0001'; END IF;
  RETURN QUERY
    SELECT o.id, o.order_number, o.order_type::text, o.total::numeric,
           CASE WHEN o.order_type = 'b2b'
                THEN COALESCE(alloc.paid, 0)
                ELSE COALESCE(op.paid, 0) END::numeric AS paid,
           (o.total - CASE WHEN o.order_type='b2b' THEN COALESCE(alloc.paid,0) ELSE COALESCE(op.paid,0) END)::numeric AS outstanding,
           o.created_at, c.id, c.name, c.phone,
           COALESCE(c.b2b_credit_limit,0)::numeric, COALESCE(c.b2b_current_balance,0)::numeric
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    LEFT JOIN LATERAL (SELECT SUM(op2.amount) AS paid FROM order_payments op2 WHERE op2.order_id=o.id) op ON TRUE
    LEFT JOIN LATERAL (SELECT SUM(a.amount_applied) AS paid FROM b2b_payment_allocations a WHERE a.invoice_id=o.id) alloc ON TRUE
    WHERE o.customer_id IS NOT NULL
      AND o.status <> 'voided'
      AND o.created_at >= now() - make_interval(days => v_lookback)
      AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
      AND (o.total - CASE WHEN o.order_type='b2b' THEN COALESCE(alloc.paid,0) ELSE COALESCE(op.paid,0) END) > 0.001
    ORDER BY o.created_at ASC;
END $$;

REVOKE ALL ON FUNCTION public.get_pos_b2b_debts_v3(uuid, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_pos_b2b_debts_v3(uuid, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_pos_b2b_debts_v3(uuid, int) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

- [ ] **Step 2: (CONTROLLER) Apply** — `apply_migration` name=`get_pos_b2b_debts_v3`. Expected: success.

- [ ] **Step 3: Commit**
```bash
git add supabase/migrations/20260710000071_get_pos_b2b_debts_v3.sql
git commit -m "feat(b2b): get_pos_b2b_debts_v3 — B2B paid from allocations, POS=BO (S52 P1.2, C4)"
```

---

### Task 8: `reconcile_b2b_balance_v1` (read-only drift alert)

**Files:**
- Create: `supabase/migrations/20260710000072_reconcile_b2b_balance_v1.sql`

**Interfaces:**
- Produces: `reconcile_b2b_balance_v1(p_customer_id uuid DEFAULT NULL)` RETURNS TABLE `(customer_id uuid, customer_name text, cached_balance numeric, derived_balance numeric, drift numeric, has_drift boolean)`. Gate `b2b.read`.

- [ ] **Step 1: Author the migration SQL**

```sql
-- 20260710000072_reconcile_b2b_balance_v1.sql
-- S52 P1.2 (D3) — read-only: cached b2b_current_balance vs ledger-derived outstanding. Alert only.
CREATE OR REPLACE FUNCTION public.reconcile_b2b_balance_v1(p_customer_id uuid DEFAULT NULL)
RETURNS TABLE (customer_id uuid, customer_name text, cached_balance numeric,
               derived_balance numeric, drift numeric, has_drift boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  IF NOT has_permission(auth.uid(), 'b2b.read') THEN
    RAISE EXCEPTION 'permission_denied: b2b.read' USING ERRCODE='P0003';
  END IF;
  RETURN QUERY
    SELECT c.id, c.name,
           COALESCE(c.b2b_current_balance,0)::numeric AS cached_balance,
           COALESCE(d.derived,0)::numeric             AS derived_balance,
           (COALESCE(c.b2b_current_balance,0) - COALESCE(d.derived,0))::numeric AS drift,
           (COALESCE(c.b2b_current_balance,0) <> COALESCE(d.derived,0))         AS has_drift
    FROM customers c
    LEFT JOIN LATERAL (
      SELECT SUM(v.outstanding) AS derived FROM view_b2b_invoices v
       WHERE v.customer_id = c.id AND v.is_unpaid = TRUE
    ) d ON TRUE
    WHERE c.customer_type = 'b2b' AND c.deleted_at IS NULL
      AND (p_customer_id IS NULL OR c.id = p_customer_id)
    ORDER BY abs(COALESCE(c.b2b_current_balance,0) - COALESCE(d.derived,0)) DESC;
END $$;

REVOKE ALL ON FUNCTION public.reconcile_b2b_balance_v1(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_b2b_balance_v1(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.reconcile_b2b_balance_v1(uuid) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

- [ ] **Step 2: (CONTROLLER) Apply** — `apply_migration` name=`reconcile_b2b_balance_v1`. Expected: success.

- [ ] **Step 3: Commit**
```bash
git add supabase/migrations/20260710000072_reconcile_b2b_balance_v1.sql
git commit -m "feat(b2b): reconcile_b2b_balance_v1 — cache vs ledger drift alert (S52 P1.2, D3)"
```

---

## WAVE 4 — pgTAP acceptance suite (CONTROLLER runs)

### Task 9: `b2b_settlement.test.sql`

**Files:**
- Create: `supabase/tests/b2b_settlement.test.sql`
- Reference fixtures: `supabase/tests/b2b_foundation.test.sql` (reuse its customer/product/session seed pattern; remember DEV-S51-W3-01: set `business_config.allow_negative_stock=false` only where stock guards are exercised, else the default `true` skips them; and DEV-S51-W3-02: reuse-or-insert the cashier session to avoid `one_open_session_per_user`).

**Interfaces:**
- Consumes: all RPCs/views/table from Waves 1-3.

- [ ] **Step 1: Author the pgTAP suite** — wrap in `BEGIN; SELECT plan(N); ... SELECT * FROM finish(); ROLLBACK;`. Cover, each as a discrete `ok()`/`is()`/`throws_ok()`:
  1. `b2b_payment_allocations` anon has no INSERT, authenticated has no INSERT (`throws_ok` on direct insert as authenticated role).
  2. Seed a b2b customer + 2 invoices via `create_b2b_order_v2`; record a partial payment via `record_b2b_payment_v2` (no `p_invoice_ids`) covering invoice 1 only → invoice 1 `paid_at` set + `status='paid'`; invoice 2 untouched.
  3. FIFO: payment covering both → both settled, allocations sum = payments.
  4. Targeted: `p_invoice_ids := ARRAY[invoice2]` settles invoice 2 first even though older invoice 1 exists.
  5. Targeted + FIFO remainder: targeted invoice2 amount < payment → remainder falls to invoice1.
  6. Partial payment: outstanding in `view_b2b_invoices` = total − applied; `is_unpaid` TRUE; `paid_at` NULL.
  7. POS = BO: after a B2B payment, `get_pos_b2b_debts_v3` outstanding for that invoice == `view_b2b_invoices.outstanding`.
  8. Cancel unpaid: `cancel_b2b_order_v1` → order `status='voided'`, gone from `view_b2b_invoices`, reversal JE exists (DR revenue/CR AR) and balances, `b2b_current_balance` decreased by total, stock restored (`current_stock` back up for a tracked product).
  9. Cancel blocked: allocate a payment, then `throws_ok(cancel_b2b_order_v1, ..., 'order_has_payments')`.
  10. TOCTOU: set `b2b_credit_limit` so a second order would exceed; assert `create_b2b_order_v2` raises `credit_limit_exceeded` (functional check that the gate fires; concurrency itself not simulated in pgTAP).
  11. Reconcile: manually corrupt cache via a SECURITY DEFINER path is not available to authenticated — instead create an invoice (balance up) then directly compare: `reconcile_b2b_balance_v1` returns `has_drift=false` when consistent; then settle one invoice and assert derived/ cached stay consistent (has_drift=false). (Drift injection requires owner UPDATE — assert the consistent path; document that true drift only arises from bypass.)
  12. Gates: `record_b2b_payment_v2` / `cancel_b2b_order_v1` throw `permission_denied` when called as a role lacking the perm (set `request.jwt.claims` / use a no-perm test user per the b2b_foundation pattern).
  13. Idempotency: same `p_idempotency_key` on `record_b2b_payment_v2` → second call `idempotent_replay=true`, no second allocation rows.

- [ ] **Step 2: (CONTROLLER) Run via MCP `execute_sql`** — paste the whole file content (it already contains BEGIN/ROLLBACK). Expected: all `N` tests pass, `finish()` reports no failures.

- [ ] **Step 3: Fix failures** — if any test fails, debug the RPC/view (author fix as a follow-up corrective migration `_073+`, monotonic; never edit an applied file), re-apply, re-run. Loop until green.

- [ ] **Step 4: Commit**
```bash
git add supabase/tests/b2b_settlement.test.sql
git commit -m "test(b2b): b2b_settlement pgTAP acceptance suite (S52 P1.2)"
```

- [ ] **Step 5: (CONTROLLER) Regression — re-run existing B2B suites** via `execute_sql`: `supabase/tests/b2b_foundation.test.sql` and `b2b_credit.test.sql`. If they reference `record_b2b_payment_v1` / `create_b2b_order_v1` / `get_pos_b2b_debts_v2`, update those references to the new versions (commit as `test(b2b): align existing suites to v2/v3 signatures`). Expected: green.

---

## WAVE 5 — Types regen + UI wiring

### Task 10: Regenerate types (CONTROLLER)

**Files:**
- Modify: `packages/supabase/src/types.generated.ts`

- [ ] **Step 1: (CONTROLLER) Regen** — `mcp__claude_ai_Supabase__generate_typescript_types` (`project_id='ikcyvlovptebroadgtvd'`); write the returned `types` to `packages/supabase/src/types.generated.ts`.
- [ ] **Step 2: Typecheck** — `pnpm --filter @breakery/supabase typecheck` (or `pnpm typecheck`). Expected: PASS.
- [ ] **Step 3: Commit**
```bash
git add packages/supabase/src/types.generated.ts
git commit -m "chore(types): regen after B2B settlement migrations (S52 P1.2)"
```

### Task 11: BO — repoint payment + create hooks, add cancel

**Files:**
- Modify: `apps/backoffice/src/features/btob/hooks/useRecordB2bPayment.ts`
- Modify: `apps/backoffice/src/features/btob/components/RecordB2bPaymentModal.tsx`
- Modify: `apps/backoffice/src/features/btob/hooks/useCreateB2bOrder.ts`
- Create: `apps/backoffice/src/features/btob/hooks/useCancelB2bOrder.ts`
- Modify: the B2B invoices list component (locate via grep for `view_b2b_invoices` consumer) to add a Cancel action.

- [ ] **Step 1: Read the three existing hooks** to match their `supabase.rpc(...)` + TanStack Query mutation pattern (and the `useRef(crypto.randomUUID())` idempotency pattern in `useRecordB2bPayment`).
- [ ] **Step 2: `useRecordB2bPayment` → `rpc('record_b2b_payment_v2', { ..., p_invoice_ids: invoiceIds ?? null })`**; thread an optional `invoiceIds?: string[]` through the mutation input.
- [ ] **Step 3: `RecordB2bPaymentModal`** — add an optional multi-select of the customer's unpaid invoices (source: `view_b2b_invoices` where `is_unpaid`), passing selected ids as `invoiceIds`; empty selection = FIFO (omit). Use existing UI primitives (see `breakery-ui-kit` skill — native `<select multiple>` fallback if no Select primitive).
- [ ] **Step 4: `useCreateB2bOrder` → `rpc('create_b2b_order_v2', {...})`** (same args).
- [ ] **Step 5: `useCancelB2bOrder`** — new mutation calling `rpc('cancel_b2b_order_v1', { p_order_id, p_reason, p_idempotency_key })` with `useRef` idempotency; invalidate the invoices + dashboard queries on success.
- [ ] **Step 6: Cancel action** in the invoices list — a confirm dialog (reason textarea, min 3 chars) gated on `b2b.order.cancel` via the existing `PermissionGate`.
- [ ] **Step 7: Typecheck + BO smoke** — `pnpm --filter @breakery/app-backoffice test b2b` and `pnpm typecheck`. Fix until green. Expected: PASS (note env-gated Vitest baseline per project memory — distinguish real failures from `VITE_SUPABASE_URL` baseline).
- [ ] **Step 8: Commit**
```bash
git add apps/backoffice/src/features/btob
git commit -m "feat(bo): B2B payment v2 (invoice select) + create v2 + cancel action (S52 P1.2)"
```

### Task 12: POS — repoint debts panel to v3

**Files:**
- Modify: POS `useOutstandingDebts` hook + `CustomerDebtsPanel` (grep `get_pos_b2b_debts_v2`).

- [ ] **Step 1: Grep** `rg "get_pos_b2b_debts_v2" apps/pos` to find call sites.
- [ ] **Step 2: Replace** `rpc('get_pos_b2b_debts_v2', ...)` → `rpc('get_pos_b2b_debts_v3', ...)` (same args). No shape change.
- [ ] **Step 3: Typecheck + POS smoke** — `pnpm --filter @breakery/app-pos test` (targeted) + `pnpm typecheck`. Expected: PASS.
- [ ] **Step 4: Commit**
```bash
git add apps/pos
git commit -m "feat(pos): debts panel → get_pos_b2b_debts_v3 (S52 P1.2, C4)"
```

---

## WAVE 6 — Closeout

### Task 13: Build + INDEX + CLAUDE.md + PR

- [ ] **Step 1: Full build/test** — `pnpm build && pnpm test` (turbo). Distinguish env-gated baseline failures from regressions (project memory). Expected: no new failures.
- [ ] **Step 2: Write session INDEX** — `docs/workplan/plans/2026-06-29-session-52-INDEX.md` (mirror the S51 INDEX structure: summary, migrations applied table with cloud versions, new files, files modified, tests run table, RPCs added/bumped, decisions D1-D4, deviations, acceptance A1-A9).
- [ ] **Step 3: Bump CLAUDE.md Active Workplan** — move P1.2 from "In flight"/"Prochaine vague" to "Merged (latest)"; bump RPC references (`record_b2b_payment_v1→v2`, `create_b2b_order_v1→v2`, `get_pos_b2b_debts_v2→v3`); note new table `b2b_payment_allocations` + perms `b2b.payment.record`/`b2b.order.cancel`; update the order-RPC list line; set the next "In flight" to the next P1 item (T2/P1.4 stock-deduction unification, or T6/P1.3 accounting correctness).
- [ ] **Step 4: Commit docs**
```bash
git add docs/workplan CLAUDE.md
git commit -m "docs(b2b): S52 INDEX + CLAUDE.md bump — B2B per-invoice settlement (P1.2)"
```
- [ ] **Step 5: Open PR** — `gh pr create --base master --head swarm/session-52` with a body summarizing closed findings (T5/C3/C4), migrations `20260710000065..072`, new table + perms, RPC bumps, and the pgTAP/regression results. Include the 🤖 Generated-with footer.

---

## Self-Review (completed by author)

- **Spec coverage:** §3 table → Task 1; §4.1 record v2 → Task 3; §4.2 cancel → Task 4; §4.3 create v2 TOCTOU → Task 5; §4.4 reconcile → Task 8; §5 views → Task 6; §5 POS v3 → Task 7; §6 perms → Task 2; §7 UI → Tasks 11-12; §8 testing → Tasks 9-10; §9 migrations → Tasks 1-8; §11 acceptance → Task 9 (A1-A7), Tasks 10/3/5/7 (A8), Task 9 Step 5 (A9). All covered.
- **Controller/subagent split:** every `apply_migration` / `execute_sql` / `generate_typescript_types` step is marked **(CONTROLLER)** — subagents author files only.
- **Type consistency:** RPC names used downstream (`record_b2b_payment_v2`, `create_b2b_order_v2`, `cancel_b2b_order_v1`, `get_pos_b2b_debts_v3`, `reconcile_b2b_balance_v1`) match their definitions; return-key `allocations` consistent between Task 3 and Task 9/11.
- **Open verification flagged inline:** je reference_type enum for `b2b_order_cancel` (Task 4 Step 2), `view_ar_aging` column aliases (Task 6 Step 2), `stock_movements` `adjustment` section constraint (Task 4 note). These are controller pre-checks, not placeholders.
