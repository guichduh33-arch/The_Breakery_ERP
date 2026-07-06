-- supabase/tests/dashboard_overview.test.sql
-- S63 — get_dashboard_overview_v1 (dashboard d'accueil BO).
-- Run via MCP execute_sql (BEGIN..ROLLBACK envelope carried by this file).
-- DB dev non vide -> assertions KPI en DELTA vs baseline capturé avant seed.
BEGIN;

CREATE TEMP TABLE _r(name TEXT PRIMARY KEY, pass BOOLEAN) ON COMMIT DROP;

DO $$
DECLARE
  v_auth UUID; v_profile UUID; v_session UUID; v_cat UUID; v_prod UUID; v_cust UUID;
  v_o1 UUID; v_o2 UUID; v_o3 UUID; v_o4 UUID; v_o5 UUID;
  v_tz TEXT; v_today DATE; v_day2 DATE;
  v_before JSONB; v_after JSONB;
  v_cash_b NUMERIC; v_cash_a NUMERIC;
  v_type_b NUMERIC; v_type_a NUMERIC;
  v_hour_b NUMERIC; v_hour_a NUMERIC;
  v_d2_b NUMERIC; v_d2_a NUMERIC;
  v_rand UUID; v_denied BOOLEAN := false;
BEGIN
  -- Acteur : un user seedé qui a reports.read
  SELECT up.auth_user_id, up.id INTO v_auth, v_profile
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'reports.read')
   LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz FROM business_config WHERE id = 1;
  v_today := (now() AT TIME ZONE v_tz)::date;
  v_day2  := ((now() - interval '2 days') AT TIME ZONE v_tz)::date;

  -- ── Baseline avant seed ───────────────────────────────────────────────
  v_before := get_dashboard_overview_v1();
  v_cash_b := COALESCE((SELECT (e->>'amount')::numeric
                          FROM jsonb_array_elements(v_before->'payment_methods') e
                         WHERE e->>'method' = 'cash'), 0);
  v_type_b := COALESCE((SELECT (e->>'gross')::numeric
                          FROM jsonb_array_elements(v_before->'revenue_by_type') e
                         WHERE e->>'order_type' = 'take_out'), 0);
  v_hour_b := COALESCE((SELECT SUM((e->>'gross')::numeric)
                          FROM jsonb_array_elements(v_before->'hourly_sales') e), 0);
  v_d2_b   := COALESCE((SELECT (e->>'net')::numeric
                          FROM jsonb_array_elements(v_before->'revenue_30d') e
                         WHERE (e->>'date')::date = v_day2), 0);

  -- ── Seed ──────────────────────────────────────────────────────────────
  INSERT INTO pos_sessions (opened_by, opening_cash, status)
    VALUES (v_profile, 0, 'closed') RETURNING id INTO v_session;
  SELECT id INTO v_cat FROM categories WHERE deleted_at IS NULL LIMIT 1;
  INSERT INTO products (sku, name, category_id, retail_price, cost_price, unit, current_stock)
    VALUES ('TST-S63-DASH', 'S63 Dash Item', v_cat, 50000, 20000, 'pcs', 100)
    RETURNING id INTO v_prod;
  INSERT INTO customers (name, customer_type)
    VALUES ('S63 Dash Customer', 'retail') RETURNING id INTO v_cust;

  -- o1 : payée maintenant, 50 000, cash, client ; 1 ligne valide + 1 ligne ANNULÉE (exclue d'items_sold)
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total, created_via, session_id, customer_id, paid_at)
    VALUES ('#S63O1', 'take_out', 'paid', 50000, 0, 50000, 'pos', v_session, v_cust, now())
    RETURNING id INTO v_o1;
  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total)
    VALUES (v_o1, v_prod, 'S63 Dash Item', 50000, 1, 50000);
  -- CHECK chk_order_items_cancel_consistency : is_cancelled=true exige cancelled_at/reason(>=3)/by
  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total,
                           is_cancelled, cancelled_at, cancelled_reason, cancelled_by)
    VALUES (v_o1, v_prod, 'S63 Dash Item', 50000, 5, 250000, true, now(), 'S63 test cancel', v_profile);
  INSERT INTO order_payments (order_id, method, amount) VALUES (v_o1, 'cash', 50000);

  -- o2 : payée AUJOURD'HUI 01:00 HEURE LOCALE (bord UTC : en Asia/Makassar c'est la veille 17:00 UTC), 30 000, qris
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total, created_via, session_id, customer_id, paid_at)
    VALUES ('#S63O2', 'take_out', 'paid', 30000, 0, 30000, 'pos', v_session, v_cust,
            ((v_today + time '01:00') AT TIME ZONE v_tz))
    RETURNING id INTO v_o2;
  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total)
    VALUES (v_o2, v_prod, 'S63 Dash Item', 30000, 1, 30000);
  INSERT INTO order_payments (order_id, method, amount) VALUES (v_o2, 'qris', 30000);

  -- o3 : VOIDED aujourd'hui, 99 000 -> exclue de tout
  -- CHECK chk_orders_void_consistency : status='voided' exige voided_at/voided_by/void_reason(>=3)
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total, created_via, session_id, paid_at,
                      voided_at, voided_by, void_reason)
    VALUES ('#S63O3', 'take_out', 'voided', 99000, 0, 99000, 'pos', v_session, now(),
            now(), v_profile, 'S63 test void')
    RETURNING id INTO v_o3;

  -- o4 : b2b_pending, 88 000, pas de paid_at -> exclue de tout
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total, created_via)
    VALUES ('#S63O4', 'b2b', 'b2b_pending', 88000, 0, 88000, 'pos')
    RETURNING id INTO v_o4;

  -- o5 : payée il y a 2 jours, 40 000 -> visible dans revenue_30d[day-2], pas dans les KPIs du jour
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total, created_via, session_id, paid_at)
    VALUES ('#S63O5', 'take_out', 'paid', 40000, 0, 40000, 'pos', v_session, now() - interval '2 days')
    RETURNING id INTO v_o5;

  -- refund : 10 000 sur o1 aujourd'hui -> revenue_today est NET
  -- tax_refunded > 0 requis : le trigger fn_create_je_for_refund crée une ligne JE PB1
  -- et journal_entry_lines_check interdit une ligne 0/0.
  INSERT INTO refunds (order_id, refund_number, reason, total, tax_refunded, refunded_by, authorized_by, session_id)
    VALUES (v_o1, 'RF-S63-1', 'S63 test refund', 10000, 1000, v_profile, v_profile, v_session);

  -- ── Après seed ────────────────────────────────────────────────────────
  v_after := get_dashboard_overview_v1();
  v_cash_a := COALESCE((SELECT (e->>'amount')::numeric
                          FROM jsonb_array_elements(v_after->'payment_methods') e
                         WHERE e->>'method' = 'cash'), 0);
  v_type_a := COALESCE((SELECT (e->>'gross')::numeric
                          FROM jsonb_array_elements(v_after->'revenue_by_type') e
                         WHERE e->>'order_type' = 'take_out'), 0);
  v_hour_a := COALESCE((SELECT SUM((e->>'gross')::numeric)
                          FROM jsonb_array_elements(v_after->'hourly_sales') e), 0);
  v_d2_a   := COALESCE((SELECT (e->>'net')::numeric
                          FROM jsonb_array_elements(v_after->'revenue_30d') e
                         WHERE (e->>'date')::date = v_day2), 0);

  -- ── Assertions (delta) ────────────────────────────────────────────────
  -- T1 : net du jour = +50k +30k (o2 compte AUJOURD'HUI malgré le bord UTC) -10k refund ;
  --      o3 voided (99k) et o4 b2b_pending (88k) invisibles.
  INSERT INTO _r SELECT 'T01_revenue_today_net_delta_70k',
    (v_after->'kpis'->>'revenue_today')::numeric - (v_before->'kpis'->>'revenue_today')::numeric = 70000;
  INSERT INTO _r SELECT 'T02_orders_today_delta_2',
    (v_after->'kpis'->>'orders_today')::int - (v_before->'kpis'->>'orders_today')::int = 2;
  INSERT INTO _r SELECT 'T03_items_sold_delta_2_cancelled_excluded',
    (v_after->'kpis'->>'items_sold')::numeric - (v_before->'kpis'->>'items_sold')::numeric = 2;
  INSERT INTO _r SELECT 'T04_customers_today_delta_1',
    (v_after->'kpis'->>'customers_today')::int - (v_before->'kpis'->>'customers_today')::int = 1;
  -- T5 : avg_basket = recalcul indépendant brut/commandes sur la table orders
  INSERT INTO _r SELECT 'T05_avg_basket_matches_orders_table',
    (v_after->'kpis'->>'avg_basket')::numeric = (
      SELECT ROUND(SUM(o.total) / COUNT(*), 2) FROM orders o
       WHERE o.status IN ('paid','completed') AND o.voided_at IS NULL AND o.paid_at IS NOT NULL
         AND ((o.paid_at AT TIME ZONE v_tz))::date = v_today);
  -- T6/T7 : série 30 j continue, bornée à aujourd'hui
  INSERT INTO _r SELECT 'T06_revenue_30d_has_30_points',
    jsonb_array_length(v_after->'revenue_30d') = 30;
  INSERT INTO _r SELECT 'T07_last_point_is_today',
    (v_after->'revenue_30d'->29->>'date')::date = v_today;
  INSERT INTO _r SELECT 'T08_day_minus_2_net_delta_40k', v_d2_a - v_d2_b = 40000;
  INSERT INTO _r SELECT 'T09_by_type_take_out_gross_delta_80k', v_type_a - v_type_b = 80000;
  INSERT INTO _r SELECT 'T10_top_products_contains_seeded',
    EXISTS (SELECT 1 FROM jsonb_array_elements(v_after->'top_products') e
             WHERE (e->>'product_id')::uuid = v_prod
               AND e->>'name' = 'S63 Dash Item'
               AND (e->>'qty')::numeric >= 2);
  INSERT INTO _r SELECT 'T11_hourly_gross_delta_80k', v_hour_a - v_hour_b = 80000;
  INSERT INTO _r SELECT 'T12_payment_cash_delta_50k', v_cash_a - v_cash_b = 50000;

  -- T13 : sans reports.read -> 42501
  v_rand := gen_random_uuid();
  PERFORM set_config('request.jwt.claim.sub', v_rand::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rand)::text, true);
  BEGIN
    PERFORM get_dashboard_overview_v1();
    v_denied := false;
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  INSERT INTO _r SELECT 'T13_permission_denied_42501', v_denied;

  -- T14 : anon n'a pas EXECUTE (trio S20)
  INSERT INTO _r SELECT 'T14_anon_execute_revoked',
    NOT has_function_privilege('anon', 'public.get_dashboard_overview_v1()', 'EXECUTE');
END $$;

SELECT name, pass FROM _r ORDER BY name;
-- Attendu : 14 lignes, pass = true partout.
ROLLBACK;
