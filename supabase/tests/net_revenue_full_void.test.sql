-- supabase/tests/net_revenue_full_void.test.sql
-- S64 T4 — fix I-1 : les refunds is_full_void (voids même-jour) ne sont plus
-- soustraits du net (la commande voidée sort déjà du brut — lineage 20260704000018).
-- Pin sur get_dashboard_overview_v1 (revenue_today + revenue_30d) ET get_daily_sales_v1.
-- Run via MCP execute_sql (BEGIN..ROLLBACK envelope carried by this file).
-- DB dev non vide -> assertions en DELTA vs baseline. Seed miroir de
-- dashboard_overview.test.sql (chk_orders_void_consistency / fn_create_je_for_refund
-- déjà résolus là — DEV-S63-02).
BEGIN;

CREATE TEMP TABLE _r(name TEXT PRIMARY KEY, pass BOOLEAN) ON COMMIT DROP;

DO $$
DECLARE
  v_auth UUID; v_profile UUID; v_session UUID; v_cat UUID; v_prod UUID;
  v_o1 UUID; v_o2 UUID;
  v_tz TEXT; v_today DATE;
  v_dash_b JSONB; v_daily_b JSONB;   -- baseline
  v_dash_1 JSONB; v_daily_1 JSONB;   -- après o1 payée
  v_dash_2 JSONB; v_daily_2 JSONB;   -- après void même-jour de o1
  v_dash_3 JSONB; v_daily_3 JSONB;   -- après o2 + refund partiel
  v_rev30_today_b NUMERIC; v_rev30_today_3 NUMERIC;
BEGIN
  -- Acteur : un user seedé qui a reports.read ET reports.sales.read
  SELECT up.auth_user_id, up.id INTO v_auth, v_profile
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'reports.read')
     AND has_permission(up.auth_user_id, 'reports.sales.read')
   LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz FROM business_config WHERE id = 1;
  v_today := (now() AT TIME ZONE v_tz)::date;

  -- ── Baseline ──────────────────────────────────────────────────────────
  v_dash_b  := get_dashboard_overview_v1();
  v_daily_b := get_daily_sales_v1(v_today::text, v_today::text);
  v_rev30_today_b := COALESCE((SELECT (e->>'net')::numeric
                                 FROM jsonb_array_elements(v_dash_b->'revenue_30d') e
                                WHERE (e->>'date')::date = v_today), 0);

  -- ── Seed commun ───────────────────────────────────────────────────────
  INSERT INTO pos_sessions (opened_by, opening_cash, status)
    VALUES (v_profile, 0, 'closed') RETURNING id INTO v_session;
  SELECT id INTO v_cat FROM categories WHERE deleted_at IS NULL LIMIT 1;
  INSERT INTO products (sku, name, category_id, retail_price, cost_price, unit, current_stock)
    VALUES ('TST-S64-NETVOID', 'S64 NetVoid Item', v_cat, 60000, 20000, 'pcs', 100)
    RETURNING id INTO v_prod;

  -- ── Étape 1 : o1 payée aujourd'hui, 60 000 ────────────────────────────
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total, created_via, session_id, paid_at)
    VALUES ('#S64NV1', 'take_out', 'paid', 60000, 0, 60000, 'pos', v_session, now())
    RETURNING id INTO v_o1;
  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total)
    VALUES (v_o1, v_prod, 'S64 NetVoid Item', 60000, 1, 60000);

  v_dash_1  := get_dashboard_overview_v1();
  v_daily_1 := get_daily_sales_v1(v_today::text, v_today::text);

  INSERT INTO _r SELECT 'T01_dash_revenue_today_delta_plus_60k',
    (v_dash_1->'kpis'->>'revenue_today')::numeric - (v_dash_b->'kpis'->>'revenue_today')::numeric = 60000;
  INSERT INTO _r SELECT 'T02_daily_net_delta_plus_60k',
    (v_daily_1->'summary'->>'net')::numeric - (v_daily_b->'summary'->>'net')::numeric = 60000;

  -- ── Étape 2 : void MÊME-JOUR de o1 ────────────────────────────────────
  -- Miroir void_order_rpc_v4 : status='voided' (+ colonnes de consistance)
  -- ET refund is_full_void=true du montant total.
  -- AVANT le fix _116 : le refund était soustrait alors que la commande
  -- sortait déjà du brut -> delta net = -60 000 (double pénalité).
  -- APRÈS : delta net redevient 0 sur les DEUX RPCs.
  UPDATE orders
     SET status = 'voided', voided_at = now(), voided_by = v_profile,
         void_reason = 'S64 test full void'
   WHERE id = v_o1;
  -- tax_refunded > 0 requis : fn_create_je_for_refund + journal_entry_lines_check
  INSERT INTO refunds (order_id, refund_number, reason, total, tax_refunded,
                       refunded_by, authorized_by, session_id, is_full_void)
    VALUES (v_o1, 'RF-S64NV-1', 'S64 test full void', 60000, 1000,
            v_profile, v_profile, v_session, true);

  v_dash_2  := get_dashboard_overview_v1();
  v_daily_2 := get_daily_sales_v1(v_today::text, v_today::text);

  INSERT INTO _r SELECT 'T03_dash_full_void_net_delta_zero',
    (v_dash_2->'kpis'->>'revenue_today')::numeric - (v_dash_b->'kpis'->>'revenue_today')::numeric = 0;
  INSERT INTO _r SELECT 'T04_daily_full_void_net_delta_zero',
    (v_daily_2->'summary'->>'net')::numeric - (v_daily_b->'summary'->>'net')::numeric = 0;
  -- Non-régression S63 : la commande voidée reste hors brut / hors compte
  INSERT INTO _r SELECT 'T05_daily_gross_delta_zero_after_void',
    (v_daily_2->'summary'->>'total')::numeric - (v_daily_b->'summary'->>'total')::numeric = 0;
  INSERT INTO _r SELECT 'T06_daily_order_count_delta_zero_after_void',
    (v_daily_2->'summary'->>'order_count')::int - (v_daily_b->'summary'->>'order_count')::int = 0;
  -- Le refund full-void ne gonfle pas refund_total
  INSERT INTO _r SELECT 'T07_daily_refund_total_delta_zero_after_void',
    (v_daily_2->'summary'->>'refund_total')::numeric - (v_daily_b->'summary'->>'refund_total')::numeric = 0;

  -- ── Étape 3 : o2 payée 45 000 + refund PARTIEL 5 000 ──────────────────
  -- Le partiel (is_full_void=false, défaut) reste soustrait : delta net = +40 000.
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total, created_via, session_id, paid_at)
    VALUES ('#S64NV2', 'take_out', 'paid', 45000, 0, 45000, 'pos', v_session, now())
    RETURNING id INTO v_o2;
  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total)
    VALUES (v_o2, v_prod, 'S64 NetVoid Item', 45000, 1, 45000);
  INSERT INTO refunds (order_id, refund_number, reason, total, tax_refunded,
                       refunded_by, authorized_by, session_id)
    VALUES (v_o2, 'RF-S64NV-2', 'S64 test partial refund', 5000, 500,
            v_profile, v_profile, v_session);

  v_dash_3  := get_dashboard_overview_v1();
  v_daily_3 := get_daily_sales_v1(v_today::text, v_today::text);
  v_rev30_today_3 := COALESCE((SELECT (e->>'net')::numeric
                                 FROM jsonb_array_elements(v_dash_3->'revenue_30d') e
                                WHERE (e->>'date')::date = v_today), 0);

  INSERT INTO _r SELECT 'T08_dash_partial_refund_net_delta_40k',
    (v_dash_3->'kpis'->>'revenue_today')::numeric - (v_dash_b->'kpis'->>'revenue_today')::numeric = 40000;
  INSERT INTO _r SELECT 'T09_daily_partial_refund_net_delta_40k',
    (v_daily_3->'summary'->>'net')::numeric - (v_daily_b->'summary'->>'net')::numeric = 40000;
  INSERT INTO _r SELECT 'T10_daily_refund_total_delta_5k_partial_only',
    (v_daily_3->'summary'->>'refund_total')::numeric - (v_daily_b->'summary'->>'refund_total')::numeric = 5000;
  -- 2e occurrence dashboard (CTE day_refunds de revenue_30d) : point du jour = +40 000
  INSERT INTO _r SELECT 'T11_dash_rev30_today_net_delta_40k',
    v_rev30_today_3 - v_rev30_today_b = 40000;
END $$;

SELECT name, pass FROM _r ORDER BY name;
-- Attendu : 11 lignes, pass = true partout.
ROLLBACK;
