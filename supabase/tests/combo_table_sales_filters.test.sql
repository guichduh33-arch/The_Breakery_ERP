-- supabase/tests/combo_table_sales_filters.test.sql
-- S3-22, étape 2, troisième lot — pgTAP des filtres de commande des familles
-- get_combo_sales (trois filtres) et get_sales_by_table (moyen de paiement
-- seul), argument `p_filters`.
--
-- CE QUE CETTE SUITE PROTÈGE : un filtre RESTREINT vraiment, sur la période
-- ET sur la fenêtre précédente, et sans filtre le résultat ne bouge pas.
-- La période lue est AUJOURD'HUI seul : la fenêtre précédente est HIER.
--
-- Combos — un produit combo créé ici, composant K1 ×1 :
--   A  take_out  table PGTAP-CA  combo ×1   90 000             cash  aujourd'hui
--   B  dine_in   table PGTAP-CB  combo ×2  170 000 + 10 000    qris  aujourd'hui
--   C  dine_in   table PGTAP-CB  sans combo  40 000             cash  aujourd'hui
--   E  dine_in   table PGTAP-CB  combo ×1   45 000             cash  hier
-- On mesure AVANT puis APRÈS l'insertion (d'autres ventes peuvent exister) ;
-- sous le filtre de table, seules ces commandes existent : valeurs exactes.
--
-- Tables — une table créée ici, PGTAP-SBT-A, 4 places, commandes sur place :
--   X  60 000  cash  aujourd'hui
--   Y  30 000  qris  aujourd'hui
--   Z  20 000  cash  hier
--
--   T1 : combo — filtres vides, nuls ou inconnus == aucun filtre
--   T2 : combo — type de commande, période ET fenêtre précédente
--   T3 : combo — moyen de paiement, chiffre brut compris
--   T4 : combo — table, valeurs exactes (tickets avec et sans combo, picks)
--   T5 : table — filtres vides, nuls ou inconnus == aucun filtre ; les
--        clés order_type et table_number sont ignorées
--   T6 : table — moyen de paiement, période ET fenêtre précédente
--   T7 : table — tables et places actives ne suivent pas le filtre
--   T8 : droits (authenticated oui, anon non) et anciennes versions supprimées
--   T9 : sans reports.sales.read → 42501, sur les deux fonctions
--
-- Utilisateurs seedés réutilisés :
--   Owner   : auth_user_id = 00000000-0000-0000-0000-000000000001
--   CASHIER : auth_user_id = 00000000-0000-0000-0000-000000000002
--
-- Lancé via mcp execute_sql enveloppé dans BEGIN/ROLLBACK — auto-nettoyant.

BEGIN;
\ir helpers/released_report_days.sql
SELECT pg_temp.fixture_released_days(current_date-366,current_date);
\ir helpers/sales.sql

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(9);

-- Sonde combo : les chiffres de summary utiles au test.
CREATE FUNCTION pg_temp.combo_probe(p_f jsonb) RETURNS jsonb
LANGUAGE sql AS $probe$
  SELECT jsonb_build_object(
    'rev',   (s->>'combo_revenue')::numeric,
    'qty',   (s->>'combo_qty')::numeric,
    'n',     (s->>'combo_orders')::numeric,
    'prev',  (s->>'combo_revenue_prev')::numeric,
    'gross', (s->>'gross_sales')::numeric)
  FROM (SELECT get_combo_sales_v5(CURRENT_DATE, CURRENT_DATE, p_f)->'summary' AS s) x
$probe$;
-- Vrai si, entre deux sondes combo, chaque chiffre a bougé de la valeur donnée.
CREATE FUNCTION pg_temp.combo_moved(p_b jsonb, p_a jsonb, p_rev numeric, p_qty numeric,
                                    p_n numeric, p_prev numeric, p_gross numeric)
RETURNS boolean LANGUAGE sql AS $moved$
  SELECT (p_a->>'rev')::numeric   - (p_b->>'rev')::numeric   = p_rev
     AND (p_a->>'qty')::numeric   - (p_b->>'qty')::numeric   = p_qty
     AND (p_a->>'n')::numeric     - (p_b->>'n')::numeric     = p_n
     AND (p_a->>'prev')::numeric  - (p_b->>'prev')::numeric  = p_prev
     AND (p_a->>'gross')::numeric - (p_b->>'gross')::numeric = p_gross
$moved$;
-- Sonde table : la ligne PGTAP-SBT-A (orders, revenue, revenue_prev) ; NULL si absente.
CREATE FUNCTION pg_temp.table_probe(p_f jsonb) RETURNS jsonb
LANGUAGE sql AS $probe$
  SELECT (SELECT jsonb_build_object(
            'orders',  (e->>'orders')::numeric,
            'revenue', (e->>'revenue')::numeric,
            'prev',    (e->>'revenue_prev')::numeric)
          FROM jsonb_array_elements(
            get_sales_by_table_v4(CURRENT_DATE, CURRENT_DATE, p_f)->'by_table') e
          WHERE e->>'table_number' = 'PGTAP-SBT-A')
$probe$;

DO $$
DECLARE
  v_pid   uuid := 'f5430000-0000-4000-a000-000000000003';
  v_sid   uuid := 'f5430000-0000-4000-a000-000000000001';
  v_combo uuid := gen_random_uuid();
  v_cat   uuid := (SELECT id FROM categories WHERE deleted_at IS NULL LIMIT 1);
  v_comp  jsonb;
  v_a uuid; v_b uuid; v_c uuid; v_e uuid; v_x uuid; v_y uuid; v_z uuid;
  c0 JSONB; c_to0 JSONB; c_di0 JSONB; c_cash0 JSONB; c_qris0 JSONB;
  c1 JSONB; c_to1 JSONB; c_di1 JSONB; c_cash1 JSONB; c_qris1 JSONB;
  v_cb JSONB; v_full JSONB; v_tfull JSONB; v_tsum_all JSONB; v_tsum_cash JSONB;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';
  PERFORM pg_temp.fixture_released_days(current_date-366,current_date);

  c0      := pg_temp.combo_probe('{}');
  c_to0   := pg_temp.combo_probe('{"order_type":"take_out"}');
  c_di0   := pg_temp.combo_probe('{"order_type":"dine_in"}');
  c_cash0 := pg_temp.combo_probe('{"payment_method":"cash"}');
  c_qris0 := pg_temp.combo_probe('{"payment_method":"qris"}');

  INSERT INTO products (id, sku, name, category_id, retail_price, product_type)
  VALUES (v_combo, 'PGTAP-CTF-C1', 'PGTAP Filter Combo', v_cat, 90000, 'combo');
  v_comp := jsonb_build_array(jsonb_build_object('product_id', v_pid, 'quantity', 1));

  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total,
                      created_at, paid_at, table_number, session_id)
  VALUES ('#PGTAP-CTF-A', 'take_out', 'paid', 90000, 0, 90000,
          now() - interval '30 minutes', now(), 'PGTAP-CA', v_sid)
  RETURNING id INTO v_a;
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total,
                      created_at, paid_at, table_number, session_id)
  VALUES ('#PGTAP-CTF-B', 'dine_in', 'paid', 180000, 0, 180000,
          now() - interval '30 minutes', now(), 'PGTAP-CB', v_sid)
  RETURNING id INTO v_b;
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total,
                      created_at, paid_at, table_number, session_id)
  VALUES ('#PGTAP-CTF-C', 'dine_in', 'paid', 40000, 0, 40000,
          now() - interval '30 minutes', now(), 'PGTAP-CB', v_sid)
  RETURNING id INTO v_c;
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total,
                      created_at, paid_at, table_number, session_id)
  VALUES ('#PGTAP-CTF-E', 'dine_in', 'paid', 45000, 0, 45000,
          now() - interval '1 day', now() - interval '1 day', 'PGTAP-CB', v_sid)
  RETURNING id INTO v_e;
  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity,
                           line_total, combo_components)
  VALUES (v_a, v_combo, 'PGTAP Filter Combo', 90000, 1,  90000, v_comp),
         (v_b, v_combo, 'PGTAP Filter Combo', 85000, 2, 170000, v_comp),
         (v_b, v_pid,   'Filter B side',      10000, 1,  10000, NULL),
         (v_c, v_pid,   'Filter C',           40000, 1,  40000, NULL),
         (v_e, v_combo, 'PGTAP Filter Combo', 45000, 1,  45000, v_comp);
  INSERT INTO order_payments (order_id, method, amount, session_id)
  VALUES (v_a, 'cash',  90000, v_sid),
         (v_b, 'qris', 180000, v_sid),
         (v_c, 'cash',  40000, v_sid),
         (v_e, 'cash',  45000, v_sid);

  INSERT INTO restaurant_tables (name, seats, is_active) VALUES ('PGTAP-SBT-A', 4, true);
  v_tsum_all := get_sales_by_table_v4(CURRENT_DATE, CURRENT_DATE)->'summary';
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total,
                      created_at, paid_at, table_number, session_id)
  VALUES ('#PGTAP-CTF-X', 'dine_in', 'paid', 60000, 0, 60000,
          now() - interval '30 minutes', now(), 'PGTAP-SBT-A', v_sid)
  RETURNING id INTO v_x;
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total,
                      created_at, paid_at, table_number, session_id)
  VALUES ('#PGTAP-CTF-Y', 'dine_in', 'paid', 30000, 0, 30000,
          now() - interval '30 minutes', now(), 'PGTAP-SBT-A', v_sid)
  RETURNING id INTO v_y;
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total,
                      created_at, paid_at, table_number, session_id)
  VALUES ('#PGTAP-CTF-Z', 'dine_in', 'paid', 20000, 0, 20000,
          now() - interval '1 day', now() - interval '1 day', 'PGTAP-SBT-A', v_sid)
  RETURNING id INTO v_z;
  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total)
  VALUES (v_x, v_pid, 'Filter X', 60000, 1, 60000),
         (v_y, v_pid, 'Filter Y', 30000, 1, 30000),
         (v_z, v_pid, 'Filter Z', 20000, 1, 20000);
  INSERT INTO order_payments (order_id, method, amount, session_id)
  VALUES (v_x, 'cash', 60000, v_sid),
         (v_y, 'qris', 30000, v_sid),
         (v_z, 'cash', 20000, v_sid);
  PERFORM pg_temp.fixture_released_days(current_date-366,current_date);

  -- Les tables X/Y/Z n'ont pas de combo mais entrent dans le chiffre brut :
  -- elles sont posées après les sondes « avant » et comptées dans les deltas.
  c1      := pg_temp.combo_probe('{}');
  c_to1   := pg_temp.combo_probe('{"order_type":"take_out"}');
  c_di1   := pg_temp.combo_probe('{"order_type":"dine_in"}');
  c_cash1 := pg_temp.combo_probe('{"payment_method":"cash"}');
  c_qris1 := pg_temp.combo_probe('{"payment_method":"qris"}');

  -- T1 : sans filtre A et B entrent, E en fenêtre précédente ; brut = A+B+C+X+Y.
  v_full := get_combo_sales_v5(CURRENT_DATE, CURRENT_DATE) - 'generated_at';
  PERFORM set_config('breakery.t1', COALESCE(
        pg_temp.combo_moved(c0, c1, 260000, 3, 2, 45000, 400000)
    AND pg_temp.combo_probe(NULL) = c1
    AND pg_temp.combo_probe('{"order_type":null,"payment_method":"","table_number":""}') = c1
    AND pg_temp.combo_probe('{"unknown_key":"x"}') = c1
    AND (get_combo_sales_v5(CURRENT_DATE, CURRENT_DATE, '{}') - 'generated_at') = v_full,
    false)::text, false);

  -- T2 : type — période ET fenêtre précédente suivent le filtre.
  PERFORM set_config('breakery.t2', COALESCE(
        pg_temp.combo_moved(c_to0, c_to1,  90000, 1, 1,     0,  90000)
    AND pg_temp.combo_moved(c_di0, c_di1, 170000, 2, 1, 45000, 310000), false)::text, false);

  -- T3 : moyen de paiement ; le chiffre brut suit aussi (A+C+X en cash).
  PERFORM set_config('breakery.t3', COALESCE(
        pg_temp.combo_moved(c_cash0, c_cash1,  90000, 1, 1, 45000, 190000)
    AND pg_temp.combo_moved(c_qris0, c_qris1, 170000, 2, 1,     0, 210000), false)::text, false);

  -- T4 : table PGTAP-CB, seules B, C et E : valeurs exactes, tickets compris.
  v_cb := get_combo_sales_v5(CURRENT_DATE, CURRENT_DATE, '{"table_number":"PGTAP-CB"}');
  PERFORM set_config('breakery.t4', COALESCE(
        (v_cb->'summary'->>'combo_revenue')::numeric      = 170000
    AND (v_cb->'summary'->>'combo_qty')::numeric          = 2
    AND (v_cb->'summary'->>'combo_orders')::numeric       = 1
    AND (v_cb->'summary'->>'combo_revenue_prev')::numeric = 45000
    AND (v_cb->'summary'->>'gross_sales')::numeric        = 220000
    AND (v_cb->'summary'->>'avg_ticket_with')::numeric    = 180000
    AND (v_cb->'summary'->>'avg_ticket_without')::numeric = 40000
    AND jsonb_array_length(v_cb->'component_picks') = 1
    AND (v_cb->'component_picks'->0->>'qty')::numeric     = 2
    AND (get_combo_sales_v5(CURRENT_DATE, CURRENT_DATE, '{"table_number":"PGTAP-C"}')
           ->'summary'->>'combo_revenue')::numeric = 0,
    false)::text, false);

  -- T5 : table — sans filtre X et Y, Z en fenêtre précédente ; les clés que
  -- la fonction ne lit pas sont ignorées.
  v_tfull := get_sales_by_table_v4(CURRENT_DATE, CURRENT_DATE) - 'generated_at';
  PERFORM set_config('breakery.t5', COALESCE(
        pg_temp.table_probe('{}') = jsonb_build_object('orders', 2, 'revenue', 90000, 'prev', 20000)
    AND pg_temp.table_probe(NULL) = pg_temp.table_probe('{}')
    AND pg_temp.table_probe('{"payment_method":""}') = pg_temp.table_probe('{}')
    AND (get_sales_by_table_v4(CURRENT_DATE, CURRENT_DATE,
           '{"order_type":"take_out","table_number":"nope","unknown_key":"x"}') - 'generated_at') = v_tfull
    AND (get_sales_by_table_v4(CURRENT_DATE, CURRENT_DATE, '{}') - 'generated_at') = v_tfull,
    false)::text, false);

  -- T6 : moyen de paiement — période ET fenêtre précédente.
  PERFORM set_config('breakery.t6', COALESCE(
        pg_temp.table_probe('{"payment_method":"cash"}')
          = jsonb_build_object('orders', 1, 'revenue', 60000, 'prev', 20000)
    AND pg_temp.table_probe('{"payment_method":"qris"}')
          = jsonb_build_object('orders', 1, 'revenue', 30000, 'prev', 0)
    AND pg_temp.table_probe('{"payment_method":"pgtap_no_such_method"}') IS NULL,
    false)::text, false);

  -- T7 : le dénominateur (tables et places actives) ne dépend pas du filtre.
  v_tsum_cash := get_sales_by_table_v4(CURRENT_DATE, CURRENT_DATE, '{"payment_method":"qris"}')->'summary';
  PERFORM set_config('breakery.t7', COALESCE(
        (v_tsum_cash->>'active_tables') = (v_tsum_all->>'active_tables')
    AND (v_tsum_cash->>'active_seats')  = (v_tsum_all->>'active_seats'),
    false)::text, false);
END $$;

SELECT ok(current_setting('breakery.t1')::boolean,
  'T1: combo — empty, null or unknown filters equal no filter');
SELECT ok(current_setting('breakery.t2')::boolean,
  'T2: combo — order_type filter restricts the period and the previous window');
SELECT ok(current_setting('breakery.t3')::boolean,
  'T3: combo — payment_method filter restricts combo and gross figures');
SELECT ok(current_setting('breakery.t4')::boolean,
  'T4: combo — table_number filter is a strict equality, tickets and picks included');
SELECT ok(current_setting('breakery.t5')::boolean,
  'T5: table — empty, null or unread keys equal no filter');
SELECT ok(current_setting('breakery.t6')::boolean,
  'T6: table — payment_method filter restricts the period and the previous window');
SELECT ok(current_setting('breakery.t7')::boolean,
  'T7: table — active tables and seats do not follow the filter');

-- T8 droits et ménage des versions remplacées.
SELECT ok(
  has_function_privilege('authenticated','public.get_combo_sales_v5(date,date,jsonb)','EXECUTE')
  AND has_function_privilege('authenticated','public.get_sales_by_table_v4(date,date,jsonb)','EXECUTE')
  AND NOT has_function_privilege('anon','public.get_combo_sales_v5(date,date,jsonb)','EXECUTE')
  AND NOT has_function_privilege('anon','public.get_sales_by_table_v4(date,date,jsonb)','EXECUTE')
  AND to_regprocedure('public.get_combo_sales_v4(date,date)') IS NULL
  AND to_regprocedure('public.get_sales_by_table_v3(date,date)') IS NULL,
  'T8: authenticated may execute, anon may not, replaced versions are dropped');

-- T9 garde : sans reports.sales.read → 42501 sur les deux fonctions.
INSERT INTO public.user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
SELECT id,'reports.sales.read',false,'Transactional report deny fixture' FROM public.user_profiles
WHERE employee_code='EMP001' AND deleted_at IS NULL
ON CONFLICT(user_profile_id,permission_code) DO UPDATE SET is_granted=false,expires_at=NULL;
DO $$
DECLARE v_combo BOOLEAN := false; v_table BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM get_combo_sales_v5(CURRENT_DATE, CURRENT_DATE, '{"order_type":"dine_in"}');
  EXCEPTION WHEN insufficient_privilege THEN v_combo := true;
  END;
  BEGIN
    PERFORM get_sales_by_table_v4(CURRENT_DATE, CURRENT_DATE, '{"payment_method":"cash"}');
  EXCEPTION WHEN insufficient_privilege THEN v_table := true;
  END;
  PERFORM set_config('breakery.t9', (v_combo AND v_table)::text, false);
END $$;
SELECT ok(current_setting('breakery.t9')::boolean,
  'T9: without reports.sales.read both functions raise 42501');

SELECT * FROM finish();
ROLLBACK;
