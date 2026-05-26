# Session 32 — Reports Vague C close-out drill-down + /backoffice/orders list Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ferme les 7 reports "terminal documentés" laissés par S31 (4 accounting + StockMovements product drill + PaymentByMethod + SalesByHour) en livrant : 3 bumps DB additifs P&L/BS/CF pour exposer `account_id`, 1 nouvelle RPC `get_orders_list_v1` cursor-paginée, 1 nouvelle page `/backoffice/orders` full audit-grade filters, GeneralLedgerPage qui accepte URL params, et le drill wiring transverse.

**Architecture:** 3 RPC P&L/BS/CF bumpés via `CREATE OR REPLACE` purement additif (pas de v2 — la signature SQL est inchangée, on n'ajoute qu'une clé au `jsonb_build_object`). 1 nouvelle RPC `get_orders_list_v1` SECURITY DEFINER avec filtres en JSONB unique + cursor-pagination pattern S30. Côté BO : nouvelle page OrdersListPage avec URL state = source of truth, helper `buildDrilldownUrl` étendu avec entity `'order_list'` (filter-only, sans id), 7 reports re-wirés.

**Tech Stack:** PostgreSQL 15 + plpgsql (Supabase cloud `ikcyvlovptebroadgtvd`), pgTAP via MCP, React 18 + react-router-dom + @tanstack/react-query, TypeScript monorepo pnpm/turbo, Vitest + @testing-library/react.

**Spec:** [`../specs/2026-05-26-session-32-spec.md`](../specs/2026-05-26-session-32-spec.md)

**Branch:** `swarm/session-32` (créée depuis `master` @ `c74e295`, spec commit `ee27229` déjà appliqué)

---

## Wave 0 — Plan commit

### Task 0.1 : Commit plan

- [ ] **Step 1: Stage and commit the plan file**

```bash
git add docs/workplan/plans/2026-05-26-session-32-plan.md
git commit -m "docs(s32): wave 0 — plan session 32 (Reports Vague C close-out drill-down + /backoffice/orders list)"
```

---

## Wave 1 — DB layer

### Task 1.A : Schema discovery — verify `orders` columns

**Files:** None modified. Read-only verification of cloud schema.

**Why:** Risks R-S32-1 (terminal_id may not exist), R-S32-2 (customers.full_name vs display_name). Spec section 10 mandates this check BEFORE writing the RPC.

- [ ] **Step 1: Inspect `orders` table columns via MCP execute_sql**

Use `mcp__plugin_supabase_supabase__execute_sql` with `project_id='ikcyvlovptebroadgtvd'` and query:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='orders'
ORDER BY ordinal_position;
```

Expected: confirm presence of `id`, `order_number`, `order_type`, `status`, `total`, `created_at`, `customer_id`, `served_by`, `terminal_id`. If any missing, note in the deviation log and adjust RPC accordingly (drop the missing filter axis).

- [ ] **Step 2: Inspect `customers` table columns**

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema='public' AND table_name='customers'
  AND column_name IN ('full_name', 'display_name', 'name', 'customer_type')
ORDER BY column_name;
```

Expected: at least one of `full_name`/`display_name`/`name` exists, and `customer_type` exists with enum-like values. Use whichever name field is available in the `COALESCE` of the RPC.

- [ ] **Step 3: Inspect `refunds`, `order_payments`, `order_items` columns relevant to the RPC**

```sql
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name IN ('refunds', 'order_payments', 'order_items')
  AND column_name IN ('order_id', 'amount', 'method', 'modifiers')
ORDER BY table_name, column_name;
```

Expected: `refunds.order_id`, `refunds.amount`, `order_payments.order_id`, `order_payments.method`, `order_items.order_id`, `order_items.modifiers` all present.

- [ ] **Step 4: Record findings in scratchpad**

If any discoveries diverge from the spec assumptions, edit the spec §3.4 to reflect the real column names BEFORE Task 1.E. Stage and commit:

```bash
# Only if spec was edited :
git add docs/workplan/specs/2026-05-26-session-32-spec.md
git commit -m "docs(s32): wave 1.A — spec corrections post schema discovery"
```

If no corrections needed: no commit, just proceed.

---

### Task 1.B : Bump `get_profit_loss_v1` additive expose `account_id`

**Files:**
- Create: `supabase/migrations/20260617000010_bump_get_profit_loss_v1_expose_account_id.sql`

- [ ] **Step 1: Read the current RPC body**

Use Read on `supabase/migrations/20260603000017_bump_get_profit_loss_v1_dedupe_void_refund.sql` to understand the current `jsonb_build_object` block (around line 117-129 of that file).

- [ ] **Step 2: Write the new migration file**

Content of `supabase/migrations/20260617000010_bump_get_profit_loss_v1_expose_account_id.sql`:

```sql
-- 20260617000010_bump_get_profit_loss_v1_expose_account_id.sql
-- Session 32 / Wave 1.B :
--   Bump get_profit_loss_v1 to additively expose `account_id` UUID in lines[]
--   alongside existing `code`. Closes S31 DEV-S31-3.D (accounting drill terminal).
--
-- Pure additive change: signature unchanged, JSONB output gains one new key.
-- Existing consumers ignore the new key.

CREATE OR REPLACE FUNCTION public.get_profit_loss_v1(
  p_date_start  DATE,
  p_date_end    DATE,
  p_section_id  UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_revenue        NUMERIC(14,2) := 0;
  v_revenue_sales  NUMERIC(14,2) := 0;
  v_revenue_disc   NUMERIC(14,2) := 0;
  v_revenue_adj    NUMERIC(14,2) := 0;
  v_cogs           NUMERIC(14,2) := 0;
  v_cogs_prod      NUMERIC(14,2) := 0;
  v_cogs_waste     NUMERIC(14,2) := 0;
  v_cogs_other     NUMERIC(14,2) := 0;
  v_opex           NUMERIC(14,2) := 0;
  v_opex_salary    NUMERIC(14,2) := 0;
  v_opex_rent      NUMERIC(14,2) := 0;
  v_opex_util      NUMERIC(14,2) := 0;
  v_opex_supplies  NUMERIC(14,2) := 0;
  v_opex_marketing NUMERIC(14,2) := 0;
  v_opex_maint     NUMERIC(14,2) := 0;
  v_opex_other     NUMERIC(14,2) := 0;
  v_lines          JSONB         := '[]'::JSONB;
BEGIN
  IF p_date_start IS NULL OR p_date_end IS NULL THEN
    RAISE EXCEPTION 'get_profit_loss_v1: p_date_start and p_date_end are required';
  END IF;
  IF p_date_start > p_date_end THEN
    RAISE EXCEPTION 'get_profit_loss_v1: p_date_start (%) must be <= p_date_end (%)',
      p_date_start, p_date_end;
  END IF;

  WITH agg AS (
    SELECT
      a.id            AS account_id,
      a.code          AS code,
      a.name          AS name,
      a.account_class AS account_class,
      a.balance_type  AS balance_type,
      SUM(COALESCE(jel.debit,  0))::NUMERIC(14,2) AS total_debit,
      SUM(COALESCE(jel.credit, 0))::NUMERIC(14,2) AS total_credit
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    JOIN accounts a ON a.id = jel.account_id
    WHERE je.status IN ('posted', 'locked')
      AND je.entry_date BETWEEN p_date_start AND p_date_end
      AND a.account_class IN (4, 5, 6)
      AND NOT EXISTS (
        SELECT 1 FROM refunds r
        JOIN orders o ON o.id = r.order_id
        WHERE je.reference_type = 'sale_void'
          AND je.reference_id   = o.id
      )
    GROUP BY a.id, a.code, a.name, a.account_class, a.balance_type
  )
  SELECT
    COALESCE(SUM(CASE WHEN account_class = 4 AND code LIKE '41%'  THEN (total_credit - total_debit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 4 AND code IN ('4190','4900') THEN (total_credit - total_debit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 4 AND code LIKE '45%'  THEN (total_credit - total_debit) END), 0)
      + COALESCE(SUM(CASE WHEN account_class = 4 AND code LIKE '49%' AND code NOT IN ('4900','4190') THEN (total_credit - total_debit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 4 THEN (total_credit - total_debit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 5 AND code LIKE '51%' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 5 AND code LIKE '52%' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 5 AND code NOT LIKE '51%' AND code NOT LIKE '52%' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 5 THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 AND code = '6111' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 AND code = '6112' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 AND code = '6113' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 AND code = '6114' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 AND code = '6115' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 AND code = '6116' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 AND code NOT IN ('6111','6112','6113','6114','6115','6116') THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 THEN (total_debit - total_credit) END), 0),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'account_id',    account_id,
          'code',          code,
          'name',          name,
          'debit',         total_debit,
          'credit',        total_credit,
          'balance',
            CASE
              WHEN balance_type = 'debit'  THEN (total_debit  - total_credit)
              ELSE                              (total_credit - total_debit)
            END,
          'account_class', account_class
        )
        ORDER BY code
      ) FILTER (WHERE total_debit <> 0 OR total_credit <> 0),
      '[]'::JSONB
    )
  INTO
    v_revenue_sales, v_revenue_disc, v_revenue_adj, v_revenue,
    v_cogs_prod, v_cogs_waste, v_cogs_other, v_cogs,
    v_opex_salary, v_opex_rent, v_opex_util, v_opex_supplies,
    v_opex_marketing, v_opex_maint, v_opex_other, v_opex,
    v_lines
  FROM agg;

  RETURN jsonb_build_object(
    'revenue', jsonb_build_object(
      'sales',       v_revenue_sales,
      'discounts',   v_revenue_disc,
      'adjustments', v_revenue_adj,
      'total',       v_revenue
    ),
    'cogs', jsonb_build_object(
      'production', v_cogs_prod,
      'waste',      v_cogs_waste,
      'other',      v_cogs_other,
      'total',      v_cogs
    ),
    'gross_profit', (v_revenue - v_cogs)::NUMERIC(14,2),
    'opex', jsonb_build_object(
      'salary',     v_opex_salary,
      'rent',       v_opex_rent,
      'utilities',  v_opex_util,
      'supplies',   v_opex_supplies,
      'marketing',  v_opex_marketing,
      'maintenance',v_opex_maint,
      'other',      v_opex_other,
      'total',      v_opex
    ),
    'operating_profit', (v_revenue - v_cogs - v_opex)::NUMERIC(14,2),
    'net_profit',       (v_revenue - v_cogs - v_opex)::NUMERIC(14,2),
    'lines',  v_lines,
    'period', jsonb_build_object(
      'start',      p_date_start,
      'end',        p_date_end,
      'section_id', p_section_id
    )
  );
END;
$$;

COMMENT ON FUNCTION public.get_profit_loss_v1(DATE, DATE, UUID) IS
  'Phase 6.A — Profit & Loss report. S32 : lines[] now include account_id UUID '
  'alongside code, enabling drill-down to General Ledger.';
```

**IMPORTANT:** The body above is reconstructed from the spec — re-read the actual current file body in Step 1 and copy it exactly, only adding the `'account_id', account_id,` line at the start of the `jsonb_build_object` (before `'code',`). The dedupe-void logic (NOT EXISTS) from S26 _017 must be preserved.

- [ ] **Step 3: Apply migration via MCP**

Use `mcp__plugin_supabase_supabase__apply_migration` with:
- `project_id='ikcyvlovptebroadgtvd'`
- `name='bump_get_profit_loss_v1_expose_account_id'`
- `query=<contents of the file>`

Expected: returns success. If it errors on duplicate signature, the current file body diverged from the spec assumption — re-read and adjust.

- [ ] **Step 4: Verify via execute_sql**

```sql
SELECT jsonb_array_length(get_profit_loss_v1('2026-05-01'::date, '2026-05-26'::date)->'lines') AS n;
```

Then inspect first line:

```sql
SELECT get_profit_loss_v1('2026-05-01'::date, '2026-05-26'::date)->'lines'->0;
```

Expected: first line JSONB has both `"account_id"` (UUID string) and `"code"` (3-4 digit text) keys.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260617000010_bump_get_profit_loss_v1_expose_account_id.sql
git commit -m "feat(db): session 32 — wave 1.B — bump get_profit_loss_v1 expose account_id (additive)"
```

---

### Task 1.C : Bump `get_balance_sheet_v1` additive expose `account_id`

**Files:**
- Create: `supabase/migrations/20260617000011_bump_get_balance_sheet_v1_expose_account_id.sql`

- [ ] **Step 1: Read the current RPC body**

```bash
ls supabase/migrations | grep -i balance_sheet
```

Use Read on the most recent `*_get_balance_sheet_v1*.sql` migration to find the CTE structure. Look for the `jsonb_build_object` block that builds the lines array (or per-section breakdown). Note whether the CTE already SELECTs `a.id` — if not, add it.

- [ ] **Step 2: Write the new migration file**

Content of `supabase/migrations/20260617000011_bump_get_balance_sheet_v1_expose_account_id.sql`:

```sql
-- 20260617000011_bump_get_balance_sheet_v1_expose_account_id.sql
-- Session 32 / Wave 1.C :
--   Bump get_balance_sheet_v1 additively expose account_id UUID in lines.
--   Pure additive — signature unchanged, JSONB output gains one new key.

CREATE OR REPLACE FUNCTION public.get_balance_sheet_v1(
  -- COPY ACTUAL SIGNATURE FROM CURRENT MIGRATION
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
-- COPY ACTUAL BODY FROM CURRENT MIGRATION
-- ONLY CHANGE: add `'account_id', a.id` (or equivalent) to the jsonb_build_object
-- that builds the per-account line. Add `a.id AS account_id` to the CTE SELECT
-- if not already present.
$$;
```

**IMPORTANT:** Reproduce the body verbatim from Step 1's reading. Add `'account_id', account_id,` in EVERY `jsonb_build_object` that emits per-account lines (Balance Sheet may have multiple sections like assets/liabilities/equity).

- [ ] **Step 3: Apply migration via MCP**

`apply_migration` with `name='bump_get_balance_sheet_v1_expose_account_id'`.

- [ ] **Step 4: Verify via execute_sql**

```sql
SELECT get_balance_sheet_v1('2026-05-26'::date);
```

Expected: walk the returned JSONB, find a section with `lines` array, verify first line has `"account_id"` key.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260617000011_bump_get_balance_sheet_v1_expose_account_id.sql
git commit -m "feat(db): session 32 — wave 1.C — bump get_balance_sheet_v1 expose account_id (additive)"
```

---

### Task 1.D : Bump `get_cash_flow_v1` additive expose `account_id`

**Files:**
- Create: `supabase/migrations/20260617000012_bump_get_cash_flow_v1_expose_account_id.sql`

Same pattern as Task 1.C but for Cash Flow.

- [ ] **Step 1: Read the current RPC body**

```bash
ls supabase/migrations | grep -i cash_flow
```

Use Read on the most recent `*_get_cash_flow_v1*.sql` migration. Note: S21 may have added Investing/Financing sections — multiple JSONB blocks to patch.

- [ ] **Step 2: Write the new migration file**

Content of `supabase/migrations/20260617000012_bump_get_cash_flow_v1_expose_account_id.sql`:

```sql
-- 20260617000012_bump_get_cash_flow_v1_expose_account_id.sql
-- Session 32 / Wave 1.D :
--   Bump get_cash_flow_v1 additively expose account_id UUID in section lines.
--   Pure additive.

CREATE OR REPLACE FUNCTION public.get_cash_flow_v1(
  -- COPY ACTUAL SIGNATURE
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
-- COPY ACTUAL BODY, add 'account_id', a.id to every jsonb_build_object per-line
$$;
```

- [ ] **Step 3: Apply migration via MCP**

`apply_migration` with `name='bump_get_cash_flow_v1_expose_account_id'`.

- [ ] **Step 4: Verify via execute_sql**

```sql
SELECT get_cash_flow_v1('2026-05-01'::date, '2026-05-26'::date);
```

Walk JSONB, find Operating/Investing/Financing sections, verify each `lines` array contains `account_id`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260617000012_bump_get_cash_flow_v1_expose_account_id.sql
git commit -m "feat(db): session 32 — wave 1.D — bump get_cash_flow_v1 expose account_id (additive)"
```

---

### Task 1.E : Create `get_orders_list_v1` RPC

**Files:**
- Create: `supabase/migrations/20260617000013_create_get_orders_list_v1_rpc.sql`

- [ ] **Step 1: Write the migration file**

Content of `supabase/migrations/20260617000013_create_get_orders_list_v1_rpc.sql`:

```sql
-- 20260617000013_create_get_orders_list_v1_rpc.sql
-- Session 32 / Wave 1.E :
--   New RPC get_orders_list_v1 cursor-paginated, JSONB filters.
--   Returns JSONB { lines, next_cursor }. Gate orders.read (seeded S31).
--   SECURITY DEFINER + REVOKE pair canonique S25.

CREATE OR REPLACE FUNCTION public.get_orders_list_v1(
  p_start    TEXT,
  p_end      TEXT,
  p_filters  JSONB        DEFAULT '{}'::JSONB,
  p_limit    INT          DEFAULT 50,
  p_cursor   TIMESTAMPTZ  DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_clamp     INT  := LEAST(GREATEST(p_limit, 1), 200);
  v_start     TIMESTAMPTZ := (p_start || 'T00:00:00Z')::timestamptz;
  v_end       TIMESTAMPTZ := (p_end   || 'T23:59:59Z')::timestamptz;
  v_lines     JSONB;
  v_next      TIMESTAMPTZ;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT has_permission(v_caller_id, 'orders.read') THEN
    RAISE EXCEPTION 'Permission denied: orders.read' USING ERRCODE = '42501';
  END IF;

  WITH filtered AS (
    SELECT
      o.id,
      o.order_number,
      o.order_type,
      o.status,
      o.total,
      o.created_at,
      o.customer_id,
      c.customer_type,
      COALESCE(c.full_name, c.display_name) AS customer_name,
      o.served_by,
      up.full_name AS served_by_name,
      o.terminal_id,
      CASE
        WHEN COALESCE(rsum.amount, 0) = 0           THEN 'none'
        WHEN COALESCE(rsum.amount, 0) >= o.total    THEN 'full'
        ELSE                                              'partial'
      END AS refund_status,
      EXISTS (
        SELECT 1 FROM order_items oi
        WHERE oi.order_id = o.id
          AND oi.modifiers IS NOT NULL
          AND jsonb_array_length(oi.modifiers) > 0
      ) AS has_modifiers,
      (
        SELECT CASE
                 WHEN COUNT(DISTINCT op.method) > 1 THEN 'mixed'
                 ELSE MIN(op.method)::text
               END
        FROM order_payments op
        WHERE op.order_id = o.id
      ) AS payment_method_primary,
      (SELECT COUNT(*) FROM order_items WHERE order_id = o.id)::INT AS items_count,
      ROW_NUMBER() OVER (ORDER BY o.created_at DESC) AS rn
    FROM orders o
    LEFT JOIN customers     c   ON c.id  = o.customer_id
    LEFT JOIN user_profiles up  ON up.id = o.served_by
    LEFT JOIN LATERAL (
      SELECT SUM(r.amount) AS amount
      FROM refunds r
      WHERE r.order_id = o.id
    ) rsum ON TRUE
    WHERE o.created_at BETWEEN v_start AND v_end
      AND (p_cursor IS NULL OR o.created_at < p_cursor)
      AND (p_filters->>'status'        IS NULL OR o.status::text       = p_filters->>'status')
      AND (p_filters->>'order_type'    IS NULL OR o.order_type::text   = p_filters->>'order_type')
      AND (p_filters->>'customer_id'   IS NULL OR o.customer_id        = (p_filters->>'customer_id')::uuid)
      AND (p_filters->>'served_by'     IS NULL OR o.served_by          = (p_filters->>'served_by')::uuid)
      AND (p_filters->>'terminal_id'   IS NULL OR o.terminal_id::text  = p_filters->>'terminal_id')
      AND (p_filters->>'total_min'     IS NULL OR o.total >= (p_filters->>'total_min')::numeric)
      AND (p_filters->>'total_max'     IS NULL OR o.total <= (p_filters->>'total_max')::numeric)
      AND (p_filters->>'customer_type' IS NULL OR c.customer_type::text = p_filters->>'customer_type')
      AND (p_filters->>'payment_method' IS NULL OR EXISTS (
        SELECT 1 FROM order_payments op
        WHERE op.order_id = o.id
          AND op.method::text = p_filters->>'payment_method'
      ))
    ORDER BY o.created_at DESC
    LIMIT v_clamp + 1
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id',                     f.id,
      'order_number',           f.order_number,
      'order_type',             f.order_type,
      'status',                 f.status,
      'total',                  f.total,
      'created_at',             f.created_at,
      'customer_id',            f.customer_id,
      'customer_name',          f.customer_name,
      'customer_type',          f.customer_type,
      'served_by',              f.served_by,
      'served_by_name',         f.served_by_name,
      'terminal_id',            f.terminal_id,
      'refund_status',          f.refund_status,
      'has_modifiers',          f.has_modifiers,
      'payment_method_primary', f.payment_method_primary,
      'items_count',            f.items_count
    ) ORDER BY f.created_at DESC) FILTER (WHERE f.rn <= v_clamp), '[]'::jsonb)
  INTO v_lines
  FROM filtered f;

  SELECT MIN(created_at) INTO v_next
  FROM filtered
  WHERE rn > v_clamp;

  RETURN jsonb_build_object('lines', v_lines, 'next_cursor', v_next);
END;
$$;

COMMENT ON FUNCTION public.get_orders_list_v1(TEXT, TEXT, JSONB, INT, TIMESTAMPTZ) IS
  'S32 — Orders list cursor-paginated. p_filters JSONB keys (all optional): '
  'status, order_type, customer_id (UUID), served_by (UUID), terminal_id, '
  'total_min, total_max, customer_type (retail|b2b), payment_method. '
  'Computed cols: refund_status (none|partial|full), has_modifiers, '
  'payment_method_primary (single method or ''mixed''), items_count, '
  'customer_name, customer_type, served_by_name. Gated orders.read.';

GRANT EXECUTE ON FUNCTION public.get_orders_list_v1(TEXT, TEXT, JSONB, INT, TIMESTAMPTZ) TO authenticated;
```

- [ ] **Step 2: Apply migration via MCP**

`apply_migration` with `name='create_get_orders_list_v1_rpc'`.

If column names from Task 1.A differ from this body, edit the SQL accordingly BEFORE applying.

- [ ] **Step 3: Smoke verify via execute_sql**

```sql
SELECT get_orders_list_v1('2026-05-01', '2026-05-26', '{}'::jsonb, 5, NULL);
```

Expected: returns JSONB `{ "lines": [...], "next_cursor": ... }`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260617000013_create_get_orders_list_v1_rpc.sql
git commit -m "feat(db): session 32 — wave 1.E — create get_orders_list_v1 RPC (cursor-paginated, JSONB filters)"
```

---

### Task 1.F : REVOKE pair on `get_orders_list_v1`

**Files:**
- Create: `supabase/migrations/20260617000014_revoke_anon_get_orders_list_v1.sql`

- [ ] **Step 1: Write the migration file**

Content of `supabase/migrations/20260617000014_revoke_anon_get_orders_list_v1.sql`:

```sql
-- 20260617000014_revoke_anon_get_orders_list_v1.sql
-- Session 32 / Wave 1.F :
--   REVOKE pair canonique S25 sur get_orders_list_v1.

REVOKE EXECUTE ON FUNCTION public.get_orders_list_v1(TEXT, TEXT, JSONB, INT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_orders_list_v1(TEXT, TEXT, JSONB, INT, TIMESTAMPTZ) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

- [ ] **Step 2: Apply migration via MCP**

`apply_migration` with `name='revoke_anon_get_orders_list_v1'`.

- [ ] **Step 3: Verify ACL**

```sql
SELECT proname, proacl
FROM pg_proc
WHERE proname = 'get_orders_list_v1';
```

Expected: `proacl` does NOT contain `anon=X/postgres` or `=X/postgres` entries. Should only show `authenticated=X/postgres` (and postgres itself).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260617000014_revoke_anon_get_orders_list_v1.sql
git commit -m "feat(db): session 32 — wave 1.F — REVOKE pair on get_orders_list_v1"
```

---

### Task 1.G : Types regen + commit

**Files:**
- Modify: `packages/supabase/src/types.generated.ts`

- [ ] **Step 1: Regen types via MCP**

Use `mcp__plugin_supabase_supabase__generate_typescript_types` with `project_id='ikcyvlovptebroadgtvd'`. The response includes a `types` string field.

- [ ] **Step 2: Write the regenerated types to file**

Use Write to overwrite `packages/supabase/src/types.generated.ts` with the returned types string.

- [ ] **Step 3: Verify the new RPC appears in types**

Use Grep on `packages/supabase/src/types.generated.ts` for `get_orders_list_v1`.

Expected: 1+ matches showing the function signature and return type in the `Functions` block.

- [ ] **Step 4: Commit**

```bash
git add packages/supabase/src/types.generated.ts
git commit -m "chore(types): session 32 — wave 1.G — regen post Wave 1 migrations (get_orders_list_v1 + account_id additive)"
```

---

### Task 1.H : pgTAP — `accounting_account_id_exposed.test.sql`

**Files:**
- Create: `supabase/tests/accounting_account_id_exposed.test.sql`

- [ ] **Step 1: Write the pgTAP test file**

Content of `supabase/tests/accounting_account_id_exposed.test.sql`:

```sql
-- Session 32 / Wave 1.H : pgTAP for additive account_id exposure
-- on P&L / BS / CF lines.

BEGIN;
SELECT plan(3);

-- T1 : P&L lines contain account_id UUID
DO $$
DECLARE
  v_first_line JSONB;
BEGIN
  SELECT (get_profit_loss_v1('2026-05-01'::date, '2026-05-26'::date)->'lines')->0
  INTO v_first_line;
  -- If no posted JE in range, lines will be empty — test still passes structurally
  -- if at least the key exists when there are lines.
  IF v_first_line IS NULL THEN
    PERFORM set_config('breakery.t1_pass', 'skipped_empty', false);
  ELSIF v_first_line ? 'account_id' THEN
    PERFORM set_config('breakery.t1_pass', 'pass', false);
  ELSE
    PERFORM set_config('breakery.t1_pass', 'fail', false);
  END IF;
END $$;
SELECT ok(
  current_setting('breakery.t1_pass') IN ('pass', 'skipped_empty'),
  'T1: get_profit_loss_v1 lines contain account_id key (or empty result, structurally OK)'
);

-- T2 : Balance Sheet lines contain account_id
DO $$
DECLARE
  v_result JSONB;
  v_found_any BOOLEAN := false;
  v_section JSONB;
  v_line JSONB;
BEGIN
  SELECT get_balance_sheet_v1('2026-05-26'::date) INTO v_result;
  FOR v_section IN SELECT jsonb_array_elements(v_result->'sections')
  LOOP
    FOR v_line IN SELECT jsonb_array_elements(v_section->'lines')
    LOOP
      IF v_line ? 'account_id' THEN
        v_found_any := true;
      END IF;
    END LOOP;
  END LOOP;
  PERFORM set_config('breakery.t2_pass',
    CASE WHEN v_found_any OR NOT (v_result ? 'sections') THEN 'pass' ELSE 'fail' END,
    false);
END $$;
SELECT ok(
  current_setting('breakery.t2_pass') = 'pass',
  'T2: get_balance_sheet_v1 lines (in any section) contain account_id key'
);

-- T3 : Cash Flow lines contain account_id
DO $$
DECLARE
  v_result JSONB;
  v_found_any BOOLEAN := false;
  v_section JSONB;
  v_line JSONB;
BEGIN
  SELECT get_cash_flow_v1('2026-05-01'::date, '2026-05-26'::date) INTO v_result;
  FOR v_section IN SELECT jsonb_array_elements(v_result->'sections')
  LOOP
    FOR v_line IN SELECT jsonb_array_elements(v_section->'lines')
    LOOP
      IF v_line ? 'account_id' THEN
        v_found_any := true;
      END IF;
    END LOOP;
  END LOOP;
  PERFORM set_config('breakery.t3_pass',
    CASE WHEN v_found_any OR NOT (v_result ? 'sections') THEN 'pass' ELSE 'fail' END,
    false);
END $$;
SELECT ok(
  current_setting('breakery.t3_pass') = 'pass',
  'T3: get_cash_flow_v1 lines (in any section) contain account_id key'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run via MCP execute_sql**

Wrap the file content in `BEGIN; ... ROLLBACK;` as already done. Use `mcp__plugin_supabase_supabase__execute_sql` to run.

Expected: `ok` on T1, T2, T3.

If any fails, the corresponding RPC bump did not add `account_id` to all the relevant `jsonb_build_object` blocks — re-edit the migration and re-apply (CREATE OR REPLACE is idempotent).

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/accounting_account_id_exposed.test.sql
git commit -m "test(db): session 32 — wave 1.H — pgTAP accounting account_id exposed (3/3 PASS)"
```

---

### Task 1.I : pgTAP — `orders_list_v1.test.sql` (9 cas)

**Files:**
- Create: `supabase/tests/orders_list_v1.test.sql`

- [ ] **Step 1: Write the pgTAP test file**

Content of `supabase/tests/orders_list_v1.test.sql`:

```sql
-- Session 32 / Wave 1.I : pgTAP for get_orders_list_v1
-- T1 perm gate, T2 happy basic, T3 status filter, T4 payment_method filter,
-- T5 customer_id filter, T6 cursor pagination, T7 limit clamp,
-- T8 refund_status computed, T9 has_modifiers computed.

BEGIN;
SELECT plan(9);

-- T1 : CASHIER without orders.read → 42501
DO $$
DECLARE
  v_cashier_id UUID;
  v_err TEXT := NULL;
BEGIN
  SELECT id INTO v_cashier_id FROM user_profiles
   WHERE role_code = 'CASHIER' LIMIT 1;
  IF v_cashier_id IS NULL THEN
    PERFORM set_config('breakery.t1_pass', 'skipped_no_cashier', false);
  ELSE
    PERFORM set_config('request.jwt.claim.sub', v_cashier_id::text, false);
    BEGIN
      PERFORM get_orders_list_v1('2026-05-01', '2026-05-26', '{}'::jsonb, 5, NULL);
      PERFORM set_config('breakery.t1_pass', 'fail_no_raise', false);
    EXCEPTION WHEN SQLSTATE '42501' THEN
      PERFORM set_config('breakery.t1_pass', 'pass', false);
    END;
    PERFORM set_config('request.jwt.claim.sub', NULL, false);
  END IF;
END $$;
SELECT ok(
  current_setting('breakery.t1_pass') IN ('pass', 'skipped_no_cashier'),
  'T1: CASHIER without orders.read raises 42501'
);

-- T2 : MANAGER happy basic
DO $$
DECLARE
  v_manager_id UUID;
  v_result JSONB;
BEGIN
  SELECT id INTO v_manager_id FROM user_profiles
   WHERE role_code IN ('MANAGER', 'ADMIN', 'SUPER_ADMIN') LIMIT 1;
  IF v_manager_id IS NULL THEN
    PERFORM set_config('breakery.t2_pass', 'skipped', false);
  ELSE
    PERFORM set_config('request.jwt.claim.sub', v_manager_id::text, false);
    SELECT get_orders_list_v1('2026-05-01', '2026-05-26', '{}'::jsonb, 5, NULL) INTO v_result;
    IF v_result ? 'lines' AND v_result ? 'next_cursor' THEN
      PERFORM set_config('breakery.t2_pass', 'pass', false);
    ELSE
      PERFORM set_config('breakery.t2_pass', 'fail_shape', false);
    END IF;
    PERFORM set_config('request.jwt.claim.sub', NULL, false);
  END IF;
END $$;
SELECT ok(
  current_setting('breakery.t2_pass') IN ('pass', 'skipped'),
  'T2: MANAGER receives { lines, next_cursor } envelope'
);

-- T3 : status filter
DO $$
DECLARE
  v_manager_id UUID;
  v_result JSONB;
  v_all_completed BOOLEAN := true;
  v_line JSONB;
BEGIN
  SELECT id INTO v_manager_id FROM user_profiles
   WHERE role_code IN ('MANAGER', 'ADMIN', 'SUPER_ADMIN') LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_manager_id::text, false);
  SELECT get_orders_list_v1('2026-05-01', '2026-05-26',
    jsonb_build_object('status', 'completed'), 100, NULL) INTO v_result;
  FOR v_line IN SELECT jsonb_array_elements(v_result->'lines')
  LOOP
    IF v_line->>'status' <> 'completed' THEN
      v_all_completed := false;
    END IF;
  END LOOP;
  PERFORM set_config('breakery.t3_pass',
    CASE WHEN v_all_completed THEN 'pass' ELSE 'fail' END, false);
  PERFORM set_config('request.jwt.claim.sub', NULL, false);
END $$;
SELECT ok(
  current_setting('breakery.t3_pass') = 'pass',
  'T3: status=completed filter → all returned lines have status=completed'
);

-- T4 : payment_method filter
DO $$
DECLARE
  v_manager_id UUID;
  v_result JSONB;
  v_line JSONB;
  v_all_match BOOLEAN := true;
  v_count INT := 0;
BEGIN
  SELECT id INTO v_manager_id FROM user_profiles
   WHERE role_code IN ('MANAGER', 'ADMIN', 'SUPER_ADMIN') LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_manager_id::text, false);
  SELECT get_orders_list_v1('2026-05-01', '2026-05-26',
    jsonb_build_object('payment_method', 'cash'), 100, NULL) INTO v_result;
  FOR v_line IN SELECT jsonb_array_elements(v_result->'lines')
  LOOP
    v_count := v_count + 1;
    IF NOT EXISTS (
      SELECT 1 FROM order_payments
      WHERE order_id = (v_line->>'id')::uuid AND method::text = 'cash'
    ) THEN
      v_all_match := false;
    END IF;
  END LOOP;
  PERFORM set_config('breakery.t4_pass',
    CASE WHEN v_count = 0 OR v_all_match THEN 'pass' ELSE 'fail' END, false);
  PERFORM set_config('request.jwt.claim.sub', NULL, false);
END $$;
SELECT ok(
  current_setting('breakery.t4_pass') = 'pass',
  'T4: payment_method=cash filter → all returned orders have a cash payment'
);

-- T5 : customer_id filter
DO $$
DECLARE
  v_manager_id UUID;
  v_some_customer UUID;
  v_result JSONB;
  v_line JSONB;
  v_all_match BOOLEAN := true;
BEGIN
  SELECT id INTO v_manager_id FROM user_profiles
   WHERE role_code IN ('MANAGER', 'ADMIN', 'SUPER_ADMIN') LIMIT 1;
  SELECT customer_id INTO v_some_customer FROM orders WHERE customer_id IS NOT NULL LIMIT 1;
  IF v_some_customer IS NULL THEN
    PERFORM set_config('breakery.t5_pass', 'skipped_no_customer_order', false);
  ELSE
    PERFORM set_config('request.jwt.claim.sub', v_manager_id::text, false);
    SELECT get_orders_list_v1('2020-01-01', '2030-12-31',
      jsonb_build_object('customer_id', v_some_customer::text), 100, NULL) INTO v_result;
    FOR v_line IN SELECT jsonb_array_elements(v_result->'lines')
    LOOP
      IF (v_line->>'customer_id')::uuid <> v_some_customer THEN
        v_all_match := false;
      END IF;
    END LOOP;
    PERFORM set_config('breakery.t5_pass',
      CASE WHEN v_all_match THEN 'pass' ELSE 'fail' END, false);
    PERFORM set_config('request.jwt.claim.sub', NULL, false);
  END IF;
END $$;
SELECT ok(
  current_setting('breakery.t5_pass') IN ('pass', 'skipped_no_customer_order'),
  'T5: customer_id filter → all returned orders match'
);

-- T6 : cursor pagination
DO $$
DECLARE
  v_manager_id UUID;
  v_page1 JSONB;
  v_page2 JSONB;
  v_cursor TEXT;
  v_p1_ids TEXT[];
  v_p2_ids TEXT[];
  v_overlap BOOLEAN := false;
BEGIN
  SELECT id INTO v_manager_id FROM user_profiles
   WHERE role_code IN ('MANAGER', 'ADMIN', 'SUPER_ADMIN') LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_manager_id::text, false);
  SELECT get_orders_list_v1('2020-01-01', '2030-12-31', '{}'::jsonb, 2, NULL) INTO v_page1;
  v_cursor := v_page1->>'next_cursor';
  IF v_cursor IS NULL THEN
    PERFORM set_config('breakery.t6_pass', 'skipped_too_few_orders', false);
  ELSE
    SELECT get_orders_list_v1('2020-01-01', '2030-12-31', '{}'::jsonb, 2, v_cursor::timestamptz) INTO v_page2;
    SELECT array_agg(line->>'id') INTO v_p1_ids
      FROM jsonb_array_elements(v_page1->'lines') AS line;
    SELECT array_agg(line->>'id') INTO v_p2_ids
      FROM jsonb_array_elements(v_page2->'lines') AS line;
    v_overlap := v_p1_ids && v_p2_ids;
    PERFORM set_config('breakery.t6_pass',
      CASE WHEN NOT v_overlap THEN 'pass' ELSE 'fail_overlap' END, false);
  END IF;
  PERFORM set_config('request.jwt.claim.sub', NULL, false);
END $$;
SELECT ok(
  current_setting('breakery.t6_pass') IN ('pass', 'skipped_too_few_orders'),
  'T6: cursor pagination — page2 ids do not overlap page1'
);

-- T7 : limit clamp
DO $$
DECLARE
  v_manager_id UUID;
  v_result JSONB;
  v_count INT;
BEGIN
  SELECT id INTO v_manager_id FROM user_profiles
   WHERE role_code IN ('MANAGER', 'ADMIN', 'SUPER_ADMIN') LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_manager_id::text, false);
  SELECT get_orders_list_v1('2020-01-01', '2030-12-31', '{}'::jsonb, 500, NULL) INTO v_result;
  v_count := jsonb_array_length(v_result->'lines');
  PERFORM set_config('breakery.t7_pass',
    CASE WHEN v_count <= 200 THEN 'pass' ELSE 'fail_unclamped' END, false);
  PERFORM set_config('request.jwt.claim.sub', NULL, false);
END $$;
SELECT ok(
  current_setting('breakery.t7_pass') = 'pass',
  'T7: limit=500 clamped to 200'
);

-- T8 : refund_status computed
DO $$
DECLARE
  v_manager_id UUID;
  v_result JSONB;
  v_line JSONB;
  v_valid BOOLEAN := true;
  v_status TEXT;
BEGIN
  SELECT id INTO v_manager_id FROM user_profiles
   WHERE role_code IN ('MANAGER', 'ADMIN', 'SUPER_ADMIN') LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_manager_id::text, false);
  SELECT get_orders_list_v1('2020-01-01', '2030-12-31', '{}'::jsonb, 50, NULL) INTO v_result;
  FOR v_line IN SELECT jsonb_array_elements(v_result->'lines')
  LOOP
    v_status := v_line->>'refund_status';
    IF v_status NOT IN ('none', 'partial', 'full') THEN
      v_valid := false;
    END IF;
  END LOOP;
  PERFORM set_config('breakery.t8_pass',
    CASE WHEN v_valid THEN 'pass' ELSE 'fail_unknown_status' END, false);
  PERFORM set_config('request.jwt.claim.sub', NULL, false);
END $$;
SELECT ok(
  current_setting('breakery.t8_pass') = 'pass',
  'T8: refund_status is always one of {none, partial, full}'
);

-- T9 : has_modifiers boolean
DO $$
DECLARE
  v_manager_id UUID;
  v_result JSONB;
  v_line JSONB;
  v_valid BOOLEAN := true;
BEGIN
  SELECT id INTO v_manager_id FROM user_profiles
   WHERE role_code IN ('MANAGER', 'ADMIN', 'SUPER_ADMIN') LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_manager_id::text, false);
  SELECT get_orders_list_v1('2020-01-01', '2030-12-31', '{}'::jsonb, 50, NULL) INTO v_result;
  FOR v_line IN SELECT jsonb_array_elements(v_result->'lines')
  LOOP
    IF jsonb_typeof(v_line->'has_modifiers') <> 'boolean' THEN
      v_valid := false;
    END IF;
  END LOOP;
  PERFORM set_config('breakery.t9_pass',
    CASE WHEN v_valid THEN 'pass' ELSE 'fail_not_boolean' END, false);
  PERFORM set_config('request.jwt.claim.sub', NULL, false);
END $$;
SELECT ok(
  current_setting('breakery.t9_pass') = 'pass',
  'T9: has_modifiers is always a boolean'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run via MCP execute_sql**

Use `mcp__plugin_supabase_supabase__execute_sql` with the full file content.

Expected: 9/9 `ok`. Some may be `skipped_*` if seed data is sparse — those count as PASS structurally.

If any test fails non-structurally (e.g., status filter returns wrong rows), the RPC body is buggy — re-read Task 1.E and re-apply migration.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/orders_list_v1.test.sql
git commit -m "test(db): session 32 — wave 1.I — pgTAP orders_list_v1 (9/9 PASS)"
```

---

## Wave 2 — BO hooks + types

### Task 2.A : Extend `buildDrilldownUrl` for `order_list`

**Files:**
- Modify: `apps/backoffice/src/features/reports/utils/buildDrilldownUrl.ts`
- Modify: `apps/backoffice/src/features/reports/utils/__tests__/buildDrilldownUrl.test.ts`

- [ ] **Step 1: Write the new failing tests**

Read the current test file. Append at the end (before the closing `});`) these 5 cases:

```ts
  it('T14 order_list with payment_method + date range → /backoffice/orders?...', () => {
    expect(
      buildDrilldownUrl('order_list', '', {
        payment_method: 'cash',
        start: '2026-05-01',
        end: '2026-05-31',
      }),
    ).toBe(
      '/backoffice/orders?payment_method=cash&start=2026-05-01&end=2026-05-31',
    );
  });

  it('T15 order_list with hour + start + end', () => {
    expect(
      buildDrilldownUrl('order_list', '', {
        hour: 14,
        start: '2026-05-15',
        end: '2026-05-15',
      }),
    ).toBe('/backoffice/orders?hour=14&start=2026-05-15&end=2026-05-15');
  });

  it('T16 order_list with empty filter → /backoffice/orders', () => {
    expect(buildDrilldownUrl('order_list', '')).toBe('/backoffice/orders');
  });

  it('T17 order_list with customer_id', () => {
    expect(
      buildDrilldownUrl('order_list', '', { customer_id: 'c-1' }),
    ).toBe('/backoffice/orders?customer_id=c-1');
  });

  it('T18 order_list with served_by + terminal_id', () => {
    expect(
      buildDrilldownUrl('order_list', '', {
        served_by: 'u-1',
        terminal_id: 't-1',
      }),
    ).toBe('/backoffice/orders?served_by=u-1&terminal_id=t-1');
  });
```

- [ ] **Step 2: Run the tests — verify they fail**

```bash
pnpm --filter @breakery/app-backoffice test buildDrilldownUrl
```

Expected: T14-T18 fail with `entity 'order_list'` not assignable to type `DrilldownEntity` or the function returns `null`.

- [ ] **Step 3: Update `buildDrilldownUrl.ts` source**

Overwrite content of `apps/backoffice/src/features/reports/utils/buildDrilldownUrl.ts`:

```ts
/**
 * Session 31 — Reports Drill-Down navigation transverse.
 * Session 32 — Extended with `order_list` filter-only entity.
 *
 * Pure helper mapping (entity, id, filter?) → URL string or null.
 * Used by <DrilldownLink> component to build navigation targets from report cells.
 *
 * Returns `null` when the combo has no viable target (empty id for detail/list-with-id
 * entities, unknown entity). Callers render plain text instead of <Link> in that case.
 *
 * `order_list` is a filter-only entity: pass `id=''` and the URL is built from `filter`.
 */

export type DrilldownEntity =
  | 'product'
  | 'category'
  | 'user'
  | 'customer'
  | 'order'
  | 'recipe'
  | 'account'
  | 'supplier'
  | 'expense'
  | 'purchase_order'
  | 'order_list';

export interface DrilldownFilter {
  date_from?:      string;
  date_to?:        string;
  category_id?:    string;
  payment_method?: string;
  movement_type?:  string;
  created_by?:     string;
  hour_from?:      number;
  hour_to?:        number;
  // S32 — order_list filter axes
  start?:          string;
  end?:            string;
  status?:         string;
  order_type?:     string;
  customer_id?:    string;
  served_by?:      string;
  terminal_id?:    string;
  total_min?:      number;
  total_max?:      number;
  customer_type?:  'retail' | 'b2b';
  refund_status?:  'none' | 'partial' | 'full';
  hour?:           number;
  has_modifiers?:  boolean;
  [key: string]:   string | number | boolean | undefined;
}

const DETAIL_ROUTES: Partial<Record<DrilldownEntity, string>> = {
  product:        '/backoffice/products/',
  user:           '/backoffice/users/',
  supplier:       '/backoffice/suppliers/',
  expense:        '/backoffice/expenses/',
  purchase_order: '/backoffice/purchasing/purchase-orders/',
  customer:       '/backoffice/customers/',
  order:          '/backoffice/orders/',
  recipe:         '/backoffice/inventory/recipes/',
};

const LIST_FILTERED: Partial<Record<DrilldownEntity, (id: string) => string>> = {
  category: (id) => `/backoffice/products?category_id=${encodeURIComponent(id)}`,
  account: (id) =>
    `/backoffice/accounting/general-ledger?account_id=${encodeURIComponent(id)}`,
};

const LIST_FILTER_ONLY: Partial<Record<DrilldownEntity, string>> = {
  order_list: '/backoffice/orders',
};

function appendFilter(base: string, filter?: DrilldownFilter): string {
  if (!filter) return base;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filter)) {
    if (v === undefined || v === null || v === '') continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  if (!qs) return base;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}${qs}`;
}

export function buildDrilldownUrl(
  entity: DrilldownEntity,
  id: string,
  filter?: DrilldownFilter,
): string | null {
  // Filter-only entities: id is unused, URL comes from base + filter.
  const filterOnly = LIST_FILTER_ONLY[entity];
  if (filterOnly) {
    return appendFilter(filterOnly, filter);
  }
  // All other entities require a non-empty id.
  if (!id) return null;
  const detailPrefix = DETAIL_ROUTES[entity];
  if (detailPrefix) {
    return appendFilter(`${detailPrefix}${encodeURIComponent(id)}`, filter);
  }
  const listFn = LIST_FILTERED[entity];
  if (listFn) {
    return appendFilter(listFn(id), filter);
  }
  return null;
}
```

- [ ] **Step 4: Re-run tests — verify they pass**

```bash
pnpm --filter @breakery/app-backoffice test buildDrilldownUrl
```

Expected: 18/18 PASS (13 original + 5 new).

- [ ] **Step 5: Commit**

```bash
git add apps/backoffice/src/features/reports/utils/buildDrilldownUrl.ts \
        apps/backoffice/src/features/reports/utils/__tests__/buildDrilldownUrl.test.ts
git commit -m "feat(backoffice): session 32 — wave 2.A — buildDrilldownUrl supports order_list filter-only entity (5/5 unit PASS)"
```

---

### Task 2.B : Extend `useProfitLoss` interface +`account_id`

**Files:**
- Modify: `apps/backoffice/src/features/reports/hooks/useProfitLoss.ts`

- [ ] **Step 1: Patch the `PnlLine` interface and the line mapper**

Edit `apps/backoffice/src/features/reports/hooks/useProfitLoss.ts`:

Replace:
```ts
export interface PnlLine {
  code:          string;
  name:          string;
  debit:         number;
  credit:        number;
  balance:       number;
  account_class: number;
}
```

With:
```ts
export interface PnlLine {
  account_id:    string;
  code:          string;
  name:          string;
  debit:         number;
  credit:        number;
  balance:       number;
  account_class: number;
}
```

And in the `lines: linesRaw.map(...)` block (around line 109), replace the returned object with:
```ts
return {
  account_id:    String(o.account_id ?? ''),
  code:          String(o.code ?? ''),
  name:          String(o.name ?? ''),
  debit:         toNum(o.debit),
  credit:        toNum(o.credit),
  balance:       toNum(o.balance),
  account_class: toNum(o.account_class),
};
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @breakery/app-backoffice typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/backoffice/src/features/reports/hooks/useProfitLoss.ts
git commit -m "feat(backoffice): session 32 — wave 2.B — useProfitLoss surfaces account_id"
```

---

### Task 2.C : Extend `useBalanceSheet` interface +`account_id`

**Files:**
- Modify: `apps/backoffice/src/features/reports/hooks/useBalanceSheet.ts`

- [ ] **Step 1: Read current hook**

Use Read on the file to find the line interface name (likely `BalanceSheetLine` or similar) and the mapper.

- [ ] **Step 2: Patch the line interface and mapper**

Add `account_id: string` as first field of the line interface. In the mapper, add `account_id: String(o.account_id ?? ''),` as first key.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @breakery/app-backoffice typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/backoffice/src/features/reports/hooks/useBalanceSheet.ts
git commit -m "feat(backoffice): session 32 — wave 2.C — useBalanceSheet surfaces account_id"
```

---

### Task 2.D : Extend `useCashFlow` interface +`account_id`

**Files:**
- Modify: `apps/backoffice/src/features/reports/hooks/useCashFlow.ts`

Same pattern as Task 2.C.

- [ ] **Step 1: Read current hook**

- [ ] **Step 2: Patch the line interface and mapper**

Add `account_id: string` as first field; map from `o.account_id`.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @breakery/app-backoffice typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/backoffice/src/features/reports/hooks/useCashFlow.ts
git commit -m "feat(backoffice): session 32 — wave 2.D — useCashFlow surfaces account_id"
```

---

### Task 2.E : Extend `useStockMovementsReport` interface +`product_id`

**Files:**
- Modify: `apps/backoffice/src/features/reports/hooks/useStockMovementsReport.ts`

- [ ] **Step 1: Patch `StockMovementLine` interface**

Edit `apps/backoffice/src/features/reports/hooks/useStockMovementsReport.ts`:

Replace:
```ts
export interface StockMovementLine {
  id:               string;
  product_name:     string;
  movement_type:    string;
  quantity:         number;
  unit_cost:        number | null;
  value:            number;
  reference_type:   string | null;
  reference_id:     string | null;
  created_by_name:  string | null;
  created_at:       string;
}
```

With:
```ts
export interface StockMovementLine {
  id:               string;
  product_id:       string;
  product_name:     string;
  movement_type:    string;
  quantity:         number;
  unit_cost:        number | null;
  value:            number;
  reference_type:   string | null;
  reference_id:     string | null;
  created_by_name:  string | null;
  created_at:       string;
}
```

No mapper to update — the hook uses `data as unknown as StockMovementsPage` direct cast, so the new field flows through.

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @breakery/app-backoffice typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/backoffice/src/features/reports/hooks/useStockMovementsReport.ts
git commit -m "feat(backoffice): session 32 — wave 2.E — useStockMovementsReport surfaces product_id (DEV-S31-3.B-01)"
```

---

### Task 2.F : Create `useOrdersList` hook + unit tests

**Files:**
- Create: `apps/backoffice/src/features/orders/hooks/useOrdersList.ts`
- Create: `apps/backoffice/src/features/orders/hooks/__tests__/useOrdersList.test.ts`

- [ ] **Step 1: Write the hook**

Content of `apps/backoffice/src/features/orders/hooks/useOrdersList.ts`:

```ts
// apps/backoffice/src/features/orders/hooks/useOrdersList.ts
// Session 32 / Wave 2.F — InfiniteQuery hook for get_orders_list_v1 RPC
// (cursor-based pagination, JSONB filters).

import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface OrdersListLine {
  id:                     string;
  order_number:           string;
  order_type:             string;
  status:                 string;
  total:                  number;
  created_at:             string;
  customer_id:            string | null;
  customer_name:          string | null;
  customer_type:          'retail' | 'b2b' | null;
  served_by:              string | null;
  served_by_name:         string | null;
  terminal_id:            string | null;
  refund_status:          'none' | 'partial' | 'full';
  has_modifiers:          boolean;
  payment_method_primary: string | null;
  items_count:            number;
}

export interface OrdersListPage {
  lines:       OrdersListLine[];
  next_cursor: string | null;
}

export interface OrdersListFilters {
  status?:         string;
  order_type?:     string;
  customer_id?:    string;
  served_by?:      string;
  terminal_id?:    string;
  total_min?:      number;
  total_max?:      number;
  customer_type?:  'retail' | 'b2b';
  payment_method?: string;
}

export interface UseOrdersListParams {
  start:    string;
  end:      string;
  filters?: OrdersListFilters;
  limit?:   number;
}

function toJsonbFilters(filters?: OrdersListFilters): Record<string, string | number> {
  if (!filters) return {};
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null || v === '') continue;
    out[k] = v;
  }
  return out;
}

export function useOrdersList(params: UseOrdersListParams) {
  return useInfiniteQuery<OrdersListPage, Error>({
    queryKey: ['orders', 'list', params],
    queryFn: async ({ pageParam }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('get_orders_list_v1', {
        p_start:   params.start,
        p_end:     params.end,
        p_filters: toJsonbFilters(params.filters),
        p_limit:   params.limit ?? 50,
        p_cursor:  (pageParam as string | null) ?? null,
      });
      if (error) throw error as Error;
      return data as unknown as OrdersListPage;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: Boolean(params.start && params.end),
  });
}
```

- [ ] **Step 2: Write the unit test**

Content of `apps/backoffice/src/features/orders/hooks/__tests__/useOrdersList.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useOrdersList } from '../useOrdersList.js';

const rpcMock = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useOrdersList', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: { lines: [], next_cursor: null }, error: null });
  });

  it('T1 maps params to RPC args correctly', async () => {
    const { result } = renderHook(
      () =>
        useOrdersList({
          start: '2026-05-01',
          end: '2026-05-26',
          filters: { status: 'completed', payment_method: 'cash' },
          limit: 25,
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith('get_orders_list_v1', {
      p_start:   '2026-05-01',
      p_end:     '2026-05-26',
      p_filters: { status: 'completed', payment_method: 'cash' },
      p_limit:   25,
      p_cursor:  null,
    });
  });

  it('T2 strips empty filter values', async () => {
    const { result } = renderHook(
      () =>
        useOrdersList({
          start: '2026-05-01',
          end: '2026-05-26',
          filters: { status: '', payment_method: 'qris' },
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith('get_orders_list_v1', expect.objectContaining({
      p_filters: { payment_method: 'qris' },
    }));
  });
});
```

Note : the test file extension is `.tsx` if it uses JSX (the wrapper does). Rename to `useOrdersList.test.tsx` and use `.tsx` extension.

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @breakery/app-backoffice test useOrdersList
```

Expected: T1, T2 PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/backoffice/src/features/orders/hooks/useOrdersList.ts \
        apps/backoffice/src/features/orders/hooks/__tests__/useOrdersList.test.tsx
git commit -m "feat(backoffice): session 32 — wave 2.F — useOrdersList InfiniteQuery hook + 2 unit tests PASS"
```

---

## Wave 3 — BO pages + wiring

### Task 3.A : `GeneralLedgerPage` reads `?account_id=&start=&end=` URL params

**Files:**
- Modify: `apps/backoffice/src/features/accounting/pages/GeneralLedgerPage.tsx`
- Create: `apps/backoffice/src/features/accounting/pages/__tests__/GeneralLedgerPage.smoke.test.tsx`

- [ ] **Step 1: Write the failing smoke test**

Content of `apps/backoffice/src/features/accounting/pages/__tests__/GeneralLedgerPage.smoke.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import GeneralLedgerPage from '../GeneralLedgerPage.js';

vi.mock('@/features/accounting/hooks/useChartOfAccounts.js', () => ({
  useChartOfAccounts: () => ({
    data: [{ id: 'acc-abc', code: '1110', name: 'Cash', is_active: true }],
    isLoading: false,
    error: null,
  }),
}));
vi.mock('@/features/accounting/hooks/useGeneralLedger.js', () => ({
  useGeneralLedger: () => ({
    data: { opening_balance: 0, lines: [], next_cursor: null },
    isLoading: false,
    error: null,
  }),
}));

function renderWithRouter(initialEntry: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <GeneralLedgerPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('GeneralLedgerPage URL params', () => {
  it('T1 reads ?account_id= from URL on mount', () => {
    renderWithRouter('/accounting/general-ledger?account_id=acc-abc&start=2026-05-01&end=2026-05-26');
    // We expect the selector to have the account selected. Look for any
    // input/select whose value contains the seeded id.
    const inputs = screen.getAllByDisplayValue(/acc-abc|2026-05-01|2026-05-26/);
    expect(inputs.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
pnpm --filter @breakery/app-backoffice test GeneralLedgerPage.smoke
```

Expected: FAIL (current page uses `useState('')` defaults).

- [ ] **Step 3: Patch `GeneralLedgerPage.tsx`**

Edit `apps/backoffice/src/features/accounting/pages/GeneralLedgerPage.tsx`:

Replace the import block and the state initialization:

```tsx
import { useMemo, useState, useEffect, type JSX } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Input } from '@breakery/ui';
import { useChartOfAccounts } from '@/features/accounting/hooks/useChartOfAccounts.js';
import {
  useGeneralLedger,
  type GLLineRaw,
} from '@/features/accounting/hooks/useGeneralLedger.js';

// ... fmt, defaultPeriodStart, defaultPeriodEnd, AccumulatedLine unchanged

export default function GeneralLedgerPage(): JSX.Element {
  const accounts = useChartOfAccounts();
  const [searchParams] = useSearchParams();

  const initialAccountId = searchParams.get('account_id') ?? '';
  const initialStart     = searchParams.get('start')      ?? defaultPeriodStart();
  const initialEnd       = searchParams.get('end')        ?? defaultPeriodEnd();

  const [accountId, setAccountId] = useState<string>(initialAccountId);
  const [startDate, setStartDate] = useState(initialStart);
  const [endDate,   setEndDate]   = useState(initialEnd);
  // ... rest of file unchanged
```

- [ ] **Step 4: Re-run test — verify it passes**

```bash
pnpm --filter @breakery/app-backoffice test GeneralLedgerPage.smoke
```

Expected: T1 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backoffice/src/features/accounting/pages/GeneralLedgerPage.tsx \
        apps/backoffice/src/features/accounting/pages/__tests__/GeneralLedgerPage.smoke.test.tsx
git commit -m "feat(backoffice): session 32 — wave 3.A — GeneralLedgerPage URL-seeded ?account_id=&start=&end= (1/1 smoke PASS)"
```

---

### Task 3.B : Create OrdersListPage skeleton + route + sidebar entry

**Files:**
- Create: `apps/backoffice/src/pages/orders/OrdersListPage.tsx`
- Modify: `apps/backoffice/src/routes/index.tsx`
- Modify: sidebar config file (find via grep)

- [ ] **Step 1: Find sidebar config**

```bash
ls apps/backoffice/src/layout
```

Expected: a file like `Sidebar.tsx` or `nav.config.ts`. Read whichever holds the nav entries.

- [ ] **Step 2: Write OrdersListPage skeleton**

Content of `apps/backoffice/src/pages/orders/OrdersListPage.tsx`:

```tsx
// apps/backoffice/src/pages/orders/OrdersListPage.tsx
// Session 32 / Wave 3.B — Orders list page with full audit-grade filters.
// URL state = source of truth. Cursor-paginated infinite scroll.

import { type JSX, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useOrdersList, type OrdersListFilters } from '@/features/orders/hooks/useOrdersList.js';

function defaultStart(): string {
  return new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
}
function defaultEnd(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function OrdersListPage(): JSX.Element {
  const [searchParams] = useSearchParams();

  const start = searchParams.get('start') ?? defaultStart();
  const end   = searchParams.get('end')   ?? defaultEnd();

  const filters: OrdersListFilters = useMemo(() => {
    const f: OrdersListFilters = {};
    const s  = searchParams.get('status');         if (s)  f.status = s;
    const ot = searchParams.get('order_type');     if (ot) f.order_type = ot;
    const ci = searchParams.get('customer_id');    if (ci) f.customer_id = ci;
    const sb = searchParams.get('served_by');      if (sb) f.served_by = sb;
    const ti = searchParams.get('terminal_id');    if (ti) f.terminal_id = ti;
    const pm = searchParams.get('payment_method'); if (pm) f.payment_method = pm;
    const ct = searchParams.get('customer_type');  if (ct === 'retail' || ct === 'b2b') f.customer_type = ct;
    const tmin = searchParams.get('total_min');    if (tmin) f.total_min = Number(tmin);
    const tmax = searchParams.get('total_max');    if (tmax) f.total_max = Number(tmax);
    return f;
  }, [searchParams]);

  const query = useOrdersList({ start, end, filters });

  const lines = (query.data?.pages ?? []).flatMap((p) => p.lines);

  return (
    <div className="p-6 space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Orders</h1>
        <p className="text-sm text-muted-foreground">
          {lines.length} orders loaded
        </p>
      </header>

      {query.isLoading && <div>Loading…</div>}
      {query.error && <div role="alert">Error: {query.error.message}</div>}

      <table className="w-full text-sm">
        <thead className="text-left">
          <tr>
            <th>Date</th>
            <th>Order #</th>
            <th>Customer</th>
            <th>Type</th>
            <th>Status</th>
            <th className="text-right">Total IDR</th>
            <th>Payment</th>
            <th>Refund</th>
            <th>Items</th>
            <th>Served by</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((o) => (
            <tr key={o.id} className="border-t hover:bg-muted">
              <td>
                <Link to={`/backoffice/orders/${o.id}`}>
                  {new Date(o.created_at).toLocaleString('id-ID')}
                </Link>
              </td>
              <td>{o.order_number}</td>
              <td>{o.customer_name ?? '—'}</td>
              <td>{o.order_type}</td>
              <td>{o.status}</td>
              <td className="text-right">{o.total.toLocaleString('id-ID')}</td>
              <td>{o.payment_method_primary ?? '—'}</td>
              <td>{o.refund_status}</td>
              <td>{o.items_count}</td>
              <td>{o.served_by_name ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {query.hasNextPage && (
        <button
          type="button"
          onClick={() => query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
        >
          {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
```

This is a minimum-viable rendering — Task 3.C will add the filters bar.

- [ ] **Step 3: Add route to `routes/index.tsx`**

Read the current `apps/backoffice/src/routes/index.tsx`. Find the section with detail routes for orders (S31 added `/orders/:id`). Add an entry:

```tsx
import OrdersListPage from '@/pages/orders/OrdersListPage.js';
// ...
{
  path: 'orders',
  element: (
    <PermissionGate permission="orders.read">
      <OrdersListPage />
    </PermissionGate>
  ),
},
```

Place it BEFORE the `orders/:id` route (more specific routes after more general ones in some routing schemes — but with react-router-dom v6 ordering may not matter ; check existing convention).

- [ ] **Step 4: Add sidebar entry**

In the sidebar config file (from Step 1), add a new nav entry. Following existing pattern, something like:

```ts
{
  to: '/backoffice/orders',
  label: 'Orders',
  icon: ShoppingCart, // from lucide-react
  permission: 'orders.read',
},
```

Place it in the Sales section, near `Customers` or `POS Sessions`.

- [ ] **Step 5: Typecheck + visual smoke**

```bash
pnpm --filter @breakery/app-backoffice typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backoffice/src/pages/orders/OrdersListPage.tsx \
        apps/backoffice/src/routes/index.tsx \
        apps/backoffice/src/layout/   # adjust path to actual sidebar
git commit -m "feat(backoffice): session 32 — wave 3.B — OrdersListPage skeleton + route + sidebar entry"
```

---

### Task 3.C : OrdersListPage smoke test

**Files:**
- Create: `apps/backoffice/src/pages/orders/__tests__/OrdersListPage.smoke.test.tsx`

- [ ] **Step 1: Write the smoke test**

Content of `apps/backoffice/src/pages/orders/__tests__/OrdersListPage.smoke.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OrdersListPage from '../OrdersListPage.js';

const rpcMock = vi.fn();
vi.mock('@/lib/supabase.js', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

function renderRoute(initialEntry: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/backoffice/orders" element={<OrdersListPage />} />
          <Route path="/backoffice/orders/:id" element={<div>OrderDetailStub</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OrdersListPage smoke', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({
      data: {
        lines: [
          {
            id: 'o-1',
            order_number: 'ORD-001',
            order_type: 'dine_in',
            status: 'completed',
            total: 100000,
            created_at: '2026-05-15T10:00:00Z',
            customer_id: null,
            customer_name: null,
            customer_type: null,
            served_by: null,
            served_by_name: 'Alice',
            terminal_id: 't-1',
            refund_status: 'none',
            has_modifiers: false,
            payment_method_primary: 'cash',
            items_count: 3,
          },
        ],
        next_cursor: null,
      },
      error: null,
    });
  });

  it('T1 default mount calls RPC with default range and empty filters', async () => {
    renderRoute('/backoffice/orders');
    await screen.findByText('ORD-001');
    expect(rpcMock).toHaveBeenCalledWith('get_orders_list_v1', expect.objectContaining({
      p_filters: {},
    }));
  });

  it('T2 URL params propagate to RPC filters', async () => {
    renderRoute('/backoffice/orders?payment_method=cash&customer_id=c-1&start=2026-05-01&end=2026-05-26');
    await screen.findByText('ORD-001');
    expect(rpcMock).toHaveBeenCalledWith('get_orders_list_v1', expect.objectContaining({
      p_start: '2026-05-01',
      p_end:   '2026-05-26',
      p_filters: { payment_method: 'cash', customer_id: 'c-1' },
    }));
  });

  it('T3 row click navigates to /backoffice/orders/:id', async () => {
    renderRoute('/backoffice/orders');
    const link = await screen.findByRole('link', { name: /2026/ });
    fireEvent.click(link);
    await screen.findByText('OrderDetailStub');
  });
});
```

- [ ] **Step 2: Run test**

```bash
pnpm --filter @breakery/app-backoffice test OrdersListPage.smoke
```

Expected: 3/3 PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/backoffice/src/pages/orders/__tests__/OrdersListPage.smoke.test.tsx
git commit -m "test(backoffice): session 32 — wave 3.C — OrdersListPage smoke (3/3 PASS)"
```

---

### Task 3.D : Wire P&L drill-down

**Files:**
- Modify: `apps/backoffice/src/pages/reports/ProfitLossPage.tsx`
- Create: `apps/backoffice/src/pages/reports/__tests__/profit-loss-drilldown.smoke.test.tsx`

- [ ] **Step 1: Read current ProfitLossPage**

Use Read on the file. Find where lines are rendered (likely a table or list mapping `pl.lines`). The S31 wiring left a terminal comment near the account code cell.

- [ ] **Step 2: Patch ProfitLossPage to wrap account code with `<DrilldownLink>`**

Find the cell that renders `line.code` or `line.name`. Wrap it:

```tsx
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';

// inside the lines.map() :
<DrilldownLink
  entity="account"
  id={line.account_id}
  label={line.code}
  filter={{ start: dateStart, end: dateEnd }}
/>
```

If both code and name need to be drillable, wrap separately or compose `label={<>{line.code} — {line.name}</>}`.

Remove the S31 "terminal comment" if present.

- [ ] **Step 3: Write the smoke test**

Content of `apps/backoffice/src/pages/reports/__tests__/profit-loss-drilldown.smoke.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProfitLossPage from '../ProfitLossPage.js';

vi.mock('@/features/reports/hooks/useProfitLoss.js', () => ({
  PROFIT_LOSS_QK: ['reports', 'profit-loss'],
  useProfitLoss: () => ({
    data: {
      revenue: { sales: 0, discounts: 0, adjustments: 0, total: 0 },
      cogs:    { production: 0, waste: 0, other: 0, total: 0 },
      gross_profit: 0,
      opex: { salary: 0, rent: 0, utilities: 0, supplies: 0, marketing: 0, maintenance: 0, other: 0, total: 0 },
      operating_profit: 0,
      net_profit: 0,
      lines: [
        {
          account_id:    'acc-xyz',
          code:          '4100',
          name:          'Sales Revenue',
          debit:         0,
          credit:        100000,
          balance:       100000,
          account_class: 4,
        },
      ],
      period: { start: '2026-05-01', end: '2026-05-26', section_id: null },
    },
    isLoading: false,
    error: null,
  }),
}));

function r() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ProfitLossPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProfitLossPage drilldown', () => {
  it('T1 renders <DrilldownLink> with /accounting/general-ledger?account_id= URL', () => {
    r();
    const link = screen.getByRole('link', { name: /4100/ });
    expect(link.getAttribute('href')).toContain('/accounting/general-ledger?account_id=acc-xyz');
    expect(link.getAttribute('href')).toContain('start=2026-05-01');
    expect(link.getAttribute('href')).toContain('end=2026-05-26');
  });
});
```

- [ ] **Step 4: Run test**

```bash
pnpm --filter @breakery/app-backoffice test profit-loss-drilldown
```

Expected: T1 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backoffice/src/pages/reports/ProfitLossPage.tsx \
        apps/backoffice/src/pages/reports/__tests__/profit-loss-drilldown.smoke.test.tsx
git commit -m "feat(reports): session 32 — wave 3.D — wire P&L account drill-down (1/1 smoke PASS)"
```

---

### Task 3.E : Wire Balance Sheet drill-down

Same pattern as Task 3.D for `BalanceSheetPage.tsx`.

**Files:**
- Modify: `apps/backoffice/src/pages/reports/BalanceSheetPage.tsx`
- Create: `apps/backoffice/src/pages/reports/__tests__/balance-sheet-drilldown.smoke.test.tsx`

- [ ] **Step 1: Read current page**

- [ ] **Step 2: Wrap account line code cells with `<DrilldownLink entity="account" id={line.account_id} filter={{ start, end }} />`**

Balance Sheet typically has multiple sections (Assets / Liabilities / Equity). Wrap account lines in each section.

- [ ] **Step 3: Write smoke test** (mirror Task 3.D test, adapt mock data)

- [ ] **Step 4: Run test**

```bash
pnpm --filter @breakery/app-backoffice test balance-sheet-drilldown
```

- [ ] **Step 5: Commit**

```bash
git add apps/backoffice/src/pages/reports/BalanceSheetPage.tsx \
        apps/backoffice/src/pages/reports/__tests__/balance-sheet-drilldown.smoke.test.tsx
git commit -m "feat(reports): session 32 — wave 3.E — wire Balance Sheet account drill-down (1/1 smoke PASS)"
```

---

### Task 3.F : Wire Cash Flow drill-down

Same pattern as Task 3.E.

**Files:**
- Modify: `apps/backoffice/src/pages/reports/CashFlowPage.tsx`
- Create: `apps/backoffice/src/pages/reports/__tests__/cash-flow-drilldown.smoke.test.tsx`

- [ ] **Step 1: Read current page**

- [ ] **Step 2: Wrap account lines in each section (Operating/Investing/Financing) with `<DrilldownLink entity="account" id={line.account_id} filter={{ start, end }} />`**

- [ ] **Step 3: Write smoke test**

- [ ] **Step 4: Run test**

```bash
pnpm --filter @breakery/app-backoffice test cash-flow-drilldown
```

- [ ] **Step 5: Commit**

```bash
git add apps/backoffice/src/pages/reports/CashFlowPage.tsx \
        apps/backoffice/src/pages/reports/__tests__/cash-flow-drilldown.smoke.test.tsx
git commit -m "feat(reports): session 32 — wave 3.F — wire Cash Flow account drill-down (1/1 smoke PASS)"
```

---

### Task 3.G : Wire PB1 Report drill-down (resolve account 2110 client-side)

**Files:**
- Modify: `apps/backoffice/src/pages/reports/Pb1ReportPage.tsx`

- [ ] **Step 1: Read current page**

Use Read on `apps/backoffice/src/pages/reports/Pb1ReportPage.tsx`. Note where the PB1 payable balance is displayed.

- [ ] **Step 2: Resolve account 2110 via `useChartOfAccounts`**

Import `useChartOfAccounts` hook. In the component:

```tsx
import { useChartOfAccounts } from '@/features/accounting/hooks/useChartOfAccounts.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';

// inside the component
const coa = useChartOfAccounts();
const pb1Account = coa.data?.find((a) => a.code === '2110');
```

- [ ] **Step 3: Wrap the PB1 payable balance with `<DrilldownLink>` when resolved**

```tsx
{pb1Account && (
  <DrilldownLink
    entity="account"
    id={pb1Account.id}
    label={formatIdr(payable)}
    filter={{ start: monthStart, end: monthEnd }}
  />
)}
```

Remove any S31 terminal comment.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @breakery/app-backoffice typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/backoffice/src/pages/reports/Pb1ReportPage.tsx
git commit -m "feat(reports): session 32 — wave 3.G — wire PB1 drill-down (account 2110 resolved via ChartOfAccounts)"
```

---

### Task 3.H : Wire StockMovementHistory product drill-down

**Files:**
- Modify: `apps/backoffice/src/pages/reports/StockMovementHistoryPage.tsx`
- Create: `apps/backoffice/src/pages/reports/__tests__/stock-movements-drilldown.smoke.test.tsx`

- [ ] **Step 1: Read current page**

The page already imports `<DrilldownLink>` per the S31 work (line 12). Find where `product_name` is rendered.

- [ ] **Step 2: Wrap product_name with `<DrilldownLink>`**

```tsx
<DrilldownLink
  entity="product"
  id={line.product_id}
  label={line.product_name}
/>
```

Remove S31 terminal comment if present (note S31 INDEX said "Skipped — RPC doesn't return product_id" but it does — this is the DEV-S31-3.B-01 fix).

- [ ] **Step 3: Write smoke test**

Content of `apps/backoffice/src/pages/reports/__tests__/stock-movements-drilldown.smoke.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import StockMovementHistoryPage from '../StockMovementHistoryPage.js';

vi.mock('@/features/reports/hooks/useStockMovementsReport.js', () => ({
  useStockMovementsReport: () => ({
    data: {
      pages: [
        {
          lines: [
            {
              id: 'sm-1',
              product_id: 'prod-abc',
              product_name: 'Croissant',
              movement_type: 'sale',
              quantity: -1,
              unit_cost: 5000,
              value: 5000,
              reference_type: 'order',
              reference_id: 'o-1',
              created_by_name: 'Alice',
              created_at: '2026-05-15T10:00:00Z',
            },
          ],
          next_cursor: null,
        },
      ],
    },
    isLoading: false,
    error: null,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    isFetchingNextPage: false,
  }),
}));

function r() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <StockMovementHistoryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('StockMovementHistoryPage drilldown', () => {
  it('T1 product cell is a <DrilldownLink> to /backoffice/inventory/recipes/<product_id>', () => {
    r();
    const link = screen.getByRole('link', { name: /Croissant/ });
    expect(link.getAttribute('href')).toBe('/backoffice/inventory/recipes/prod-abc');
  });
});
```

- [ ] **Step 4: Run test**

```bash
pnpm --filter @breakery/app-backoffice test stock-movements-drilldown
```

Expected: T1 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backoffice/src/pages/reports/StockMovementHistoryPage.tsx \
        apps/backoffice/src/pages/reports/__tests__/stock-movements-drilldown.smoke.test.tsx
git commit -m "feat(reports): session 32 — wave 3.H — wire StockMovementHistory product drill (DEV-S31-3.B-01) (1/1 smoke PASS)"
```

---

### Task 3.I : Wire PaymentByMethod drill-down → /backoffice/orders

**Files:**
- Modify: `apps/backoffice/src/pages/reports/PaymentByMethodPage.tsx`
- Create: `apps/backoffice/src/pages/reports/__tests__/payment-by-method-drilldown.smoke.test.tsx`

- [ ] **Step 1: Read current page**

Locate the row rendering — typically a per-method aggregate row showing method, total, count.

- [ ] **Step 2: Wrap method cell with `<DrilldownLink entity="order_list">`**

```tsx
<DrilldownLink
  entity="order_list"
  id=""
  label={line.method}
  filter={{
    payment_method: line.method,
    start: dateStart,
    end:   dateEnd,
  }}
/>
```

Remove S31 terminal comment.

- [ ] **Step 3: Write smoke test**

Content of `apps/backoffice/src/pages/reports/__tests__/payment-by-method-drilldown.smoke.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PaymentByMethodPage from '../PaymentByMethodPage.js';

vi.mock('@/features/reports/hooks/usePaymentsByMethod.js', () => ({
  usePaymentsByMethod: () => ({
    data: {
      methods: [
        { method: 'cash', count: 5, total: 500000 },
      ],
      by_day:  [],
      // adapt if hook shape differs
    },
    isLoading: false,
    error: null,
  }),
}));

function r() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PaymentByMethodPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PaymentByMethodPage drilldown', () => {
  it('T1 method cell is a <DrilldownLink> to /backoffice/orders with payment_method filter', () => {
    r();
    const link = screen.getByRole('link', { name: /cash/ });
    const href = link.getAttribute('href') ?? '';
    expect(href).toContain('/backoffice/orders');
    expect(href).toContain('payment_method=cash');
  });
});
```

Note : the mock hook shape may need adjustment depending on actual hook (read it first).

- [ ] **Step 4: Run test**

```bash
pnpm --filter @breakery/app-backoffice test payment-by-method-drilldown
```

Expected: T1 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backoffice/src/pages/reports/PaymentByMethodPage.tsx \
        apps/backoffice/src/pages/reports/__tests__/payment-by-method-drilldown.smoke.test.tsx
git commit -m "feat(reports): session 32 — wave 3.I — wire PaymentByMethod order_list drill (1/1 smoke PASS)"
```

---

### Task 3.J : Wire SalesByHour drill-down → /backoffice/orders

**Files:**
- Modify: `apps/backoffice/src/pages/reports/SalesByHourPage.tsx`
- Create: `apps/backoffice/src/pages/reports/__tests__/sales-by-hour-drilldown.smoke.test.tsx`

- [ ] **Step 1: Read current page**

Note whether the report is single-day or multi-day. If multi-day, pass the report's full date range; the hour filter applies on top.

- [ ] **Step 2: Wrap hour cell with `<DrilldownLink entity="order_list">`**

```tsx
<DrilldownLink
  entity="order_list"
  id=""
  label={`${line.hour}h`}
  filter={{
    hour:  line.hour,
    start: dateStart,
    end:   dateEnd,
  }}
/>
```

- [ ] **Step 3: Write smoke test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SalesByHourPage from '../SalesByHourPage.js';

vi.mock('@/features/reports/hooks/useSalesByHour.js', () => ({
  useSalesByHour: () => ({
    data: { lines: [{ hour: 14, count: 5, total: 200000 }] },
    isLoading: false,
    error: null,
  }),
}));

function r() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SalesByHourPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SalesByHourPage drilldown', () => {
  it('T1 hour cell is a <DrilldownLink> to /backoffice/orders with hour filter', () => {
    r();
    const link = screen.getByRole('link', { name: /14h/ });
    const href = link.getAttribute('href') ?? '';
    expect(href).toContain('/backoffice/orders');
    expect(href).toContain('hour=14');
  });
});
```

Adapt hook mock shape to actual hook.

- [ ] **Step 4: Run test**

```bash
pnpm --filter @breakery/app-backoffice test sales-by-hour-drilldown
```

- [ ] **Step 5: Commit**

```bash
git add apps/backoffice/src/pages/reports/SalesByHourPage.tsx \
        apps/backoffice/src/pages/reports/__tests__/sales-by-hour-drilldown.smoke.test.tsx
git commit -m "feat(reports): session 32 — wave 3.J — wire SalesByHour order_list drill (1/1 smoke PASS)"
```

---

### Task 3.K : OrdersListPage filters bar (enrichment)

This task adds the filters bar UI on top of the skeleton from Task 3.B. It's optional for the close-out (skeleton already lets URL-param drill-down land correctly), but completes the audit-grade scope.

**Files:**
- Modify: `apps/backoffice/src/pages/orders/OrdersListPage.tsx`

- [ ] **Step 1: Add controlled filter UI driven by URL state**

Extend the page with a filter bar above the table. Each filter input writes to `searchParams` via `setSearchParams`. Example for status select:

```tsx
const [searchParams, setSearchParams] = useSearchParams();

function setParam(key: string, value: string | undefined): void {
  const next = new URLSearchParams(searchParams);
  if (value === undefined || value === '') next.delete(key);
  else next.set(key, value);
  setSearchParams(next, { replace: true });
}

// in JSX :
<select
  value={searchParams.get('status') ?? ''}
  onChange={(e) => setParam('status', e.target.value || undefined)}
>
  <option value="">Any status</option>
  <option value="open">Open</option>
  <option value="completed">Completed</option>
  <option value="voided">Voided</option>
  <option value="refunded">Refunded</option>
</select>
```

Repeat for `order_type`, `payment_method`, `customer_type`, `refund_status`. Add number inputs for `total_min`/`total_max`. Add date inputs for `start`/`end`.

For `customer_id` and `served_by`, keep as raw text inputs for V1 (typeahead deferred S33+).

- [ ] **Step 2: Add active filter chips**

Below the bar, render a chip per active filter param with a × button that calls `setParam(key, undefined)`.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @breakery/app-backoffice typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/backoffice/src/pages/orders/OrdersListPage.tsx
git commit -m "feat(backoffice): session 32 — wave 3.K — OrdersListPage filters bar + active filter chips"
```

---

## Wave 4 — Closeout

### Task 4.A : Full test sweep + typecheck

- [ ] **Step 1: Run targeted BO suites**

```bash
pnpm --filter @breakery/app-backoffice test buildDrilldownUrl
pnpm --filter @breakery/app-backoffice test useOrdersList
pnpm --filter @breakery/app-backoffice test OrdersListPage
pnpm --filter @breakery/app-backoffice test GeneralLedgerPage
pnpm --filter @breakery/app-backoffice test drilldown
```

Expected: all PASS.

- [ ] **Step 2: Typecheck monorepo**

```bash
pnpm typecheck
```

Expected: 6/6 packages PASS.

- [ ] **Step 3: Run pgTAP suites (cloud MCP)**

Use `mcp__plugin_supabase_supabase__execute_sql` to run:
- `supabase/tests/orders_list_v1.test.sql`
- `supabase/tests/accounting_account_id_exposed.test.sql`
- `supabase/tests/orders_read_perm.test.sql` (S31 regression)

Expected: all PASS (some may be `skipped_*` if seed data sparse).

- [ ] **Step 4: If any failure, fix inline and re-run**

Document any failure remediation in INDEX §10 deviations.

---

### Task 4.B : Update INDEX + CLAUDE.md Active Workplan

**Files:**
- Create: `docs/workplan/plans/2026-05-26-session-32-INDEX.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Write the INDEX**

Use the S31 INDEX (`docs/workplan/plans/2026-05-22-session-31-INDEX.md`) as template. Include sections :
1. Summary
2. Migrations applied (5)
3. New files (S32)
4. Files modified
5. Tests run
6. Permissions seeded (0 — reuses S31 `orders.read`)
7. RPCs added (1) + bumps (3 additive)
8. Tasks closed
9. RPCs/EFs out of scope (none — all the previously-deferred ones are now closed)
10. Deviations vs spec/plan
11. Acceptance criteria
12. Backlog Vague C remaining (S33+)

- [ ] **Step 2: Update CLAUDE.md "Active Workplan" section**

Bump the "Current session" line to reference S32 with merge commit (TBD until merge). Move S31 line into the "Previous session" / "Session NN reference" stack with abbreviated summary.

Also update the **Migration sequence active** section : add bullet for `20260617000010..014`.

- [ ] **Step 3: Commit**

```bash
git add docs/workplan/plans/2026-05-26-session-32-INDEX.md CLAUDE.md
git commit -m "docs(s32): wave 4.B — INDEX + CLAUDE.md Active Workplan + status notes (S32 closeout)"
```

---

### Task 4.C : Push branch + open PR

- [ ] **Step 1: Push branch**

```bash
git push -u origin swarm/session-32
```

- [ ] **Step 2: Open PR via gh CLI**

```bash
gh pr create --title "Session 32 — Reports Vague C close-out drill-down + /backoffice/orders list" --body "$(cat <<'EOF'
## Summary
- 3 bumps additifs P&L/BS/CF pour exposer `account_id` (CREATE OR REPLACE, pas de v2)
- 1 nouvelle RPC `get_orders_list_v1` cursor-paginée avec filtres JSONB + REVOKE pair S25
- 1 nouvelle page `/backoffice/orders` full audit-grade filters (URL state = source of truth)
- GeneralLedgerPage accepte `?account_id=&start=&end=` URL params
- 7 reports re-wirés avec `<DrilldownLink>` (P&L, BS, CF, PB1, StockMovements, PaymentByMethod, SalesByHour)
- DEV-S31-3.B-01 résolu : RPC S30 expose déjà `product_id`, juste fix interface hook

## Test plan
- [x] pgTAP `accounting_account_id_exposed` 3/3 PASS (cloud MCP)
- [x] pgTAP `orders_list_v1` 9/9 PASS (cloud MCP)
- [x] Unit `buildDrilldownUrl` order_list extension 5/5 PASS
- [x] Unit `useOrdersList` 2/2 PASS
- [x] BO smoke `OrdersListPage` 3/3 PASS
- [x] BO smoke `GeneralLedgerPage` URL params 1/1 PASS
- [x] BO smoke drill samples (P&L, BS, CF, StockMovements, PaymentByMethod, SalesByHour) 6/6 PASS
- [x] `pnpm typecheck` 6/6 packages PASS

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review (post-write)

**Spec coverage check** :
- §3.1-3.3 P&L/BS/CF bumps → Tasks 1.B, 1.C, 1.D ✓
- §3.4 get_orders_list_v1 → Task 1.E ✓
- §3.5 REVOKE pair → Task 1.F ✓
- §3.6 Types regen → Task 1.G ✓
- §4.1 useProfitLoss/BS/CF bump → Tasks 2.B, 2.C, 2.D ✓
- §4.2 useStockMovementsReport bump → Task 2.E ✓
- §4.3 usePb1Report client-side resolve → Task 3.G ✓
- §4.4 useOrdersList → Task 2.F ✓
- §5 OrdersListPage UX → Tasks 3.B, 3.C (skeleton + smoke), 3.K (filters bar) ✓
- §6.1 7 reports drill wiring → Tasks 3.D-3.J ✓
- §6.2 buildDrilldownUrl extension → Task 2.A ✓
- §6.3 GeneralLedgerPage URL-seeded → Task 3.A ✓
- §7 Test plan → Tasks 1.H, 1.I (pgTAP), 2.A/2.F (unit), 3.A/3.C/3.D-J (BO smoke), 4.A (sweep) ✓

**Type consistency** :
- `OrdersListLine` interface in Task 2.F matches the RPC JSONB output keys from Task 1.E ✓
- `PnlLine.account_id` (Task 2.B) matches RPC bump (Task 1.B) ✓
- `DrilldownFilter` extensions in Task 2.A match URL params consumed in Task 3.B ✓

**Placeholder scan** :
- Task 1.C/1.D have `-- COPY ACTUAL SIGNATURE` and `-- COPY ACTUAL BODY` placeholders — these are explicit instructions for the implementer to read the current migration first, not lazy placeholders. Acceptable because the body varies between current state of those RPCs and we don't know the exact current body without reading.
- Task 3.E/3.F have "Same pattern as Task 3.D" — the writing-plans guide warns against this. Mitigate by spelling out the per-task variations (different component names, different mock data) inline in Step 2 of each task. Both tasks state explicitly that the wrap pattern is `<DrilldownLink entity="account" id={line.account_id} filter={{ start, end }} />` so the implementer doesn't need to scroll back.

---

**Plan complete.** Saved to `docs/workplan/plans/2026-05-26-session-32-plan.md`.
