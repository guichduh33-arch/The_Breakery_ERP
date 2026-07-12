# S74 — POS Reports Margin Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the last lot of the POS Reports refonte — a permission-gated Margin tab backed by a pure-read RPC `get_pos_margin_v1` (COGS = current WAC), reconciling exactly with the Overview.

**Architecture:** One read-only SECURITY DEFINER RPC over the module's shared order scope (≡ Overview `_146`/`_153`), gated `reports.financial.read` (NOT `reports.sales.read` — costs/profit are financial data). One TanStack-Query hook + one page in `apps/pos/src/features/reports/`, a permission-filtered tab in `POSReportsLayout`, and a route. Money-path untouched.

**Tech Stack:** Supabase cloud V3 (`ikcyvlovptebroadgtvd`) via MCP, plpgsql + pgTAP, React 18 + TanStack Query v5 + `@breakery/ui`, Vitest + Testing Library, pnpm 9.15 + turbo.

**Spec:** `docs/superpowers/specs/2026-07-12-s74-pos-margin-cogs-design.md` (approved 2026-07-12).

## Global Constraints

- **Money-path v17/v11/v5 and `_record_sale_stock_v1` untouched.** No writes anywhere. Snapshot COGS stays in Vague 3.
- **DB = Supabase cloud only** (Docker retired): apply via `mcp__claude_ai_Supabase__apply_migration`, SQL via `execute_sql`. NEVER `supabase start` / `db reset` / `run_pgtap.sh`. **No `BEGIN;`/`COMMIT;` inside the migration body.**
- **Subagents cannot reach MCP** — Task 2 (apply + pgTAP live + types) runs on the CONTROLLER, not a subagent.
- **Types are GRAFTED** into `packages/supabase/src/types.generated.ts` (DEV-S69-03 — full regen drifts). Commit the graft.
- Migration NAME-block is monotonic: highest is `20260711000159` → this lot uses `20260712000160`.
- RPC mold (lots A→G): `STABLE SECURITY DEFINER`, `SET search_path TO 'public','pg_temp'`, gate → `42501`, date guards → `P0001`, tz from `business_config` (default `Asia/Makassar`), REVOKE trio (`PUBLIC, anon` + `GRANT authenticated` + default-privileges REVOKE), `COMMENT ON FUNCTION`.
- pnpm 9.15 + turbo, never npm. Conventional commits, co-author `Claude Fable 5 <noreply@anthropic.com>`.
- Vitest filters match FILE NAMES (`POSMarginReportPage` matches the test file, not describe blocks).
- Files < 500 lines.

---

### Task 1: Branch + migration SQL + pgTAP suite (author only — no DB access needed)

**Files:**
- Create: `supabase/migrations/20260712000160_get_pos_margin_v1.sql`
- Create: `supabase/tests/pos_margin.test.sql`

**Interfaces:**
- Produces: RPC `public.get_pos_margin_v1(p_start_date date, p_end_date date) RETURNS jsonb` with envelope `{generated_at, start_date, end_date, timezone, summary:{revenue_ttc, revenue_ht, cogs, gross_margin, margin_pct, orders, products_without_cost}, by_product:[{product_id, product_name, category_name, qty, revenue_ht, cogs, margin, margin_pct}], by_category:[{category_id, category_name, qty, revenue_ht, cogs, margin, margin_pct}]}`. Task 3's hook consumes exactly these keys.

- [ ] **Step 1: Create the branch**

```bash
git checkout master && git pull && git checkout -b feat/pos-reports-margin
```

- [ ] **Step 2: Write the migration** — `supabase/migrations/20260712000160_get_pos_margin_v1.sql`:

```sql
-- Reports POS refonte (dernier lot) — Margin tab: gross margin on CURRENT WAC.
-- Order scope ≡ Overview (_146/_153): paid+completed, non-B2B, non-historical,
-- no test-product line, WITA business date (paid_at ?? created_at) — so
-- summary.revenue_ttc reconciles with Overview revenue EXACTLY (pgTAP-asserted).
--   * summary     — revenue_ttc (order-level SUM(total)), revenue_ht (line-level
--                   SUM(line_total), net of item discounts, gross of order-level
--                   discounts — same basis as BO get_gross_margin_by_product_v1),
--                   cogs, gross_margin, margin_pct, orders, products_without_cost.
--   * by_product / by_category — line-level (is_cancelled=false). Promo-gift
--                   lines ARE included with revenue forced to 0: a gifted product
--                   consumes stock, so it weighs on real margin. This is the one
--                   deliberate divergence from Overview items_sold (which excludes
--                   gifts).
-- COGS = quantity × products.cost_price (CURRENT WAC — caveat surfaced in the UI;
-- the at-sale COGS snapshot stays in Vague 3). cost_price NULL/0 → cogs 0 and the
-- product is counted in products_without_cost (margin otherwise silently inflated).
-- Gated reports.financial.read (NOT reports.sales.read — costs are not for every
-- sales reader; mirrors the BO margin gate). Read-only. Money-path untouched.
-- Divergence vs BO get_gross_margin_by_product_v1 is deliberate and documented:
-- the BO includes settled B2B and does not exclude test products.

CREATE OR REPLACE FUNCTION public.get_pos_margin_v1(
  p_start_date date,
  p_end_date   date
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz          TEXT;
  v_start       date;
  v_end         date;
  v_summary     JSONB;
  v_by_product  JSONB;
  v_by_category JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.financial.read') THEN
    RAISE EXCEPTION 'permission denied: reports.financial.read required' USING ERRCODE = '42501';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'start and end dates are required' USING ERRCODE = 'P0001';
  END IF;
  IF p_start_date > p_end_date THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = 'P0001';
  END IF;
  v_start := p_start_date;
  v_end   := p_end_date;
  IF v_end - v_start > 366 THEN
    v_start := v_end - 366;  -- clamp pattern S30/S40
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  WITH scoped AS (
    SELECT o.id, o.total
    FROM orders o
    WHERE o.status IN ('paid', 'completed')
      AND o.order_type <> 'b2b'
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((COALESCE(o.paid_at, o.created_at) AT TIME ZONE v_tz))::date
          BETWEEN v_start AND v_end
  ),
  lines AS (
    SELECT
      oi.product_id,
      p.name                              AS product_name,
      c.id                                AS category_id,
      COALESCE(c.name, '(uncategorized)') AS category_name,
      oi.quantity                         AS qty,
      CASE WHEN oi.is_promo_gift THEN 0 ELSE oi.line_total END AS revenue_ht,
      (oi.quantity * COALESCE(p.cost_price, 0))::numeric(14,2) AS cogs,
      (COALESCE(p.cost_price, 0) <= 0)    AS no_cost
    FROM order_items oi
    JOIN scoped   s ON s.id = oi.order_id
    JOIN products p ON p.id = oi.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE oi.is_cancelled = false
  ),
  prod AS (
    SELECT product_id, product_name, category_name,
           SUM(qty) AS qty, SUM(revenue_ht) AS rev, SUM(cogs) AS cogs
    FROM lines GROUP BY product_id, product_name, category_name
  ),
  cat AS (
    SELECT category_id, category_name,
           SUM(qty) AS qty, SUM(revenue_ht) AS rev, SUM(cogs) AS cogs
    FROM lines GROUP BY category_id, category_name
  ),
  tot AS (SELECT COALESCE(SUM(total), 0) AS ttc, COUNT(*) AS n FROM scoped),
  ltot AS (
    SELECT COALESCE(SUM(revenue_ht), 0) AS rev,
           COALESCE(SUM(cogs), 0)       AS cogs,
           COUNT(DISTINCT product_id) FILTER (WHERE no_cost) AS no_cost_products
    FROM lines
  )
  SELECT
    jsonb_build_object(
      'revenue_ttc',  (SELECT ttc FROM tot),
      'revenue_ht',   (SELECT rev FROM ltot),
      'cogs',         (SELECT cogs FROM ltot),
      'gross_margin', (SELECT rev - cogs FROM ltot),
      'margin_pct',   (SELECT COALESCE(ROUND(100 * (rev - cogs) / NULLIF(rev, 0), 2), 0) FROM ltot),
      'orders',       (SELECT n FROM tot),
      'products_without_cost', (SELECT no_cost_products FROM ltot)
    ),
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'product_id',    g.product_id,
        'product_name',  g.product_name,
        'category_name', g.category_name,
        'qty',           g.qty,
        'revenue_ht',    g.rev,
        'cogs',          g.cogs,
        'margin',        g.rev - g.cogs,
        'margin_pct',    COALESCE(ROUND(100 * (g.rev - g.cogs) / NULLIF(g.rev, 0), 2), 0)
      ) ORDER BY g.rev DESC) FROM prod g), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'category_id',   g.category_id,
        'category_name', g.category_name,
        'qty',           g.qty,
        'revenue_ht',    g.rev,
        'cogs',          g.cogs,
        'margin',        g.rev - g.cogs,
        'margin_pct',    COALESCE(ROUND(100 * (g.rev - g.cogs) / NULLIF(g.rev, 0), 2), 0)
      ) ORDER BY g.rev DESC) FROM cat g), '[]'::jsonb)
  INTO v_summary, v_by_product, v_by_category;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'start_date',   v_start,
    'end_date',     v_end,
    'timezone',     v_tz,
    'summary',      v_summary,
    'by_product',   v_by_product,
    'by_category',  v_by_category
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_pos_margin_v1(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pos_margin_v1(date, date) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
COMMENT ON FUNCTION public.get_pos_margin_v1(date, date) IS
  'POS reports Margin tab: gross margin on CURRENT WAC (products.cost_price) over a WITA range; order scope shared with the Overview (paid+completed, non-B2B, non-historical, no test-product line) so revenue_ttc reconciles exactly; promo-gift lines counted in COGS with revenue 0; gated reports.financial.read. Read-only. Deliberately diverges from BO get_gross_margin_by_product_v1 (which includes B2B).';
```

- [ ] **Step 3: Write the pgTAP suite** — `supabase/tests/pos_margin.test.sql`. Fixtures use far-future 2031 dates + `session_replication_role = replica` (mold: `gross_margin_by_product.test.sql`). Run via MCP `execute_sql` in a `BEGIN…ROLLBACK` envelope:

```sql
-- pgTAP — get_pos_margin_v1 (Reports POS refonte, dernier lot — Margin/COGS).
-- Run via MCP execute_sql inside BEGIN … ROLLBACK (Docker retired).
-- Verifies: financial gate (anon + sales-only caller), date guards, envelope,
-- exact reconciliation with the Overview (shared scope), internal sums,
-- fixture-exact margin math, promo-gift COGS-with-zero-revenue rule,
-- products_without_cost counting, and the anon REVOKE.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(13);

-- ── T1 : anon (no auth.uid()) is denied ────────────────────────────────────
SELECT throws_ok(
  $$ SELECT get_pos_margin_v1('2026-05-01','2026-07-12') $$,
  '42501', NULL, 'T1: anon / no-perm caller is denied');

-- ── T2 : caller WITHOUT reports.financial.read is denied ───────────────────
-- (If the dev DB has no such user, v_auth stays NULL → auth.uid() NULL → still 42501.)
DO $$
DECLARE v_auth uuid;
BEGIN
  SELECT up.auth_user_id INTO v_auth FROM user_profiles up
  WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
    AND NOT has_permission(up.auth_user_id, 'reports.financial.read') LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);
END $$;
SELECT throws_ok(
  $$ SELECT get_pos_margin_v1('2026-05-01','2026-07-12') $$,
  '42501', NULL, 'T2: caller without reports.financial.read is denied');

-- ── Impersonate a user holding BOTH financial.read and sales.read ──────────
DO $$
DECLARE v_auth uuid;
BEGIN
  SELECT up.auth_user_id INTO v_auth FROM user_profiles up
  WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
    AND has_permission(up.auth_user_id, 'reports.financial.read')
    AND has_permission(up.auth_user_id, 'reports.sales.read') LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);
END $$;

-- ── T3/T4 : date guards ─────────────────────────────────────────────────────
SELECT throws_ok(
  $$ SELECT get_pos_margin_v1(NULL, '2026-07-12') $$, 'P0001', NULL,
  'T3: NULL start date raises P0001');
SELECT throws_ok(
  $$ SELECT get_pos_margin_v1('2026-07-12','2026-05-01') $$, 'P0001', NULL,
  'T4: start > end raises invalid_date_range');

-- ── T5/T6 : envelope + timezone ─────────────────────────────────────────────
WITH r AS (SELECT get_pos_margin_v1('2026-05-01','2026-07-12') AS j)
SELECT ok((SELECT j ? 'timezone' AND j ? 'summary' AND j ? 'by_product' AND j ? 'by_category' FROM r),
          'T5: envelope exposes timezone/summary/by_product/by_category');
WITH r AS (SELECT get_pos_margin_v1('2026-05-01','2026-07-12') AS j)
SELECT is((SELECT j->>'timezone' FROM r), 'Asia/Makassar',
          'T6: timezone is the business tz (WITA)');

-- ── T7 : summary.revenue_ttc ≡ Overview revenue (shared scope, exact) ──────
WITH m AS (SELECT get_pos_margin_v1('2026-05-01','2026-07-12') AS j),
o AS (SELECT get_pos_sales_overview_v1('2026-05-01','2026-07-12') AS j)
SELECT is(
  (SELECT (j->'summary'->>'revenue_ttc')::numeric FROM m),
  (SELECT (j->>'revenue')::numeric FROM o),
  'T7: summary.revenue_ttc reconciles exactly with Overview revenue');

-- ── T8/T9 : internal sums ───────────────────────────────────────────────────
WITH r AS (SELECT get_pos_margin_v1('2026-05-01','2026-07-12') AS j)
SELECT is(
  (SELECT COALESCE(SUM((p->>'revenue_ht')::numeric),0)
     FROM r, jsonb_array_elements(j->'by_product') p),
  (SELECT (j->'summary'->>'revenue_ht')::numeric FROM r),
  'T8: sum(by_product.revenue_ht) = summary.revenue_ht');
WITH r AS (SELECT get_pos_margin_v1('2026-05-01','2026-07-12') AS j)
SELECT is(
  (SELECT COALESCE(SUM((p->>'cogs')::numeric),0)
     FROM r, jsonb_array_elements(j->'by_product') p),
  (SELECT (j->'summary'->>'cogs')::numeric FROM r),
  'T9: sum(by_product.cogs) = summary.cogs');

-- ── Fixtures (2031, replica mode — mold gross_margin_by_product.test.sql) ──
SET LOCAL session_replication_role = replica;

-- ── T10 : fixture-exact margin math + TTC summary ──────────────────────────
DO $$
DECLARE
  v_auth uuid; v_prof uuid; v_sess uuid; v_cat uuid; v_prod uuid; v_ord uuid;
  v_res jsonb; v_line jsonb; v_ok boolean;
BEGIN
  SELECT up.auth_user_id, up.id INTO v_auth, v_prof FROM user_profiles up
  WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
    AND has_permission(up.auth_user_id, 'reports.financial.read') LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);
  SELECT id INTO v_cat FROM categories WHERE deleted_at IS NULL LIMIT 1;

  -- created_via='pos' requires a real session_id; status='closed' avoids the
  -- one_open_session_per_user partial EXCLUDE (same-transaction collisions).
  INSERT INTO pos_sessions (opened_by, opening_cash, status) VALUES (v_prof, 0, 'closed')
  RETURNING id INTO v_sess;
  INSERT INTO products (name, sku, category_id, retail_price, unit, cost_price)
  VALUES ('PM Test Product 1', 'PM-TEST-1', v_cat, 2500, 'pcs', 1000)
  RETURNING id INTO v_prod;
  INSERT INTO orders (order_number, session_id, status, subtotal, tax_amount, total, created_via, paid_at)
  VALUES ('PM-TEST-ORD-1', v_sess, 'paid', 7500, 750, 8250, 'pos', '2031-03-15 10:00:00+00')
  RETURNING id INTO v_ord;
  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total)
  VALUES (v_ord, v_prod, 'PM Test Product 1', 2500, 3, 7500);

  v_res := get_pos_margin_v1('2031-03-15', '2031-03-15');
  SELECT e INTO v_line FROM jsonb_array_elements(v_res->'by_product') e
    WHERE (e->>'product_id')::uuid = v_prod;
  v_ok := v_line IS NOT NULL
      AND (v_line->>'revenue_ht')::numeric = 7500
      AND (v_line->>'cogs')::numeric       = 3000
      AND (v_line->>'margin')::numeric     = 4500
      AND (v_line->>'margin_pct')::numeric = 60.00
      AND (v_res->'summary'->>'revenue_ttc')::numeric = 8250;
  PERFORM set_config('breakery.pm_t10', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.pm_t10')::boolean,
  'T10: fixture-exact revenue_ht/cogs/margin/margin_pct + revenue_ttc');

-- ── T11 : promo-gift line — qty+COGS counted, revenue forced to 0 ──────────
DO $$
DECLARE
  v_auth uuid; v_prof uuid; v_sess uuid; v_cat uuid; v_gift uuid; v_ord uuid;
  v_res jsonb; v_line jsonb; v_ok boolean;
BEGIN
  SELECT up.auth_user_id, up.id INTO v_auth, v_prof FROM user_profiles up
  WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
    AND has_permission(up.auth_user_id, 'reports.financial.read') LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);
  SELECT id INTO v_cat FROM categories WHERE deleted_at IS NULL LIMIT 1;

  INSERT INTO pos_sessions (opened_by, opening_cash, status) VALUES (v_prof, 0, 'closed')
  RETURNING id INTO v_sess;
  INSERT INTO products (name, sku, category_id, retail_price, unit, cost_price)
  VALUES ('PM Test Gift', 'PM-TEST-GIFT', v_cat, 1500, 'pcs', 500)
  RETURNING id INTO v_gift;
  INSERT INTO orders (order_number, session_id, status, subtotal, tax_amount, total, created_via, paid_at)
  VALUES ('PM-TEST-ORD-2', v_sess, 'paid', 0, 0, 0, 'pos', '2031-03-17 10:00:00+00')
  RETURNING id INTO v_ord;
  -- line_total deliberately non-zero to prove the CASE forces gift revenue to 0.
  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total, is_promo_gift)
  VALUES (v_ord, v_gift, 'PM Test Gift', 1500, 2, 999, true);

  v_res := get_pos_margin_v1('2031-03-17', '2031-03-17');
  SELECT e INTO v_line FROM jsonb_array_elements(v_res->'by_product') e
    WHERE (e->>'product_id')::uuid = v_gift;
  v_ok := v_line IS NOT NULL
      AND (v_line->>'qty')::numeric        = 2
      AND (v_line->>'cogs')::numeric       = 1000
      AND (v_line->>'revenue_ht')::numeric = 0;
  PERFORM set_config('breakery.pm_t11', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.pm_t11')::boolean,
  'T11: promo-gift line counts qty+COGS with revenue 0');

-- ── T12 : product without cost — cogs 0, counted in products_without_cost ──
DO $$
DECLARE
  v_auth uuid; v_prof uuid; v_sess uuid; v_cat uuid; v_nc uuid; v_ord uuid;
  v_res jsonb; v_line jsonb; v_ok boolean;
BEGIN
  SELECT up.auth_user_id, up.id INTO v_auth, v_prof FROM user_profiles up
  WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
    AND has_permission(up.auth_user_id, 'reports.financial.read') LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);
  SELECT id INTO v_cat FROM categories WHERE deleted_at IS NULL LIMIT 1;

  INSERT INTO pos_sessions (opened_by, opening_cash, status) VALUES (v_prof, 0, 'closed')
  RETURNING id INTO v_sess;
  INSERT INTO products (name, sku, category_id, retail_price, unit, cost_price)
  VALUES ('PM Test NoCost', 'PM-TEST-NC', v_cat, 2000, 'pcs', 0)
  RETURNING id INTO v_nc;
  INSERT INTO orders (order_number, session_id, status, subtotal, tax_amount, total, created_via, paid_at)
  VALUES ('PM-TEST-ORD-3', v_sess, 'paid', 2000, 200, 2200, 'pos', '2031-03-19 10:00:00+00')
  RETURNING id INTO v_ord;
  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total)
  VALUES (v_ord, v_nc, 'PM Test NoCost', 2000, 1, 2000);

  v_res := get_pos_margin_v1('2031-03-19', '2031-03-19');
  SELECT e INTO v_line FROM jsonb_array_elements(v_res->'by_product') e
    WHERE (e->>'product_id')::uuid = v_nc;
  v_ok := v_line IS NOT NULL
      AND (v_line->>'cogs')::numeric = 0
      AND (v_res->'summary'->>'products_without_cost')::int >= 1;
  PERFORM set_config('breakery.pm_t12', COALESCE(v_ok, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.pm_t12')::boolean,
  'T12: zero-cost product has cogs 0 and increments products_without_cost');

-- ── T13 : anon has no EXECUTE (REVOKE trio effective) ───────────────────────
SELECT ok(NOT has_function_privilege('anon', 'public.get_pos_margin_v1(date,date)', 'EXECUTE'),
  'T13: anon cannot EXECUTE get_pos_margin_v1');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260712000160_get_pos_margin_v1.sql supabase/tests/pos_margin.test.sql
git commit -m "feat(db): get_pos_margin_v1 — POS margin on current WAC, gated reports.financial.read (_160)"
```

---

### Task 2: Apply migration + run pgTAP live + graft types — **CONTROLLER ONLY (MCP)**

**Files:**
- Modify: `packages/supabase/src/types.generated.ts` (graft one entry next to the `get_pos_*` functions, around line 6890)

**Interfaces:**
- Consumes: Task 1's migration + test files.
- Produces: live RPC on `ikcyvlovptebroadgtvd`; `supabase.rpc('get_pos_margin_v1', …)` type-checks.

- [ ] **Step 1: Apply the migration** via `mcp__claude_ai_Supabase__apply_migration` — `project_id='ikcyvlovptebroadgtvd'`, `name='get_pos_margin_v1'`, body = the migration file content (already transaction-wrapped by MCP).

- [ ] **Step 2: Run the pgTAP suite live.** File is ~11 KB — if a single `execute_sql` call truncates, use the API-from-file runner (memory: `workflow_supabase_api_from_file_runner`): POST the file to `api.supabase.com/v1/projects/ikcyvlovptebroadgtvd/database/query`. Expected: last row `ok 13 - T13: …` (any `not ok` → fix the RPC, re-`apply_migration` with a `_fix` name suffix, re-run).

- [ ] **Step 3: Graft the RPC type.** In `packages/supabase/src/types.generated.ts`, next to `get_pos_order_type_category_mix_v1` (~line 6890), insert:

```ts
      get_pos_margin_v1: {
        Args: { p_end_date: string; p_start_date: string }
        Returns: Json
      }
```

- [ ] **Step 4: Typecheck the supabase package**

Run: `pnpm --filter @breakery/supabase typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/supabase/src/types.generated.ts
git commit -m "feat(types): graft get_pos_margin_v1 (DEV-S69-03 — no full regen)"
```

---

### Task 3: Hook `usePOSReportsMargin`

**Files:**
- Modify: `apps/pos/src/features/reports/hooks/usePOSReports.ts` (append after the Activity section, ~line 707; add `usePOSReportsMargin` to the header comment list lines 9-15)

**Interfaces:**
- Consumes: RPC envelope from Task 1 (snake_case keys).
- Produces (Task 4 consumes): `usePOSReportsMargin(period: ReportsPeriod): UseQueryResult<POSReportsMargin>` and types `POSReportsMargin { summary: POSReportsMarginSummary; byProduct: POSReportsMarginProductRow[]; byCategory: POSReportsMarginCategoryRow[]; timezone: string }`, `POSReportsMarginSummary { revenueTtc; revenueHt; cogs; grossMargin; marginPct; orders; productsWithoutCost: number }`, `POSReportsMarginProductRow { productId: string; productName: string; categoryName: string; qty; revenueHt; cogs; margin; marginPct: number }`, `POSReportsMarginCategoryRow` (same numeric fields, `categoryId: string | null; categoryName: string`).

- [ ] **Step 1: Append the Margin section** to `usePOSReports.ts`:

```ts
// ─── Margin (COGS = current WAC) ────────────────────────────────────────────
//
// Source of truth: server RPC `get_pos_margin_v1(p_start_date, p_end_date)`.
// Same order scope as the Overview (summary.revenue_ttc reconciles exactly);
// margin math is line-level HT (net of item discounts) against CURRENT
// products.cost_price — NOT a snapshot at sale time (Vague 3). Promo-gift
// lines count qty+COGS with revenue 0. Gated reports.financial.read.

export interface POSReportsMarginSummary {
  revenueTtc: number;
  revenueHt: number;
  cogs: number;
  grossMargin: number;
  marginPct: number;
  orders: number;
  /** Products sold with NULL/0 cost_price — margin is overstated when > 0. */
  productsWithoutCost: number;
}

export interface POSReportsMarginProductRow {
  productId: string;
  productName: string;
  categoryName: string;
  qty: number;
  revenueHt: number;
  cogs: number;
  margin: number;
  marginPct: number;
}

export interface POSReportsMarginCategoryRow {
  categoryId: string | null;
  categoryName: string;
  qty: number;
  revenueHt: number;
  cogs: number;
  margin: number;
  marginPct: number;
}

export interface POSReportsMargin {
  summary: POSReportsMarginSummary;
  byProduct: POSReportsMarginProductRow[];
  byCategory: POSReportsMarginCategoryRow[];
  timezone: string;
}

interface RawMarginProductRow {
  product_id: string;
  product_name: string;
  category_name: string;
  qty: number | string;
  revenue_ht: number | string;
  cogs: number | string;
  margin: number | string;
  margin_pct: number | string;
}
interface RawMarginCategoryRow {
  category_id: string | null;
  category_name: string;
  qty: number | string;
  revenue_ht: number | string;
  cogs: number | string;
  margin: number | string;
  margin_pct: number | string;
}
interface MarginPayload {
  timezone: string;
  summary: {
    revenue_ttc: number | string;
    revenue_ht: number | string;
    cogs: number | string;
    gross_margin: number | string;
    margin_pct: number | string;
    orders: number | string;
    products_without_cost: number | string;
  };
  by_product: RawMarginProductRow[];
  by_category: RawMarginCategoryRow[];
}

export function usePOSReportsMargin(period: ReportsPeriod) {
  return useQuery<POSReportsMargin>({
    queryKey: ['pos-reports-margin', period.startDate, period.endDate],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_pos_margin_v1', {
        p_start_date: period.startDate,
        p_end_date: period.endDate,
      });
      if (error) throw new Error(error.message);
      const p = data as unknown as MarginPayload;
      const s = p.summary;
      return {
        timezone: p.timezone,
        summary: {
          revenueTtc: Number(s.revenue_ttc),
          revenueHt: Number(s.revenue_ht),
          cogs: Number(s.cogs),
          grossMargin: Number(s.gross_margin),
          marginPct: Number(s.margin_pct),
          orders: Number(s.orders),
          productsWithoutCost: Number(s.products_without_cost),
        },
        byProduct: (p.by_product ?? []).map((r) => ({
          productId: r.product_id,
          productName: r.product_name,
          categoryName: r.category_name,
          qty: Number(r.qty),
          revenueHt: Number(r.revenue_ht),
          cogs: Number(r.cogs),
          margin: Number(r.margin),
          marginPct: Number(r.margin_pct),
        })),
        byCategory: (p.by_category ?? []).map((r) => ({
          categoryId: r.category_id,
          categoryName: r.category_name,
          qty: Number(r.qty),
          revenueHt: Number(r.revenue_ht),
          cogs: Number(r.cogs),
          margin: Number(r.margin),
          marginPct: Number(r.margin_pct),
        })),
      };
    },
    staleTime: 30_000,
  });
}
```

Also add `//   - usePOSReportsMargin        → get_pos_margin_v1` to the header comment list (line 15 area).

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @breakery/pos typecheck`
Expected: PASS (fails if Task 2's graft is missing)

- [ ] **Step 3: Commit**

```bash
git add apps/pos/src/features/reports/hooks/usePOSReports.ts
git commit -m "feat(pos-reports): usePOSReportsMargin hook (get_pos_margin_v1)"
```

---

### Task 4: Page `POSMarginReportPage` (TDD)

**Files:**
- Create: `apps/pos/src/features/reports/POSMarginReportPage.tsx`
- Test: `apps/pos/src/features/reports/__tests__/POSMarginReportPage.test.tsx`

**Interfaces:**
- Consumes: `usePOSReportsMargin` + types (Task 3), `POSReportsLayout` (`activeTab="margin"` exists only after Task 5 — use `"margin" as never` is FORBIDDEN; Task 5 must merge into the branch before typecheck of this file passes. Order Tasks 4 and 5 as written: the page file is written here, but the final typecheck runs in Task 5 after the layout accepts `'margin'`. The smoke test mocks the layout's dependencies, not the layout itself, so it runs green once Task 5 lands.)
- Produces: default export page component, route target for Task 5.

- [ ] **Step 1: Write the failing smoke test** — `apps/pos/src/features/reports/__tests__/POSMarginReportPage.test.tsx`:

```tsx
// Reports POS refonte — dernier lot — smoke for the Margin tab. Validates the
// financial-permission gate (ReportsForbidden), loading/error branches, the
// empty state, and the happy path: KPI cards, WAC caveat, no-cost badge,
// product + category rows, CSV button. Mocks usePOSReportsMargin + authStore.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import POSMarginReportPage from '../POSMarginReportPage';
import type { POSReportsMargin } from '../hooks/usePOSReports';

const state = {
  current: {
    data: undefined as POSReportsMargin | undefined,
    isLoading: false,
    isError: false,
  },
};

vi.mock('../hooks/usePOSReports', () => ({
  usePOSReportsMargin: () => state.current,
}));

const authState = { current: { canRead: true } };
vi.mock('@/stores/authStore', () => ({
  useAuthStore: <T,>(selector: (s: { hasPermission: (code: string) => boolean }) => T) =>
    selector({ hasPermission: () => authState.current.canRead }),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <POSMarginReportPage />
    </MemoryRouter>,
  );
}

function empty(): POSReportsMargin {
  return {
    timezone: 'Asia/Makassar',
    summary: {
      revenueTtc: 0, revenueHt: 0, cogs: 0, grossMargin: 0,
      marginPct: 0, orders: 0, productsWithoutCost: 0,
    },
    byProduct: [],
    byCategory: [],
  };
}

function populated(): POSReportsMargin {
  return {
    timezone: 'Asia/Makassar',
    summary: {
      revenueTtc: 8_250_000, revenueHt: 7_500_000, cogs: 3_000_000,
      grossMargin: 4_500_000, marginPct: 60, orders: 84, productsWithoutCost: 2,
    },
    byProduct: [
      { productId: 'p1', productName: 'Croissant', categoryName: 'Pastry',
        qty: 120, revenueHt: 3_000_000, cogs: 1_200_000, margin: 1_800_000, marginPct: 60 },
      { productId: 'p2', productName: 'Latte', categoryName: 'Coffee',
        qty: 90, revenueHt: 4_500_000, cogs: 1_800_000, margin: 2_700_000, marginPct: 60 },
    ],
    byCategory: [
      { categoryId: 'c1', categoryName: 'Coffee',
        qty: 90, revenueHt: 4_500_000, cogs: 1_800_000, margin: 2_700_000, marginPct: 60 },
      { categoryId: null, categoryName: '(uncategorized)',
        qty: 4, revenueHt: 100_000, cogs: 40_000, margin: 60_000, marginPct: 60 },
    ],
  };
}

describe('POSMarginReportPage', () => {
  beforeEach(() => {
    state.current = { data: undefined, isLoading: false, isError: false };
    authState.current = { canRead: true };
  });

  it('renders the ReportsForbidden splash when the user lacks reports.financial.read', () => {
    authState.current = { canRead: false };
    renderPage();
    expect(screen.getByText(/reports are restricted/i)).toBeInTheDocument();
  });

  it('renders the loading state while data is fetching', () => {
    state.current = { data: undefined, isLoading: true, isError: false };
    renderPage();
    expect(screen.getByText(/loading margin/i)).toBeInTheDocument();
  });

  it('renders the error state when the query fails', () => {
    state.current = { data: undefined, isLoading: false, isError: true };
    renderPage();
    expect(screen.getByText(/failed to load margin/i)).toBeInTheDocument();
  });

  it('renders the empty state and no badge when there are no lines', () => {
    state.current = { data: empty(), isLoading: false, isError: false };
    renderPage();
    expect(screen.getByText('No sales')).toBeInTheDocument();
    expect(screen.queryByTestId('pos-margin-nocost-badge')).not.toBeInTheDocument();
  });

  it('renders KPIs, caveat, no-cost badge, rows and CSV button on happy path', () => {
    state.current = { data: populated(), isLoading: false, isError: false };
    renderPage();
    // 4 KPI cards.
    expect(screen.getByTestId('pos-margin-kpi-revenue')).toBeInTheDocument();
    expect(screen.getByTestId('pos-margin-kpi-cogs')).toBeInTheDocument();
    expect(screen.getByTestId('pos-margin-kpi-margin')).toBeInTheDocument();
    const pct = screen.getByTestId('pos-margin-kpi-pct');
    expect(within(pct).getByText('60.0%')).toBeInTheDocument();
    // Permanent WAC caveat + no-cost badge (2 products).
    expect(screen.getByText(/current WAC/i)).toBeInTheDocument();
    const badge = screen.getByTestId('pos-margin-nocost-badge');
    expect(within(badge).getByText(/2 product/i)).toBeInTheDocument();
    // Product + category rows (incl. uncategorized bucket).
    expect(screen.getByTestId('margin-product-p1')).toBeInTheDocument();
    expect(screen.getByTestId('margin-product-p2')).toBeInTheDocument();
    expect(screen.getByTestId('margin-category-c1')).toBeInTheDocument();
    expect(screen.getByTestId('margin-category-uncat')).toBeInTheDocument();
    // CSV export present.
    expect(screen.getByTestId('pos-margin-export-csv')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `pnpm --filter @breakery/pos test POSMarginReportPage`
Expected: FAIL — cannot resolve `../POSMarginReportPage`

- [ ] **Step 3: Write the page** — `apps/pos/src/features/reports/POSMarginReportPage.tsx`:

```tsx
// Reports POS refonte — dernier lot — POS Reports / Margin tab.
//
// Marge brute sur le WAC COURANT (products.cost_price) — PAS un coût figé à la
// vente (snapshot COGS = Vague 3) : caveat permanent affiché. Périmètre ≡
// Overview (revenue_ttc réconcilie exactement) ; cadeaux-promo comptés en COGS
// avec revenue 0 ; badge d'alerte si des produits vendus n'ont pas de coût.
// Source serveur unique : get_pos_margin_v1, gaté reports.financial.read
// (PAS reports.sales.read — les coûts ne sont pas pour tout lecteur de ventes).

import { type JSX } from 'react';
import { TrendingUp, AlertTriangle } from 'lucide-react';
import { Currency, SectionLabel, EmptyState, Button, cn } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore';
import { POSReportsLayout } from './components/POSReportsLayout';
import {
  usePOSReportsMargin,
  type POSReportsMargin,
  type POSReportsMarginProductRow,
  type POSReportsMarginCategoryRow,
} from './hooks/usePOSReports';
import type { ReportsPeriod } from './hooks/useReportsPeriod';
import { ReportsForbidden } from './components/ReportsForbidden';

export default function POSMarginReportPage(): JSX.Element {
  const canRead = useAuthStore((s) => s.hasPermission('reports.financial.read'));
  if (!canRead) return <ReportsForbidden />;

  return (
    <POSReportsLayout activeTab="margin">
      {(period) => <MarginReport period={period} />}
    </POSReportsLayout>
  );
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function downloadCsv(period: ReportsPeriod, data: POSReportsMargin): void {
  const lines: string[] = ['section,label,qty,revenue_ht,cogs,margin,margin_pct'];
  for (const p of data.byProduct) {
    lines.push(
      `product,${csvEscape(p.productName)},${p.qty},${p.revenueHt},${p.cogs},${p.margin},${p.marginPct}`,
    );
  }
  for (const c of data.byCategory) {
    lines.push(
      `category,${csvEscape(c.categoryName)},${c.qty},${c.revenueHt},${c.cogs},${c.margin},${c.marginPct}`,
    );
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pos-margin_${period.startDate}_${period.endDate}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function MarginReport({ period }: { period: ReportsPeriod }): JSX.Element {
  const { data, isLoading, isError } = usePOSReportsMargin(period);

  if (isLoading) return <p className="text-text-secondary text-sm">Loading margin…</p>;
  if (isError || !data) return <p className="text-red text-sm">Failed to load margin.</p>;

  const s = data.summary;
  const hasLines = data.byProduct.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-text-muted">{data.timezone}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => downloadCsv(period, data)}
          data-testid="pos-margin-export-csv"
        >
          Export CSV
        </Button>
      </div>

      {/* ── Permanent WAC caveat (+ no-cost badge) ─────────────────────────── */}
      <div
        className="rounded-lg border border-border-subtle bg-bg-elevated px-4 py-3 text-xs text-text-secondary"
        data-testid="pos-margin-caveat"
      >
        COGS uses the <strong>current WAC</strong> (products.cost_price), not a cost
        frozen at sale time — historical margins shift when purchase costs change.
        {s.productsWithoutCost > 0 && (
          <span
            className="ml-2 inline-flex items-center gap-1 text-gold"
            data-testid="pos-margin-nocost-badge"
          >
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            {s.productsWithoutCost} product(s) without cost — margin overstated.
          </span>
        )}
      </div>

      {/* ── KPI cards ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard testId="pos-margin-kpi-revenue" label="Revenue (incl. tax)">
          <Currency amount={s.revenueTtc} emphasis="gold" />
        </KpiCard>
        <KpiCard testId="pos-margin-kpi-cogs" label="COGS (current WAC)">
          <Currency amount={s.cogs} />
        </KpiCard>
        <KpiCard testId="pos-margin-kpi-margin" label="Gross margin">
          <Currency amount={s.grossMargin} emphasis="gold" />
        </KpiCard>
        <KpiCard testId="pos-margin-kpi-pct" label="Margin %">
          <span className="text-lg font-semibold tabular-nums">{s.marginPct.toFixed(1)}%</span>
        </KpiCard>
      </div>

      {/* ── By product ─────────────────────────────────────────────────────── */}
      <section className="space-y-3" data-testid="pos-margin-products">
        <SectionLabel size="xs" as="h2">Margin by product</SectionLabel>
        {!hasLines ? (
          <EmptyState
            icon={TrendingUp}
            title="No sales"
            description="No product lines sold in this period."
          />
        ) : (
          <div className="rounded-lg border border-border-subtle overflow-hidden">
            <ul className="divide-y divide-border-subtle">
              {data.byProduct.map((p) => (
                <ProductRow key={p.productId} row={p} />
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* ── By category ────────────────────────────────────────────────────── */}
      {data.byCategory.length > 0 && (
        <section className="space-y-3" data-testid="pos-margin-categories">
          <SectionLabel size="xs" as="h2">Margin by category</SectionLabel>
          <div className="rounded-lg border border-border-subtle overflow-hidden">
            <ul className="divide-y divide-border-subtle">
              {data.byCategory.map((c) => (
                <CategoryRow key={c.categoryId ?? '__uncat__'} row={c} />
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}

function KpiCard({
  testId,
  label,
  children,
}: {
  testId: string;
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div
      className="rounded-lg border border-border-subtle bg-bg-elevated px-4 py-3"
      data-testid={testId}
    >
      <p className="text-xs text-text-muted">{label}</p>
      <p className="mt-1">{children}</p>
    </div>
  );
}

/** Product row: name · qty, HT revenue, COGS, margin + % with a share-style bar. */
function ProductRow({ row }: { row: POSReportsMarginProductRow }): JSX.Element {
  return (
    <li className="px-4 py-2.5" data-testid={`margin-product-${row.productId}`}>
      <MarginLine
        title={row.productName}
        subtitle={`${row.categoryName} · ${row.qty.toLocaleString()} sold`}
        revenueHt={row.revenueHt}
        cogs={row.cogs}
        margin={row.margin}
        marginPct={row.marginPct}
      />
    </li>
  );
}

function CategoryRow({ row }: { row: POSReportsMarginCategoryRow }): JSX.Element {
  return (
    <li
      className="px-4 py-2.5"
      data-testid={`margin-category-${row.categoryId ?? 'uncat'}`}
    >
      <MarginLine
        title={row.categoryName}
        subtitle={`${row.qty.toLocaleString()} sold`}
        revenueHt={row.revenueHt}
        cogs={row.cogs}
        margin={row.margin}
        marginPct={row.marginPct}
      />
    </li>
  );
}

function MarginLine({
  title,
  subtitle,
  revenueHt,
  cogs,
  margin,
  marginPct,
}: {
  title: string;
  subtitle: string;
  revenueHt: number;
  cogs: number;
  margin: number;
  marginPct: number;
}): JSX.Element {
  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-text-primary truncate">
          {title} <span className="text-text-muted">· {subtitle}</span>
        </span>
        <div className="flex items-baseline gap-3 shrink-0 text-xs text-text-muted tabular-nums">
          <span>HT <Currency amount={revenueHt} className="text-text-secondary" /></span>
          <span>COGS <Currency amount={cogs} className="text-text-secondary" /></span>
          <span className="w-12 text-right">{marginPct.toFixed(1)}%</span>
          <Currency amount={margin} className="text-sm font-semibold" />
        </div>
      </div>
      <div className={cn('mt-1.5 h-1.5 rounded-full bg-bg-overlay/60 overflow-hidden')}>
        <div
          className="h-full rounded-full bg-gold/70"
          style={{ width: `${Math.min(Math.max(marginPct, 0), 100)}%` }}
        />
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run the test — verify it passes** (the page compiles against the layout only after Task 5 widens `POSReportsTab`; the SMOKE test passes now because vitest doesn't typecheck across files — but run it after Task 5 too)

Run: `pnpm --filter @breakery/pos test POSMarginReportPage`
Expected: PASS 5/5

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/features/reports/POSMarginReportPage.tsx apps/pos/src/features/reports/__tests__/POSMarginReportPage.test.tsx
git commit -m "feat(pos-reports): Margin tab page — WAC caveat, no-cost badge, CSV"
```

---

### Task 5: Layout tab (permission-filtered) + route + layout smoke (TDD)

**Files:**
- Modify: `apps/pos/src/features/reports/components/POSReportsLayout.tsx` (type line 20, TABS lines 29-37, component body)
- Modify: `apps/pos/src/routes/index.tsx` (lazy import ~line 27, route ~line 75)
- Test: `apps/pos/src/features/reports/__tests__/POSReportsLayout.test.tsx` (create)

**Interfaces:**
- Consumes: `useAuthStore((s) => s.hasPermission)` (same store API the pages use).
- Produces: `POSReportsTab` union includes `'margin'`; tab visible only with `reports.financial.read`; route `/pos/reports/margin`.

- [ ] **Step 1: Write the failing layout smoke test** — `apps/pos/src/features/reports/__tests__/POSReportsLayout.test.tsx`:

```tsx
// Smoke for the permission-filtered tab strip: the Margin tab requires
// reports.financial.read; every other tab stays visible without it.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSReportsLayout } from '../components/POSReportsLayout';

const perms = { current: new Set<string>(['reports.financial.read']) };
vi.mock('@/stores/authStore', () => ({
  useAuthStore: <T,>(selector: (s: { hasPermission: (code: string) => boolean }) => T) =>
    selector({ hasPermission: (code: string) => perms.current.has(code) }),
}));

function renderLayout() {
  return render(
    <MemoryRouter>
      <POSReportsLayout activeTab="overview">{() => <div>content</div>}</POSReportsLayout>
    </MemoryRouter>,
  );
}

describe('POSReportsLayout', () => {
  beforeEach(() => {
    perms.current = new Set(['reports.financial.read']);
  });

  it('shows the Margin tab when the user holds reports.financial.read', () => {
    renderLayout();
    expect(screen.getByRole('button', { name: /margin/i })).toBeInTheDocument();
  });

  it('hides ONLY the Margin tab without reports.financial.read', () => {
    perms.current = new Set();
    renderLayout();
    expect(screen.queryByRole('button', { name: /margin/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /overview/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /products/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @breakery/pos test POSReportsLayout`
Expected: FAIL — no Margin tab rendered

- [ ] **Step 3: Modify `POSReportsLayout.tsx`.** Three edits:

(a) Widen the tab union (line 20):

```ts
type POSReportsTab = 'overview' | 'payments' | 'voids' | 'sessions' | 'mix' | 'products' | 'activity' | 'margin';
```

(b) Add `TrendingUp` to the lucide import (line 16) and extend TABS (after the `products` entry, before `activity` — margin sits next to Products) with an optional per-tab permission:

```ts
const TABS: { id: POSReportsTab; label: string; path: string; icon: LucideIcon; permission?: string }[] = [
  { id: 'overview', label: 'Overview', path: '/pos/reports', icon: BarChart3 },
  { id: 'payments', label: 'Payments', path: '/pos/reports/payments', icon: Wallet },
  { id: 'voids', label: 'Voids', path: '/pos/reports/voids', icon: Ban },
  { id: 'sessions', label: 'Sessions', path: '/pos/reports/sessions', icon: Layers },
  { id: 'mix', label: 'Mix', path: '/pos/reports/mix', icon: PieChart },
  { id: 'products', label: 'Products', path: '/pos/reports/products', icon: Package },
  { id: 'margin', label: 'Margin', path: '/pos/reports/margin', icon: TrendingUp, permission: 'reports.financial.read' },
  { id: 'activity', label: 'Activity', path: '/pos/reports/activity', icon: Activity },
];
```

(c) In the component, import `useAuthStore` (`import { useAuthStore } from '@/stores/authStore';`) and filter (replace `{TABS.map((t) => {` line 85):

```ts
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const visibleTabs = TABS.filter((t) => !t.permission || hasPermission(t.permission));
```

…and render `visibleTabs.map` instead of `TABS.map`.

- [ ] **Step 4: Register the route** in `apps/pos/src/routes/index.tsx`:

After line 26 (`POSProductsReportPage`):

```ts
const POSMarginReportPage = lazy(() => import('@/features/reports/POSMarginReportPage'));
```

After the `/pos/reports/products` route (line 74):

```tsx
      <Route path="/pos/reports/margin" element={<ProtectedLazy><POSMarginReportPage /></ProtectedLazy>} />
```

- [ ] **Step 5: Run layout + page tests — verify they pass**

Run: `pnpm --filter @breakery/pos test POSReportsLayout POSMarginReportPage`
Expected: PASS (2/2 + 5/5)

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @breakery/pos typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/pos/src/features/reports/components/POSReportsLayout.tsx apps/pos/src/routes/index.tsx apps/pos/src/features/reports/__tests__/POSReportsLayout.test.tsx
git commit -m "feat(pos-reports): Margin tab gated reports.financial.read + /pos/reports/margin route"
```

---

### Task 6: Full gates, pattern-guardian review, PR — **CONTROLLER**

**Files:** none new (verification + PR).

- [ ] **Step 1: Full reports suite + typecheck + build**

Run (CI-flakiness note D-5: prefer targeted files over the full POS suite):
```bash
pnpm --filter @breakery/pos test reports
pnpm typecheck
pnpm --filter @breakery/pos build
```
Expected: all reports test files green (42 existing + 7 new), typecheck 7/7 packages, build succeeds.

- [ ] **Step 2: pattern-guardian review** — dispatch the `pattern-guardian` agent on `git diff master...feat/pos-reports-margin`. Expected: 0 violations (read-only RPC, REVOKE trio present, no raw stock/order writes, no PIN, no realtime). Fix anything it flags before PR.

- [ ] **Step 3: Open the PR** (use `--body-file` — heredoc bodies leave junk 0-byte files at repo root on Windows):

```bash
git push -u origin feat/pos-reports-margin
gh pr create --title "feat(pos-reports): Margin tab — gross margin on current WAC (refonte Reports POS soldée)" --body-file <scratchpad>/pr-body.md
```

PR body must cover: RPC `_160` (gate financial.read, scope ≡ Overview, promo-gift COGS rule, products_without_cost), pgTAP 13/13 live, smoke 7 files green, types grafted, money-path untouched, spec link `docs/superpowers/specs/2026-07-12-s74-pos-margin-cogs-design.md`. End with the standard Claude Code footer.

- [ ] **Step 4 (post-merge closeout):** update CLAUDE.md Active Workplan — the **refonte Reports POS is soldée** (lots A→G + fix Overview #207 + Margin) ; add a « Mise à jour S74 » banner to `docs/workplan/remise-a-plat/14-reports-analytics.md` (B1.3 covered POS-side, WAC caveat) ; run the fin-de-session checklist (types committed, MCP prefix, relative links).

---

## Self-Review (done at authoring)

- **Spec coverage:** gate financial.read (T1 §1, Task 5 tab/permission) ✓ · scope ≡ Overview + reconciliation assertée (Task 1 SQL, pgTAP T7) ✓ · WAC caveat UI (Task 4 caveat div) ✓ · products_without_cost badge (Task 4) ✓ · promo-gift COGS rule (SQL CASE, pgTAP T11) ✓ · CSV (Task 4) ✓ · tab masqué + ReportsForbidden (Tasks 4-5) ✓ · types greffés (Task 2) ✓ · money-path untouched (no write anywhere) ✓ · closeout (Task 6) ✓.
- **Consistency:** hook camelCase fields = page usage; RPC snake_case keys = hook payload interface; `POSReportsTab` widened before route; test file names match vitest file filters.
- **Known deviation vs spec wording:** CSV uses the page-local builder (module mold, lots A→G) instead of the BO `buildCsv` domain helper mentioned in the spec — consistency with the POS reports module wins.
