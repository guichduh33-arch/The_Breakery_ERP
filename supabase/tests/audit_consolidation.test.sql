-- supabase/tests/audit_consolidation.test.sql
-- S56 P2.2 — consolidation de l'audit-trail sur la table audit_logs.
-- Suite récurrente : garantit qu'aucune fonction ne référence plus la vue
-- compat audit_log (droppée _088), que la couche compat a bien disparu,
-- qu'un flux réécrit produit toujours ses lignes d'audit, et que la RLS
-- admin_read de audit_logs est intacte.
-- Run via MCP execute_sql (BEGIN … ROLLBACK). Pas de Docker.

BEGIN;
SELECT plan(6);

-- T1 : plus aucune fonction du schéma public n'ÉCRIT via la vue.
SELECT is(
  (SELECT COUNT(*)::INT
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosrc ~* 'INSERT\s+INTO\s+(public\.)?audit_log\M'),
  0,
  'T1 — zéro INSERT INTO audit_log (vue) dans pg_proc.prosrc'
);

-- T2 : plus aucune fonction ne LIT la vue (replay duplicate_recipe_v1 migré).
SELECT is(
  (SELECT COUNT(*)::INT
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosrc ~* '(FROM|JOIN)\s+(public\.)?audit_log\M'),
  0,
  'T2 — zéro lecture FROM/JOIN audit_log (vue) dans pg_proc.prosrc'
);

-- T3 : la vue compat n'existe plus.
SELECT ok(
  to_regclass('public.audit_log') IS NULL,
  'T3 — la vue compat audit_log est droppée (_088)'
);

-- T4 : la fonction trigger compat n'existe plus.
SELECT is(
  (SELECT COUNT(*)::INT FROM pg_proc WHERE proname = 'audit_log_insert_trigger'),
  0,
  'T4 — audit_log_insert_trigger() droppée (_088)'
);

-- T5 : flux échantillon réécrit — record_stock_movement_v1 écrit toujours
-- sa ligne d'audit, désormais directement dans audit_logs (vocabulaire
-- entity_type/entity_id).
DO $$
DECLARE
  v_user    uuid;
  v_product uuid;
  v_section uuid;
  v_res     jsonb;
  v_mvt     uuid;
  v_count   int;
BEGIN
  SELECT up.auth_user_id INTO v_user
    FROM user_profiles up
   WHERE up.role_code = 'SUPER_ADMIN' AND up.deleted_at IS NULL
     AND up.auth_user_id IS NOT NULL
   LIMIT 1;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'T5 precondition: no SUPER_ADMIN profile with auth_user_id';
  END IF;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  SELECT id INTO v_product FROM products
   WHERE is_active AND deleted_at IS NULL AND track_inventory LIMIT 1;
  IF v_product IS NULL THEN
    RAISE EXCEPTION 'T5 precondition: no active track_inventory product found';
  END IF;
  SELECT id INTO v_section FROM sections LIMIT 1;
  IF v_section IS NULL THEN
    RAISE EXCEPTION 'T5 precondition: no section found';
  END IF;

  SELECT record_stock_movement_v1(
    p_product_id := v_product, p_movement_type := 'adjustment_in',
    p_quantity := 1, p_reason := 'S56 audit_consolidation T5',
    p_unit_cost := NULL, p_supplier_id := NULL,
    p_idempotency_key := gen_random_uuid(), p_unit := NULL,
    p_from_section_id := NULL, p_to_section_id := v_section,
    p_metadata := NULL, p_lot_id := NULL, p_allow_negative := true
  ) INTO v_res;
  v_mvt := (v_res->>'movement_id')::uuid;

  SELECT COUNT(*) INTO v_count FROM audit_logs
   WHERE action = 'stock.movement'
     AND entity_type = 'stock_movements'
     AND entity_id = v_mvt
     AND metadata IS NOT NULL;
  PERFORM set_config('breakery.s56_t5_pass', (v_count = 1)::text, true);
END $$;
SELECT ok(
  current_setting('breakery.s56_t5_pass')::boolean,
  'T5 — record_stock_movement_v1 (réécrit _087) audite dans audit_logs (entity_type/entity_id/metadata)'
);

-- T6 : RLS audit_logs intacte — une seule policy (admin_read, SELECT) ;
-- aucune policy INSERT/UPDATE/DELETE pour authenticated.
SELECT ok(
  (SELECT COUNT(*) = 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'audit_logs')
  AND
  (SELECT COUNT(*) = 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'audit_logs'
      AND policyname = 'admin_read' AND cmd = 'SELECT'),
  'T6 — RLS audit_logs : policy unique admin_read (SELECT), pas d''écriture authenticated'
);

SELECT * FROM finish();
ROLLBACK;
