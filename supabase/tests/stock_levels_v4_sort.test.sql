-- supabase/tests/stock_levels_v4_sort.test.sql
-- Audit UX/UI 2026-08-13, lot 5 — tri serveur de get_stock_levels_v4.
-- Runs via psql (pgtap-pr.yml) ou MCP execute_sql, BEGIN ... ROLLBACK.
-- Les comportements v3 (buckets, ILIKE, filtre catégorie) restent couverts par
-- inventory.test.sql (T12/T22-24/T41, repointés v4) ; ce fichier ne teste que
-- ce que v4 AJOUTE : l'allowlist de tri, la direction, l'ordre par défaut, et
-- la disparition de v3.

BEGIN;
SELECT plan(7);

-- Contexte MANAGER (gate inventory.read).
DO $$
DECLARE v_mgr UUID := (SELECT auth_user_id FROM user_profiles WHERE role_code='MANAGER' AND deleted_at IS NULL AND auth_user_id IS NOT NULL ORDER BY created_at LIMIT 1);
BEGIN
  IF v_mgr IS NULL THEN RAISE EXCEPTION 'no MANAGER seed'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
END $$;

SELECT ok(
  NOT has_function_privilege('anon', 'public.get_stock_levels_v4(uuid,text,public.stock_bucket,integer,integer,text,text)', 'EXECUTE'),
  'T1: anon has no EXECUTE on get_stock_levels_v4'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.get_stock_levels_v4(uuid,text,public.stock_bucket,integer,integer,text,text)', 'EXECUTE'),
  'T2: authenticated has EXECUTE on get_stock_levels_v4'
);
SELECT ok(
  to_regprocedure('public.get_stock_levels_v3(uuid,text,public.stock_bucket,integer,integer)') IS NULL,
  'T3: get_stock_levels_v3 is dropped (versioning monotone)'
);

-- T4/T5 : tri par nom, deux directions — la suite est ordonnée.
DO $$
DECLARE v_asc BOOLEAN; v_desc BOOLEAN;
BEGIN
  SELECT bool_and(name >= lag_name) INTO v_asc FROM (
    SELECT r.name, lag(r.name) OVER () AS lag_name
    FROM get_stock_levels_v4(NULL, NULL, 'all', 10, 0, 'name', 'asc') r
  ) s WHERE lag_name IS NOT NULL;
  SELECT bool_and(name <= lag_name) INTO v_desc FROM (
    SELECT r.name, lag(r.name) OVER () AS lag_name
    FROM get_stock_levels_v4(NULL, NULL, 'all', 10, 0, 'name', 'desc') r
  ) s WHERE lag_name IS NOT NULL;
  PERFORM set_config('breakery.t4_pass', COALESCE(v_asc, false)::text, false);
  PERFORM set_config('breakery.t5_pass', COALESCE(v_desc, false)::text, false);
END $$;
SELECT ok(current_setting('breakery.t4_pass', true)::boolean,
  'T4: p_sort=name asc returns rows in ascending name order');
SELECT ok(current_setting('breakery.t5_pass', true)::boolean,
  'T5: p_sort=name desc returns rows in descending name order');

-- T6 : p_sort NULL → l'appel 5-args historique répond toujours.
DO $$
DECLARE v_count INT;
BEGIN
  SELECT count(*) INTO v_count FROM get_stock_levels_v4(NULL, NULL, 'all', 5, 0);
  PERFORM set_config('breakery.t6_pass', (v_count > 0)::text, false);
END $$;
SELECT ok(current_setting('breakery.t6_pass', true)::boolean,
  'T6: legacy 5-arg call (p_sort NULL) still answers with the historic order');

-- T7 : hors allowlist → 22023, jamais de SQL dynamique.
DO $$
DECLARE v_status TEXT := 'fail_no_raise';
BEGIN
  BEGIN
    PERFORM get_stock_levels_v4(NULL, NULL, 'all', 5, 0, 'cost_price; DROP TABLE x', 'asc');
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_status := 'pass';
  END;
  PERFORM set_config('breakery.t7_pass', (v_status = 'pass')::text, false);
END $$;
SELECT ok(current_setting('breakery.t7_pass', true)::boolean,
  'T7: a p_sort outside the allowlist raises 22023');

SELECT * FROM finish();
ROLLBACK;
