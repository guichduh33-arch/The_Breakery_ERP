-- supabase/tests/stock_movements_append_only.test.sql
--
-- Finding F2 (docs/audits/2026-08-31-audit-stock-management.md).
--
-- `stock_movements` est un ledger APPEND-ONLY. Jusqu'au 2026-09-08, cet invariant ne
-- tenait que par la discipline de relecture : la RLS ne verrouille que `authenticated`,
-- et toute RPC SECURITY DEFINER pouvait donc réécrire une ligne sans que rien ne
-- l'arrête. `finalize_opname_v3` le faisait — seule fonction du schéma dans ce cas.
--
-- Depuis que la primitive pose la référence à l'insertion, plus aucune fonction n'a
-- besoin de réécrire le ledger. L'invariant devient VÉRIFIABLE, et ce fichier le
-- vérifie : c'est le vrai gain du lot, plus encore que la correction de l'opname.
--
-- Lancer via MCP execute_sql (enveloppe BEGIN … ROLLBACK portée par ce fichier).

BEGIN;
SELECT plan(6);

-- ── T1/T2 : l'invariant, asserté sur TOUT le schéma.
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND pg_get_functiondef(p.oid) ~* 'UPDATE\s+(public\.)?stock_movements'),
  0, 'T1 aucune fonction du schéma ne fait UPDATE sur stock_movements');

SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND pg_get_functiondef(p.oid) ~* 'DELETE\s+FROM\s+(public\.)?stock_movements'),
  0, 'T2 aucune fonction du schéma ne fait DELETE sur stock_movements');

-- ── T3 : la RLS ne porte aucune policy d'écriture destructive.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'stock_movements'
      AND cmd IN ('UPDATE', 'DELETE', 'ALL')),
  0, 'T3 aucune policy UPDATE/DELETE/ALL sur stock_movements');

-- ── T4/T5/T6 : la primitive pose la référence À L'INSERTION.
DO $do$
DECLARE
  v_auth UUID; v_cat UUID; v_prod UUID; v_ref UUID := gen_random_uuid(); v_res JSONB;
BEGIN
  SELECT up.auth_user_id INTO v_auth FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'inventory.read') LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);

  SELECT id INTO v_cat FROM categories WHERE deleted_at IS NULL LIMIT 1;
  INSERT INTO products (sku, name, category_id, retail_price, unit, current_stock, track_inventory, deduct_stock)
    VALUES ('F2-REF', 'F2 reference product', v_cat, 0, 'pcs', 100, true, true)
    RETURNING id INTO v_prod;

  -- Avec référence en métadonnée.
  v_res := record_stock_movement_v1(
    p_product_id    := v_prod,
    p_movement_type := 'adjustment_in'::movement_type,
    p_quantity      := 5,
    p_reason        := 'F2 test avec reference',
    p_metadata      := jsonb_build_object('reference_type', 'opname', 'reference_id', v_ref));
  PERFORM set_config('breakery.f2_avec', (v_res->>'movement_id'), true);
  PERFORM set_config('breakery.f2_ref',  v_ref::text, true);

  -- Sans référence : compatibilité des huit appelants qui n'en passent aucune.
  v_res := record_stock_movement_v1(
    p_product_id    := v_prod,
    p_movement_type := 'adjustment_in'::movement_type,
    p_quantity      := 3,
    p_reason        := 'F2 test sans reference');
  PERFORM set_config('breakery.f2_sans', (v_res->>'movement_id'), true);
  PERFORM set_config('breakery.f2_prod', v_prod::text, true);
END $do$;

SELECT is(
  (SELECT sm.reference_type || '|' || sm.reference_id::text FROM stock_movements sm
    WHERE sm.id = current_setting('breakery.f2_avec')::uuid),
  'opname|' || current_setting('breakery.f2_ref'),
  'T4 la référence de la métadonnée est posée à l''insertion');

-- Contrôle POSITIF de compatibilité : sans lui, une primitive qui écrirait NULL
-- partout passerait T4 sans rien prouver sur les appelants existants.
SELECT is(
  (SELECT sm.reference_type FROM stock_movements sm
    WHERE sm.id = current_setting('breakery.f2_sans')::uuid),
  'admin_action', 'T5 sans métadonnée, reference_type reste admin_action');

SELECT throws_ok(
  format($q$ SELECT record_stock_movement_v1(%L::uuid, 'adjustment_in'::movement_type, 1,
              'F2 reference invalide', p_metadata := '{"reference_id":"pas-un-uuid"}'::jsonb) $q$,
         current_setting('breakery.f2_prod')),
  'P0002', NULL, 'T6 une reference_id mal formée échoue au lieu d''être avalée');

SELECT * FROM finish();
ROLLBACK;
