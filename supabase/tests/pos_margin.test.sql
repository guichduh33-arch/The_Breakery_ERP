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