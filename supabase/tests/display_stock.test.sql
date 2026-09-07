-- supabase/tests/display_stock.test.sql
-- pgTAP — 4 RPCs gestes vitrine + isolation BO + REVOKE pairs.
-- Exécuter via MCP execute_sql (BEGIN..ROLLBACK). Valide les RPC déjà appliquées sur le cloud.
BEGIN;
SELECT plan(20);

-- ── Fixtures : un user avec display.manage, une catégorie, un produit display (cost_price>0), un non-display.
DO $$
DECLARE
  v_auth UUID; v_prof UUID; v_cat UUID; v_disp UUID; v_nondisp UUID;
BEGIN
  SELECT up.auth_user_id, up.id INTO v_auth, v_prof
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'display.manage')
   LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);

  SELECT id INTO v_cat FROM categories WHERE deleted_at IS NULL LIMIT 1;

  INSERT INTO products (sku, name, category_id, retail_price, cost_price, unit, is_display_item, current_stock)
    VALUES ('TEST-DISP-1', 'Test Display Croissant', v_cat, 25000, 8000, 'pcs', true, 100)
    RETURNING id INTO v_disp;
  INSERT INTO products (sku, name, category_id, retail_price, cost_price, unit, is_display_item, current_stock)
    VALUES ('TEST-NONDISP-1', 'Test Non Display', v_cat, 15000, 5000, 'pcs', false, 50)
    RETURNING id INTO v_nondisp;

  PERFORM set_config('breakery.t_disp', v_disp::text, true);
  PERFORM set_config('breakery.t_nondisp', v_nondisp::text, true);
END $$;

-- T1 : add_display_stock happy → display_stock = 10
SELECT is(
  (add_display_stock_v2(current_setting('breakery.t_disp')::uuid, 10, 'mise vitrine', gen_random_uuid())->>'new_display_stock')::numeric,
  10::numeric, 'T1 add_display_stock_v2 → 10');

-- T2 : add sur non-display → not_a_display_item (P0002)
SELECT throws_ok(
  $$ SELECT add_display_stock_v2(current_setting('breakery.t_nondisp')::uuid, 5, 'x', gen_random_uuid()) $$,
  'P0002', NULL, 'T2 add on non-display raises not_a_display_item');

-- T3 : add idempotent replay (même clé → pas de double)
DO $$ DECLARE k UUID := gen_random_uuid(); r1 JSONB; r2 JSONB;
BEGIN
  r1 := add_display_stock_v2(current_setting('breakery.t_disp')::uuid, 7, 'x', k);
  r2 := add_display_stock_v2(current_setting('breakery.t_disp')::uuid, 7, 'x', k);
  PERFORM set_config('breakery.t3a', (r1->>'new_display_stock'), true);
  PERFORM set_config('breakery.t3b', (r2->>'new_display_stock'), true);
  PERFORM set_config('breakery.t3replay', (r2->>'idempotent_replay'), true);
END $$;
SELECT is(current_setting('breakery.t3a'), current_setting('breakery.t3b'), 'T3 idempotent replay same qty');
SELECT is(current_setting('breakery.t3replay'), 'true', 'T3 replay flag true');

-- T4 : return_to_kitchen happy → current_stock inchangé
DO $$ DECLARE cs_before NUMERIC; cs_after NUMERIC;
BEGIN
  SELECT current_stock INTO cs_before FROM products WHERE id = current_setting('breakery.t_disp')::uuid;
  PERFORM return_display_to_kitchen_v2(current_setting('breakery.t_disp')::uuid, 3, 'retour', gen_random_uuid());
  SELECT current_stock INTO cs_after FROM products WHERE id = current_setting('breakery.t_disp')::uuid;
  PERFORM set_config('breakery.t4cs', (cs_before = cs_after)::text, true);
END $$;
SELECT is(current_setting('breakery.t4cs'), 'true', 'T4 return_to_kitchen leaves current_stock unchanged');

-- T5 : return garde insuffisant (P0002)
SELECT throws_ok(
  $$ SELECT return_display_to_kitchen_v2(current_setting('breakery.t_disp')::uuid, 99999, 'x', gen_random_uuid()) $$,
  'P0002', NULL, 'T5 return insufficient_display_stock');

-- T6/T7 : waste happy → display -q ET current_stock -q ET JE waste émis
DO $$ DECLARE disp_before NUMERIC; disp_after NUMERIC; cs_before NUMERIC; cs_after NUMERIC; je_count INT;
BEGIN
  SELECT quantity INTO disp_before FROM display_stock WHERE product_id = current_setting('breakery.t_disp')::uuid;
  SELECT current_stock INTO cs_before FROM products WHERE id = current_setting('breakery.t_disp')::uuid;
  PERFORM waste_display_stock_v2(current_setting('breakery.t_disp')::uuid, 2, 'spoiled', gen_random_uuid());
  SELECT quantity INTO disp_after FROM display_stock WHERE product_id = current_setting('breakery.t_disp')::uuid;
  SELECT current_stock INTO cs_after FROM products WHERE id = current_setting('breakery.t_disp')::uuid;
  SELECT count(*) INTO je_count FROM journal_entries je
    JOIN stock_movements sm ON sm.id = je.reference_id
    WHERE je.reference_type = 'stock_movement' AND je.metadata->>'movement_type' = 'waste'
      AND sm.product_id = current_setting('breakery.t_disp')::uuid;
  PERFORM set_config('breakery.t6disp', (disp_before - disp_after = 2)::text, true);
  PERFORM set_config('breakery.t6cs',   (cs_before  - cs_after  = 2)::text, true);
  PERFORM set_config('breakery.t7je',   (je_count >= 1)::text, true);
END $$;
SELECT is(current_setting('breakery.t6disp'), 'true', 'T6 waste deducts display_stock');
SELECT is(current_setting('breakery.t6cs'),   'true', 'T6 waste deducts current_stock');
SELECT is(current_setting('breakery.t7je'),   'true', 'T7 waste emits JE via tr_20_je_emit');

-- T8 : waste autorise current_stock négatif
DO $$ DECLARE cs NUMERIC;
BEGIN
  UPDATE products SET current_stock = 1 WHERE id = current_setting('breakery.t_disp')::uuid;
  PERFORM add_display_stock_v2(current_setting('breakery.t_disp')::uuid, 10, 'top up', gen_random_uuid());
  PERFORM waste_display_stock_v2(current_setting('breakery.t_disp')::uuid, 5, 'over', gen_random_uuid());
  SELECT current_stock INTO cs FROM products WHERE id = current_setting('breakery.t_disp')::uuid;
  PERFORM set_config('breakery.t8', (cs < 0)::text, true);
END $$;
SELECT is(current_setting('breakery.t8'), 'true', 'T8 waste allows current_stock to go negative');

-- T9 : adjust happy → display_stock = new_qty
SELECT is(
  (adjust_display_stock_v2(current_setting('breakery.t_disp')::uuid, 42, 'recount', gen_random_uuid())->>'new_display_stock')::numeric,
  42::numeric, 'T9 adjust sets display_stock to new_qty');

-- T10 : adjust reason requis (>= 3 chars)
SELECT throws_ok(
  $$ SELECT adjust_display_stock_v2(current_setting('breakery.t_disp')::uuid, 10, 'x', gen_random_uuid()) $$,
  'P0001', 'reason_required', 'T10 adjust requires reason >= 3 chars');

-- T11 : isolation — seul waste crée des stock_movements (reference_type='display_waste').
--        add/return/adjust n'en créent aucun → tous les sm du produit sont des display_waste.
DO $$ DECLARE total INT; waste_sm INT;
BEGIN
  SELECT count(*) INTO total    FROM stock_movements WHERE product_id = current_setting('breakery.t_disp')::uuid;
  SELECT count(*) INTO waste_sm FROM stock_movements WHERE product_id = current_setting('breakery.t_disp')::uuid AND reference_type = 'display_waste';
  PERFORM set_config('breakery.t11', (total = waste_sm AND total > 0)::text, true);
END $$;
SELECT is(current_setting('breakery.t11'), 'true', 'T11 only waste writes stock_movements (add/return/adjust isolated)');

-- T16-T18 : traçabilité (finding F4) — les gestes de vitrine nomment leur auteur.
--        Avant les _v2, display_movements traçait le QUOI et audit_logs restait vide :
--        0 ligne d'audit `display%` pour 16 mouvements de vitrine sur dev.
--        T18 vise la classe d'erreur miroir des P0 actor_id : audit_logs.actor_id a une
--        FK vers user_profiles(id), et tout compte créé par le back-office a
--        id <> auth_user_id — y poser auth.uid() échouerait en 23503.
DO $$ DECLARE dm_orphelins INT; sm_orphelins INT; acteurs_hors_profil INT;
BEGIN
  SELECT count(*) INTO dm_orphelins
    FROM display_movements dm
   WHERE dm.product_id = current_setting('breakery.t_disp')::uuid
     AND NOT EXISTS (SELECT 1 FROM audit_logs a
                      WHERE a.entity_type = 'display_movement' AND a.entity_id = dm.id);

  SELECT count(*) INTO sm_orphelins
    FROM stock_movements sm
   WHERE sm.product_id = current_setting('breakery.t_disp')::uuid
     AND NOT EXISTS (SELECT 1 FROM audit_logs a
                      WHERE a.action = 'stock.movement' AND a.entity_id = sm.id);

  SELECT count(*) INTO acteurs_hors_profil
    FROM audit_logs a
   WHERE a.action IN ('display.add','display.adjust','display.waste','display.return_to_kitchen')
     AND (a.actor_id IS NULL
          OR NOT EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = a.actor_id));

  PERFORM set_config('breakery.t16', (dm_orphelins = 0)::text, true);
  PERFORM set_config('breakery.t17', (sm_orphelins = 0)::text, true);
  PERFORM set_config('breakery.t18', (acteurs_hors_profil = 0)::text, true);
END $$;
SELECT is(current_setting('breakery.t16'), 'true', 'T16 chaque display_movement a sa ligne audit_logs');
SELECT is(current_setting('breakery.t17'), 'true', 'T17 la ligne de ledger du waste vitrine a son audit stock.movement');
SELECT is(current_setting('breakery.t18'), 'true', 'T18 audit_logs.actor_id est un user_profiles.id, jamais auth.uid()');

-- T12-T15 : REVOKE pairs — anon ne peut exécuter aucune des 4 RPC
SELECT is(has_function_privilege('anon','public.add_display_stock_v2(uuid,numeric,text,uuid)','EXECUTE'), false, 'T12 anon !exec add');
SELECT is(has_function_privilege('anon','public.return_display_to_kitchen_v2(uuid,numeric,text,uuid)','EXECUTE'), false, 'T13 anon !exec return');
SELECT is(has_function_privilege('anon','public.waste_display_stock_v2(uuid,numeric,text,uuid)','EXECUTE'), false, 'T14 anon !exec waste');
SELECT is(has_function_privilege('anon','public.adjust_display_stock_v2(uuid,numeric,text,uuid)','EXECUTE'), false, 'T15 anon !exec adjust');

SELECT * FROM finish();
ROLLBACK;
