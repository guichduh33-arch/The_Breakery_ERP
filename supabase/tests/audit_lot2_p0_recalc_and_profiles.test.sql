-- Audit lot 2 — les deux P0 fermés par les migrations 20260907000001/02.
--
-- P0-1 : `_recalc_order_totals` sommait TOUTES les lignes, annulées comprises.
--        Le bug est ressuscité trois fois dans l'histoire du dépôt sous d'autres
--        formes (cf. la garde CI `line-total-formula`) : ce test épingle le
--        comportement au niveau du helper commun, en amont de ses 4 appelants.
-- P0-2 : `authenticated` portait UPDATE au niveau TABLE sur `user_profiles`,
--        avec une policy sans WITH CHECK — donc aucune contrainte de colonne.
--
-- Exécution : via MCP `execute_sql`, encadré BEGIN/ROLLBACK (pas de runner local).

BEGIN;
SELECT plan(7);

-- ---------------------------------------------------------------- P0-1
SELECT ok(
  pg_get_functiondef('public._recalc_order_totals(uuid)'::regprocedure) ILIKE '%is_cancelled = false%',
  'P0-1 : _recalc_order_totals filtre les lignes annulees'
);

CREATE TEMP TABLE _t_recalc(order_id uuid, vivant numeric, recalcule numeric);

DO $$
DECLARE
  v_order_id uuid;
  v_src      order_items%ROWTYPE;
  v_profil   uuid;
BEGIN
  SELECT id INTO v_profil FROM user_profiles WHERE deleted_at IS NULL LIMIT 1;

  SELECT oi.order_id INTO v_order_id
  FROM order_items oi JOIN orders o ON o.id = oi.order_id
  WHERE oi.is_cancelled = false AND o.total > 0
  LIMIT 1;

  SELECT * INTO v_src FROM order_items WHERE order_id = v_order_id LIMIT 1;

  -- Clone d'une ligne vivante, marquee annulee. Le CHECK
  -- chk_order_items_cancel_consistency impose les 3 colonnes d'annulation.
  v_src.id               := gen_random_uuid();
  v_src.is_cancelled     := true;
  v_src.line_total       := 50000;
  v_src.cancelled_at     := now();
  v_src.cancelled_reason := 'pgtap audit lot 2';
  v_src.cancelled_by     := v_profil;
  INSERT INTO order_items VALUES (v_src.*);

  PERFORM _recalc_order_totals(v_order_id);

  INSERT INTO _t_recalc
  SELECT v_order_id,
         (SELECT COALESCE(SUM(line_total),0) FROM order_items
            WHERE order_id = v_order_id AND is_cancelled = false),
         (SELECT subtotal FROM orders WHERE id = v_order_id);
END $$;

SELECT is(
  (SELECT recalcule FROM _t_recalc),
  (SELECT vivant    FROM _t_recalc),
  'P0-1 : le subtotal recalcule egale la somme des seules lignes vivantes'
);

SELECT ok(
  (SELECT recalcule < vivant + 50000 FROM _t_recalc),
  'P0-1 : les 50000 annules ne sont PAS reintegres au total'
);

-- ---------------------------------------------------------------- P0-2
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.user_profiles', 'UPDATE'),
  'P0-2 : authenticated ne porte plus UPDATE sur user_profiles'
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.hash_pin(text)', 'EXECUTE'),
  'P0-2 : authenticated ne peut plus fabriquer un hash de PIN'
);

-- Non-regression : ce qui doit SURVIVRE au revoke.
SELECT is(
  (SELECT count(*)::int FROM information_schema.column_privileges
     WHERE table_schema = 'public' AND table_name = 'user_profiles'
       AND grantee = 'authenticated' AND privilege_type = 'SELECT'),
  12,
  'P0-2 : les 12 grants colonne de lecture sont intacts (pin_hash toujours exclu)'
);

SELECT ok(
  has_function_privilege('service_role', 'public.hash_pin(text)', 'EXECUTE'),
  'P0-2 : service_role garde hash_pin (Edge Function auth-change-pin)'
);

SELECT * FROM finish();
ROLLBACK;
