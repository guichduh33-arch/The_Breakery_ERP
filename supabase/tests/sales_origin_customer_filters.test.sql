-- supabase/tests/sales_origin_customer_filters.test.sql
-- S3-22, étape 2, deuxième lot — pgTAP des filtres de commande des familles
-- get_sales_by_origin et get_sales_by_customer (argument `p_filters`).
--
-- CE QUE CETTE SUITE PROTÈGE : un filtre RESTREINT vraiment, sur la période
-- ET sur la fenêtre précédente, et sans filtre le résultat ne bouge pas.
-- Trois commandes maîtrisées, numérotées comptoir (origine P), portées par un
-- client neuf créé ici —
--   A  P990000000001  take_out  table PGTAP-OA  31 000  cash  aujourd'hui
--   B  P990000000002  dine_in   table PGTAP-OB  72 000  qris  aujourd'hui
--   E  P990000000003  dine_in   table PGTAP-OB  15 000  cash  hier
--   N  #PGTAP-OCF-ANON take_out  sans table      9 000  cash  aujourd'hui,
--      SANS client et non numérotée : invisible de l'origine, comptée en anonyme
-- La période lue est AUJOURD'HUI seul : la fenêtre précédente est HIER, donc
-- E y tombe. Origine : on mesure AVANT puis APRÈS l'insertion (d'autres
-- ventes P peuvent exister). Client : il est neuf, les valeurs sont exactes.
--
--   T1 : origine — filtres vides, nuls ou inconnus == aucun filtre
--   T2 : origine — type de commande, période ET fenêtre précédente
--   T3 : origine — moyen de paiement, exclusion positive
--   T4 : origine — table, égalité stricte
--   T5 : client  — filtres vides, nuls ou inconnus == aucun filtre
--   T6 : client  — type, paiement, table restreignent ses chiffres
--   T7 : client  — la fenêtre précédente suit le filtre
--   T8 : client  — « nouveau client » reste lu sur TOUTES ses commandes
--   T9 : droits (authenticated oui, anon non) et anciennes versions supprimées
--   T10 : sans reports.sales.read → 42501, sur les deux fonctions
--   T11 : client  — le chiffre anonyme suit le filtre
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

SELECT plan(11);

-- Sonde origine : la ligne P (revenue, orders, revenue_prev), zéro si absente.
CREATE FUNCTION pg_temp.origin_probe(p_f jsonb) RETURNS jsonb
LANGUAGE sql AS $probe$
  WITH r AS (SELECT get_sales_by_origin_v4(CURRENT_DATE, CURRENT_DATE, p_f) AS j)
  SELECT jsonb_build_object(
    'revenue', COALESCE((SELECT (e->>'revenue')::numeric FROM r, jsonb_array_elements(r.j->'by_origin') e
                          WHERE e->>'origin' = 'P'), 0),
    'orders',  COALESCE((SELECT (e->>'orders')::numeric FROM r, jsonb_array_elements(r.j->'by_origin') e
                          WHERE e->>'origin' = 'P'), 0),
    'prev',    COALESCE((SELECT (e->>'revenue_prev')::numeric FROM r, jsonb_array_elements(r.j->'by_origin') e
                          WHERE e->>'origin' = 'P'), 0))
  FROM r
$probe$;
-- Vrai si, entre deux sondes, la ligne P a bougé d'exactement (revenue, orders, prev).
CREATE FUNCTION pg_temp.moved(p_before jsonb, p_after jsonb, p_rev numeric, p_n numeric, p_prev numeric)
RETURNS boolean LANGUAGE sql AS $moved$
  SELECT (p_after->>'revenue')::numeric - (p_before->>'revenue')::numeric = p_rev
     AND (p_after->>'orders')::numeric  - (p_before->>'orders')::numeric  = p_n
     AND (p_after->>'prev')::numeric    - (p_before->>'prev')::numeric    = p_prev
$moved$;
-- Sonde client : sa ligne de la période (revenue, n, prev, is_new) ; NULL si absente.
CREATE FUNCTION pg_temp.cust_probe(p_cid uuid, p_f jsonb) RETURNS jsonb
LANGUAGE sql AS $probe$
  SELECT (SELECT jsonb_build_object(
            'revenue', (e->>'revenue')::numeric,
            'n',       (e->>'order_count')::numeric,
            'prev',    (e->>'revenue_prev')::numeric,
            'is_new',  (e->>'is_new')::boolean)
          FROM jsonb_array_elements(
            get_sales_by_customer_v4(CURRENT_DATE, CURRENT_DATE, NULL, 2, p_f)->'by_customer') e
          WHERE (e->>'customer_id')::uuid = p_cid)
$probe$;
-- Sonde anonyme : CA et nombre de commandes sans client, sur la période.
CREATE FUNCTION pg_temp.anon_probe(p_f jsonb) RETURNS jsonb
LANGUAGE sql AS $probe$
  WITH r AS (SELECT get_sales_by_customer_v4(CURRENT_DATE, CURRENT_DATE, NULL, 2, p_f) AS j)
  SELECT jsonb_build_object(
    'revenue', (r.j->'summary'->>'anonymous_revenue')::numeric,
    'n',       (r.j->'summary'->>'anonymous_orders')::numeric)
  FROM r
$probe$;

DO $$
DECLARE
  v_pid   uuid := 'f5430000-0000-4000-a000-000000000003';
  v_sid   uuid := 'f5430000-0000-4000-a000-000000000001';
  v_cid   uuid;
  v_a uuid; v_b uuid; v_e uuid; v_n uuid;
  n_to0 JSONB; n_di0 JSONB; n_to1 JSONB; n_di1 JSONB;
  o0 JSONB; o_to0 JSONB; o_di0 JSONB; o_cash0 JSONB; o_qris0 JSONB;
  o1 JSONB; o_to1 JSONB; o_di1 JSONB; o_cash1 JSONB; o_qris1 JSONB;
  v_full JSONB;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';
  PERFORM pg_temp.fixture_released_days(current_date-366,current_date);

  o0      := pg_temp.origin_probe('{}');
  o_to0   := pg_temp.origin_probe('{"order_type":"take_out"}');
  o_di0   := pg_temp.origin_probe('{"order_type":"dine_in"}');
  o_cash0 := pg_temp.origin_probe('{"payment_method":"cash"}');
  o_qris0 := pg_temp.origin_probe('{"payment_method":"qris"}');
  n_to0   := pg_temp.anon_probe('{"order_type":"take_out"}');
  n_di0   := pg_temp.anon_probe('{"order_type":"dine_in"}');

  INSERT INTO customers (name) VALUES ('PGTAP Filter Customer') RETURNING id INTO v_cid;

  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total,
                      created_at, paid_at, table_number, session_id, customer_id)
  VALUES ('P990000000001', 'take_out', 'paid', 31000, 0, 31000,
          now() - interval '30 minutes', now(), 'PGTAP-OA', v_sid, v_cid)
  RETURNING id INTO v_a;
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total,
                      created_at, paid_at, table_number, session_id, customer_id)
  VALUES ('P990000000002', 'dine_in', 'paid', 72000, 0, 72000,
          now() - interval '30 minutes', now(), 'PGTAP-OB', v_sid, v_cid)
  RETURNING id INTO v_b;
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total,
                      created_at, paid_at, table_number, session_id, customer_id)
  VALUES ('P990000000003', 'dine_in', 'paid', 15000, 0, 15000,
          now() - interval '1 day', now() - interval '1 day', 'PGTAP-OB', v_sid, v_cid)
  RETURNING id INTO v_e;
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total,
                      created_at, paid_at, session_id)
  VALUES ('#PGTAP-OCF-ANON', 'take_out', 'paid', 9000, 0, 9000,
          now() - interval '30 minutes', now(), v_sid)
  RETURNING id INTO v_n;
  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total)
  VALUES (v_a, v_pid, 'Filter A', 10000, 3, 31000),
         (v_b, v_pid, 'Filter B', 10000, 7, 72000),
         (v_e, v_pid, 'Filter E', 15000, 1, 15000),
         (v_n, v_pid, 'Filter N',  9000, 1,  9000);
  INSERT INTO order_payments (order_id, method, amount, session_id)
  VALUES (v_a, 'cash', 31000, v_sid),
         (v_b, 'qris', 72000, v_sid),
         (v_e, 'cash', 15000, v_sid),
         (v_n, 'cash',  9000, v_sid);
  PERFORM pg_temp.fixture_released_days(current_date-366,current_date);

  o1      := pg_temp.origin_probe('{}');
  o_to1   := pg_temp.origin_probe('{"order_type":"take_out"}');
  o_di1   := pg_temp.origin_probe('{"order_type":"dine_in"}');
  o_cash1 := pg_temp.origin_probe('{"payment_method":"cash"}');
  o_qris1 := pg_temp.origin_probe('{"payment_method":"qris"}');
  n_to1   := pg_temp.anon_probe('{"order_type":"take_out"}');
  n_di1   := pg_temp.anon_probe('{"order_type":"dine_in"}');

  -- T11 : la commande anonyme N (take_out) ne bouge que le chiffre take_out.
  PERFORM set_config('breakery.t11', COALESCE(
        (n_to1->>'revenue')::numeric - (n_to0->>'revenue')::numeric = 9000
    AND (n_to1->>'n')::numeric       - (n_to0->>'n')::numeric       = 1
    AND n_di1 = n_di0, false)::text, false);

  -- T1 : sans filtre A et B entrent, E entre en fenêtre précédente ; les
  -- formes « vides » rendent le même résultat (hors horodatage de génération).
  v_full := get_sales_by_origin_v4(CURRENT_DATE, CURRENT_DATE) - 'generated_at';
  PERFORM set_config('breakery.t1', COALESCE(
        pg_temp.moved(o0, o1, 103000, 2, 15000)
    AND pg_temp.origin_probe(NULL) = o1
    AND pg_temp.origin_probe('{"order_type":null,"payment_method":"","table_number":""}') = o1
    AND pg_temp.origin_probe('{"unknown_key":"x"}') = o1
    AND (get_sales_by_origin_v4(CURRENT_DATE, CURRENT_DATE, '{}') - 'generated_at') = v_full,
    false)::text, false);

  -- T2 : type — période ET fenêtre précédente suivent le filtre.
  PERFORM set_config('breakery.t2', COALESCE(
        pg_temp.moved(o_to0, o_to1, 31000, 1, 0)
    AND pg_temp.moved(o_di0, o_di1, 72000, 1, 15000), false)::text, false);

  -- T3 : moyen de paiement.
  PERFORM set_config('breakery.t3', COALESCE(
        pg_temp.moved(o_cash0, o_cash1, 31000, 1, 15000)
    AND pg_temp.moved(o_qris0, o_qris1, 72000, 1, 0), false)::text, false);

  -- T4 : table, égalité stricte (aucune autre vente ne porte ces tables).
  PERFORM set_config('breakery.t4', COALESCE(
        pg_temp.origin_probe('{"table_number":"PGTAP-OA"}')
          = jsonb_build_object('revenue', 31000, 'orders', 1, 'prev', 0)
    AND pg_temp.origin_probe('{"table_number":"PGTAP-OB"}')
          = jsonb_build_object('revenue', 72000, 'orders', 1, 'prev', 15000)
    AND pg_temp.origin_probe('{"table_number":"PGTAP-O"}')
          = jsonb_build_object('revenue', 0, 'orders', 0, 'prev', 0),
    false)::text, false);

  -- T5 : client — sans filtre, et formes « vides » identiques.
  PERFORM set_config('breakery.t5', COALESCE(
        pg_temp.cust_probe(v_cid, '{}')
          = jsonb_build_object('revenue', 103000, 'n', 2, 'prev', 15000, 'is_new', false)
    AND pg_temp.cust_probe(v_cid, NULL) = pg_temp.cust_probe(v_cid, '{}')
    AND pg_temp.cust_probe(v_cid, '{"order_type":null,"payment_method":"","table_number":""}')
          = pg_temp.cust_probe(v_cid, '{}')
    AND pg_temp.cust_probe(v_cid, '{"unknown_key":"x"}') = pg_temp.cust_probe(v_cid, '{}'),
    false)::text, false);

  -- T6 : client — chaque filtre ne garde que sa commande ; une valeur sans
  -- correspondance fait disparaître la ligne, sans erreur.
  PERFORM set_config('breakery.t6', COALESCE(
        (pg_temp.cust_probe(v_cid, '{"order_type":"take_out"}')->>'revenue')::numeric = 31000
    AND (pg_temp.cust_probe(v_cid, '{"order_type":"dine_in"}')->>'revenue')::numeric  = 72000
    AND (pg_temp.cust_probe(v_cid, '{"payment_method":"cash"}')->>'revenue')::numeric = 31000
    AND (pg_temp.cust_probe(v_cid, '{"payment_method":"qris"}')->>'revenue')::numeric = 72000
    AND (pg_temp.cust_probe(v_cid, '{"table_number":"PGTAP-OA"}')->>'n')::numeric = 1
    AND pg_temp.cust_probe(v_cid, '{"payment_method":"pgtap_no_such_method"}') IS NULL,
    false)::text, false);

  -- T7 : client — la fenêtre précédente suit le filtre (E est dine_in, cash).
  PERFORM set_config('breakery.t7', COALESCE(
        (pg_temp.cust_probe(v_cid, '{"order_type":"dine_in"}')->>'prev')::numeric = 15000
    AND (pg_temp.cust_probe(v_cid, '{"order_type":"take_out"}')->>'prev') IS NULL
    AND (pg_temp.cust_probe(v_cid, '{"payment_method":"qris"}')->>'prev') IS NULL,
    false)::text, false);

  -- T8 : « nouveau client » — sous le filtre take_out, sa seule commande
  -- antérieure (E, dine_in) est exclue des chiffres, mais il n'est PAS neuf.
  PERFORM set_config('breakery.t8', COALESCE(
    (pg_temp.cust_probe(v_cid, '{"order_type":"take_out"}')->>'is_new')::boolean = false,
    false)::text, false);
END $$;

SELECT ok(current_setting('breakery.t1')::boolean,
  'T1: origin — empty, null or unknown filters equal no filter');
SELECT ok(current_setting('breakery.t2')::boolean,
  'T2: origin — order_type filter restricts the period and the previous window');
SELECT ok(current_setting('breakery.t3')::boolean,
  'T3: origin — payment_method filter keeps its own orders and drops the other');
SELECT ok(current_setting('breakery.t4')::boolean,
  'T4: origin — table_number filter is a strict equality');
SELECT ok(current_setting('breakery.t5')::boolean,
  'T5: customer — empty, null or unknown filters equal no filter');
SELECT ok(current_setting('breakery.t6')::boolean,
  'T6: customer — order_type, payment_method and table_number restrict the figures');
SELECT ok(current_setting('breakery.t7')::boolean,
  'T7: customer — the previous window follows the filter');
SELECT ok(current_setting('breakery.t8')::boolean,
  'T8: customer — is_new stays read on every order of the customer');

-- T9 droits et ménage des versions remplacées.
SELECT ok(
  has_function_privilege('authenticated','public.get_sales_by_origin_v4(date,date,jsonb)','EXECUTE')
  AND has_function_privilege('authenticated','public.get_sales_by_customer_v4(date,date,text,integer,jsonb)','EXECUTE')
  AND NOT has_function_privilege('anon','public.get_sales_by_origin_v4(date,date,jsonb)','EXECUTE')
  AND NOT has_function_privilege('anon','public.get_sales_by_customer_v4(date,date,text,integer,jsonb)','EXECUTE')
  AND to_regprocedure('public.get_sales_by_origin_v3(date,date)') IS NULL
  AND to_regprocedure('public.get_sales_by_customer_v3(date,date,text,integer)') IS NULL,
  'T9: authenticated may execute, anon may not, replaced versions are dropped');

-- T10 garde : sans reports.sales.read → 42501 sur les deux fonctions.
INSERT INTO public.user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
SELECT id,'reports.sales.read',false,'Transactional report deny fixture' FROM public.user_profiles
WHERE employee_code='EMP001' AND deleted_at IS NULL
ON CONFLICT(user_profile_id,permission_code) DO UPDATE SET is_granted=false,expires_at=NULL;
DO $$
DECLARE v_origin BOOLEAN := false; v_cust BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM get_sales_by_origin_v4(CURRENT_DATE, CURRENT_DATE, '{"order_type":"dine_in"}');
  EXCEPTION WHEN insufficient_privilege THEN v_origin := true;
  END;
  BEGIN
    PERFORM get_sales_by_customer_v4(CURRENT_DATE, CURRENT_DATE, NULL, 2, '{"order_type":"dine_in"}');
  EXCEPTION WHEN insufficient_privilege THEN v_cust := true;
  END;
  PERFORM set_config('breakery.t10', (v_origin AND v_cust)::text, false);
END $$;
SELECT ok(current_setting('breakery.t10')::boolean,
  'T10: without reports.sales.read both functions raise 42501');
SELECT ok(current_setting('breakery.t11')::boolean,
  'T11: customer — the anonymous figures follow the filter');

SELECT * FROM finish();
ROLLBACK;
