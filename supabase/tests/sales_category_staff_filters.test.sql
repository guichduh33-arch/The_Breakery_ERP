-- supabase/tests/sales_category_staff_filters.test.sql
-- S3-22, étape 2 — pgTAP des filtres de commande des familles
-- get_sales_by_category et get_sales_by_staff (argument `p_filters`).
--
-- CE QUE CETTE SUITE PROTÈGE : un filtre RESTREINT vraiment, et sans filtre le
-- résultat ne bouge pas. Un prédicat qui garderait tout passerait un test de
-- simple exécution ; ici deux commandes maîtrisées, sur la même catégorie et
-- le même vendeur —
--   A  #PGTAP-CSA  take_out  table PGTAP-CA  qty 3  31 000  réglée en cash
--   B  #PGTAP-CSB  dine_in   table PGTAP-CB  qty 7  72 000  réglée en qris
-- et l'on mesure AVANT puis APRÈS l'insertion, sous chaque filtre : le filtre
-- A ne doit bouger que de A, le filtre B que de B.
--
--   T1 : catégorie — filtres vides, nuls ou inconnus == aucun filtre
--   T2 : vendeur   — filtres vides, nuls ou inconnus == aucun filtre
--   T3 : catégorie — type de commande, exclusion positive
--   T4 : catégorie — moyen de paiement, exclusion positive
--   T5 : catégorie — table, égalité stricte
--   T6 : vendeur   — type de commande, exclusion positive
--   T7 : vendeur   — moyen de paiement, exclusion positive
--   T8 : vendeur   — table, égalité stricte
--   T9 : valeur de filtre inexistante → résultat vide, sans erreur
--   T10 : droits (authenticated oui, anon non) et anciennes versions supprimées
--   T11 : sans reports.sales.read → 42501, sur les deux fonctions
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

-- Sondes : la ligne d'UNE catégorie / d'UN vendeur, zéro si absente.
CREATE FUNCTION pg_temp.cat_probe(p_cat uuid, p_f jsonb) RETURNS jsonb
LANGUAGE sql AS $probe$
  SELECT jsonb_build_object(
    'total', COALESCE((SELECT r.total FROM get_sales_by_category_v7(CURRENT_DATE - 1, CURRENT_DATE, p_f) r
                        WHERE r.category_id = p_cat), 0),
    'n',     COALESCE((SELECT r.qty   FROM get_sales_by_category_v7(CURRENT_DATE - 1, CURRENT_DATE, p_f) r
                        WHERE r.category_id = p_cat), 0))
$probe$;
CREATE FUNCTION pg_temp.staff_probe(p_staff uuid, p_f jsonb) RETURNS jsonb
LANGUAGE sql AS $probe$
  SELECT jsonb_build_object(
    'total', COALESCE((SELECT r.total FROM get_sales_by_staff_v6(CURRENT_DATE - 1, CURRENT_DATE, p_f) r
                        WHERE r.staff_id = p_staff), 0),
    'n',     COALESCE((SELECT r.order_count FROM get_sales_by_staff_v6(CURRENT_DATE - 1, CURRENT_DATE, p_f) r
                        WHERE r.staff_id = p_staff), 0))
$probe$;
-- Vrai si, entre deux sondes, la ligne a bougé d'exactement (p_total, p_n).
CREATE FUNCTION pg_temp.moved(p_before jsonb, p_after jsonb, p_total numeric, p_n numeric)
RETURNS boolean LANGUAGE sql AS $moved$
  SELECT (p_after->>'total')::numeric - (p_before->>'total')::numeric = p_total
     AND (p_after->>'n')::numeric     - (p_before->>'n')::numeric     = p_n
$moved$;

DO $$
DECLARE
  v_pid   uuid := 'f5430000-0000-4000-a000-000000000003';
  v_sid   uuid := 'f5430000-0000-4000-a000-000000000001';
  v_cat   uuid;
  v_staff uuid;
  v_a uuid; v_b uuid;
  c0 JSONB; c_to0 JSONB; c_di0 JSONB; c_cash0 JSONB; c_qris0 JSONB;
  c1 JSONB; c_to1 JSONB; c_di1 JSONB; c_cash1 JSONB; c_qris1 JSONB;
  s0 JSONB; s_to0 JSONB; s_di0 JSONB; s_cash0 JSONB; s_qris0 JSONB;
  s1 JSONB; s_to1 JSONB; s_di1 JSONB; s_cash1 JSONB; s_qris1 JSONB;
  v_none_cat INT; v_none_staff INT;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';
  SELECT category_id INTO v_cat FROM products WHERE id = v_pid;
  SELECT id INTO v_staff FROM user_profiles
   WHERE auth_user_id = '00000000-0000-0000-0000-000000000001' AND deleted_at IS NULL;
  PERFORM pg_temp.fixture_released_days(current_date-366,current_date);

  c0      := pg_temp.cat_probe(v_cat, '{}');
  c_to0   := pg_temp.cat_probe(v_cat, '{"order_type":"take_out"}');
  c_di0   := pg_temp.cat_probe(v_cat, '{"order_type":"dine_in"}');
  c_cash0 := pg_temp.cat_probe(v_cat, '{"payment_method":"cash"}');
  c_qris0 := pg_temp.cat_probe(v_cat, '{"payment_method":"qris"}');
  s0      := pg_temp.staff_probe(v_staff, '{}');
  s_to0   := pg_temp.staff_probe(v_staff, '{"order_type":"take_out"}');
  s_di0   := pg_temp.staff_probe(v_staff, '{"order_type":"dine_in"}');
  s_cash0 := pg_temp.staff_probe(v_staff, '{"payment_method":"cash"}');
  s_qris0 := pg_temp.staff_probe(v_staff, '{"payment_method":"qris"}');

  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total,
                      created_at, paid_at, table_number, session_id, served_by)
  VALUES ('#PGTAP-CSA', 'take_out', 'paid', 31000, 0, 31000,
          now() - interval '30 minutes', now(), 'PGTAP-CA', v_sid, v_staff)
  RETURNING id INTO v_a;
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total,
                      created_at, paid_at, table_number, session_id, served_by)
  VALUES ('#PGTAP-CSB', 'dine_in', 'paid', 72000, 0, 72000,
          now() - interval '30 minutes', now(), 'PGTAP-CB', v_sid, v_staff)
  RETURNING id INTO v_b;
  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total)
  VALUES (v_a, v_pid, 'Filter A', 10000, 3, 31000),
         (v_b, v_pid, 'Filter B', 10000, 7, 72000);
  INSERT INTO order_payments (order_id, method, amount, session_id)
  VALUES (v_a, 'cash', 31000, v_sid),
         (v_b, 'qris', 72000, v_sid);
  PERFORM pg_temp.fixture_released_days(current_date-366,current_date);

  c1      := pg_temp.cat_probe(v_cat, '{}');
  c_to1   := pg_temp.cat_probe(v_cat, '{"order_type":"take_out"}');
  c_di1   := pg_temp.cat_probe(v_cat, '{"order_type":"dine_in"}');
  c_cash1 := pg_temp.cat_probe(v_cat, '{"payment_method":"cash"}');
  c_qris1 := pg_temp.cat_probe(v_cat, '{"payment_method":"qris"}');
  s1      := pg_temp.staff_probe(v_staff, '{}');
  s_to1   := pg_temp.staff_probe(v_staff, '{"order_type":"take_out"}');
  s_di1   := pg_temp.staff_probe(v_staff, '{"order_type":"dine_in"}');
  s_cash1 := pg_temp.staff_probe(v_staff, '{"payment_method":"cash"}');
  s_qris1 := pg_temp.staff_probe(v_staff, '{"payment_method":"qris"}');

  -- T1/T2 : sans filtre les deux commandes entrent, et les formes « vides »
  -- (NULL, clé nulle, chaîne vide, clé inconnue) rendent le même résultat.
  PERFORM set_config('breakery.t1', COALESCE(
        pg_temp.moved(c0, c1, 103000, 10)
    AND pg_temp.cat_probe(v_cat, NULL) = c1
    AND pg_temp.cat_probe(v_cat, '{"order_type":null,"payment_method":"","table_number":""}') = c1
    AND pg_temp.cat_probe(v_cat, '{"unknown_key":"x"}') = c1
    AND (SELECT jsonb_agg(to_jsonb(r)) FROM get_sales_by_category_v7(CURRENT_DATE - 1, CURRENT_DATE) r)
      = (SELECT jsonb_agg(to_jsonb(r)) FROM get_sales_by_category_v7(CURRENT_DATE - 1, CURRENT_DATE, '{}') r),
    false)::text, false);
  PERFORM set_config('breakery.t2', COALESCE(
        pg_temp.moved(s0, s1, 103000, 2)
    AND pg_temp.staff_probe(v_staff, NULL) = s1
    AND pg_temp.staff_probe(v_staff, '{"order_type":null,"payment_method":"","table_number":""}') = s1
    AND pg_temp.staff_probe(v_staff, '{"unknown_key":"x"}') = s1
    AND (SELECT jsonb_agg(to_jsonb(r)) FROM get_sales_by_staff_v6(CURRENT_DATE - 1, CURRENT_DATE) r)
      = (SELECT jsonb_agg(to_jsonb(r)) FROM get_sales_by_staff_v6(CURRENT_DATE - 1, CURRENT_DATE, '{}') r),
    false)::text, false);

  -- T3/T4/T5 : catégorie.
  PERFORM set_config('breakery.t3', COALESCE(
    pg_temp.moved(c_to0, c_to1, 31000, 3) AND pg_temp.moved(c_di0, c_di1, 72000, 7), false)::text, false);
  PERFORM set_config('breakery.t4', COALESCE(
    pg_temp.moved(c_cash0, c_cash1, 31000, 3) AND pg_temp.moved(c_qris0, c_qris1, 72000, 7), false)::text, false);
  PERFORM set_config('breakery.t5', COALESCE(
        pg_temp.cat_probe(v_cat, '{"table_number":"PGTAP-CA"}') = jsonb_build_object('total', 31000.00, 'n', 3.000)
    AND pg_temp.cat_probe(v_cat, '{"table_number":"PGTAP-CB"}') = jsonb_build_object('total', 72000.00, 'n', 7.000)
    AND pg_temp.cat_probe(v_cat, '{"table_number":"PGTAP-C"}')  = jsonb_build_object('total', 0, 'n', 0),
    false)::text, false);

  -- T6/T7/T8 : vendeur.
  PERFORM set_config('breakery.t6', COALESCE(
    pg_temp.moved(s_to0, s_to1, 31000, 1) AND pg_temp.moved(s_di0, s_di1, 72000, 1), false)::text, false);
  PERFORM set_config('breakery.t7', COALESCE(
    pg_temp.moved(s_cash0, s_cash1, 31000, 1) AND pg_temp.moved(s_qris0, s_qris1, 72000, 1), false)::text, false);
  PERFORM set_config('breakery.t8', COALESCE(
        pg_temp.staff_probe(v_staff, '{"table_number":"PGTAP-CA"}') = jsonb_build_object('total', 31000.00, 'n', 1)
    AND pg_temp.staff_probe(v_staff, '{"table_number":"PGTAP-CB"}') = jsonb_build_object('total', 72000.00, 'n', 1)
    AND pg_temp.staff_probe(v_staff, '{"table_number":"PGTAP-C"}')  = jsonb_build_object('total', 0, 'n', 0),
    false)::text, false);

  -- T9 : une valeur qui n'existe pas rend zéro ligne, jamais une erreur.
  SELECT COUNT(*) INTO v_none_cat
    FROM get_sales_by_category_v7(CURRENT_DATE - 1, CURRENT_DATE, '{"payment_method":"pgtap_no_such_method"}');
  SELECT COUNT(*) INTO v_none_staff
    FROM get_sales_by_staff_v6(CURRENT_DATE - 1, CURRENT_DATE, '{"order_type":"pgtap_no_such_type"}');
  PERFORM set_config('breakery.t9', (v_none_cat = 0 AND v_none_staff = 0)::text, false);
END $$;

SELECT ok(current_setting('breakery.t1')::boolean,
  'T1: category — empty, null or unknown filters equal no filter');
SELECT ok(current_setting('breakery.t2')::boolean,
  'T2: staff — empty, null or unknown filters equal no filter');
SELECT ok(current_setting('breakery.t3')::boolean,
  'T3: category — order_type filter keeps its own order and drops the other');
SELECT ok(current_setting('breakery.t4')::boolean,
  'T4: category — payment_method filter keeps its own order and drops the other');
SELECT ok(current_setting('breakery.t5')::boolean,
  'T5: category — table_number filter is a strict equality');
SELECT ok(current_setting('breakery.t6')::boolean,
  'T6: staff — order_type filter keeps its own order and drops the other');
SELECT ok(current_setting('breakery.t7')::boolean,
  'T7: staff — payment_method filter keeps its own order and drops the other');
SELECT ok(current_setting('breakery.t8')::boolean,
  'T8: staff — table_number filter is a strict equality');
SELECT ok(current_setting('breakery.t9')::boolean,
  'T9: a filter value that matches nothing returns no row, no error');

-- T10 droits et ménage des versions remplacées.
SELECT ok(
  has_function_privilege('authenticated','public.get_sales_by_category_v7(date,date,jsonb)','EXECUTE')
  AND has_function_privilege('authenticated','public.get_sales_by_staff_v6(date,date,jsonb)','EXECUTE')
  AND NOT has_function_privilege('anon','public.get_sales_by_category_v7(date,date,jsonb)','EXECUTE')
  AND NOT has_function_privilege('anon','public.get_sales_by_staff_v6(date,date,jsonb)','EXECUTE')
  AND to_regprocedure('public.get_sales_by_category_v6(date,date)') IS NULL
  AND to_regprocedure('public.get_sales_by_staff_v5(date,date)') IS NULL,
  'T10: authenticated may execute, anon may not, replaced versions are dropped');

-- T11 garde : sans reports.sales.read → 42501 sur les deux fonctions.
INSERT INTO public.user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
SELECT id,'reports.sales.read',false,'Transactional report deny fixture' FROM public.user_profiles
WHERE employee_code='EMP001' AND deleted_at IS NULL
ON CONFLICT(user_profile_id,permission_code) DO UPDATE SET is_granted=false,expires_at=NULL;
DO $$
DECLARE v_cat BOOLEAN := false; v_staff BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM * FROM get_sales_by_category_v7(CURRENT_DATE - 1, CURRENT_DATE, '{"order_type":"dine_in"}');
  EXCEPTION WHEN insufficient_privilege THEN v_cat := true;
  END;
  BEGIN
    PERFORM * FROM get_sales_by_staff_v6(CURRENT_DATE - 1, CURRENT_DATE, '{"order_type":"dine_in"}');
  EXCEPTION WHEN insufficient_privilege THEN v_staff := true;
  END;
  PERFORM set_config('breakery.t11', (v_cat AND v_staff)::text, false);
END $$;
SELECT ok(current_setting('breakery.t11')::boolean,
  'T11: without reports.sales.read both functions raise 42501');

SELECT * FROM finish();
ROLLBACK;
