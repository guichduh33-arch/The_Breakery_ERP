-- batch_production_flag_negative.test.sql
-- ADR-008 D4 — gate stock-négatif du batch. ADR-016 (20260729000001) a fusionné
-- l'ancienne impl _v3 et son wrapper de date _v4 en un seul orchestrateur, que
-- 20260729000003 (ADR-008 D5/D6) a depuis bumpé en record_batch_production_v6 :
-- on teste directement contre _v6.
-- Fixture bread<-flour est un recipe à un seul niveau (pas d'intermédiaire),
-- donc la règle "arrêt au premier intermédiaire stocké" d'ADR-016 ne change
-- aucune valeur attendue ici.
--   - par DÉFAUT le lot BLOQUE en matière insuffisante (P0002), même si le
--     réglage de vente `allow_negative_stock` vaut true → découplage prouvé
--   - p_batch.force_negative=true + permission → le lot passe, matière en négatif
--   - force_negative sans la permission → force_negative_forbidden (P0003)
--
-- Contexte JWT simulé d'EMP000 (SUPER_ADMIN, porteur du force) puis du MANAGER
-- (00000000-…-004, create sans force). Lancer via MCP execute_sql (enveloppe
-- BEGIN … ROLLBACK portée par ce fichier).

BEGIN;
SELECT plan(4);
SELECT set_config('request.jwt.claims',
  json_build_object('sub','00000000-0000-0000-0000-000000000001','role','authenticated')::text, true);

CREATE TEMP TABLE _r(label text, val numeric) ON COMMIT DROP;
DO $$
DECLARE
  v_cat uuid; v_sec uuid;
  v_flour uuid := gen_random_uuid(); v_bread uuid := gen_random_uuid();
  v_blocked boolean := false;
  v_denied  boolean := false;
BEGIN
  SELECT id INTO v_cat FROM categories LIMIT 1;
  SELECT id INTO v_sec FROM sections WHERE deleted_at IS NULL LIMIT 1;
  INSERT INTO products (id, sku, name, category_id, retail_price, unit, track_inventory, deduct_stock, current_stock) VALUES
    (v_flour, 'BF-'||v_flour, 'Flour', v_cat, 0, 'g',   true, false, 10),
    (v_bread, 'BB-'||v_bread, 'Bread', v_cat, 0, 'pcs', true, true,  0);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active) VALUES (v_bread, v_flour, 100, 'g', true);

  -- Le réglage de VENTE est ouvert : il ne doit plus ouvrir la production.
  UPDATE business_config SET allow_negative_stock=true WHERE id=1;

  -- 1) sans forçage → bloqué malgré le réglage global
  BEGIN
    PERFORM record_batch_production_v6(
      jsonb_build_object('section_id', v_sec::text, 'notes','t'),
      jsonb_build_array(jsonb_build_object('product_id', v_bread::text, 'quantity_produced', 1)));
    v_blocked := false;
  EXCEPTION WHEN OTHERS THEN v_blocked := (SQLSTATE='P0002');
  END;
  INSERT INTO _r VALUES ('blocked', v_blocked::int);

  -- 2) forçage sans la permission (MANAGER) → force_negative_forbidden
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000000004','role','authenticated')::text, true);
  BEGIN
    PERFORM record_batch_production_v6(
      jsonb_build_object('section_id', v_sec::text, 'notes','t', 'force_negative', true),
      jsonb_build_array(jsonb_build_object('product_id', v_bread::text, 'quantity_produced', 1)));
    v_denied := false;
  EXCEPTION WHEN OTHERS THEN v_denied := (SQLSTATE='P0003');
  END;
  INSERT INTO _r VALUES ('denied', v_denied::int);

  -- 3) forçage avec la permission (SUPER_ADMIN)
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
  PERFORM record_batch_production_v6(
    jsonb_build_object('section_id', v_sec::text, 'notes','t', 'force_negative', true),
    jsonb_build_array(jsonb_build_object('product_id', v_bread::text, 'quantity_produced', 1)));
  INSERT INTO _r VALUES ('flour', (SELECT current_stock FROM products WHERE id=v_flour));
  INSERT INTO _r VALUES ('bread', (SELECT current_stock FROM products WHERE id=v_bread));
END $$;

SELECT is((SELECT val FROM _r WHERE label='blocked'), 1::numeric,  'ADR-008 D4: batch blocks by default even when allow_negative_stock=true');
SELECT is((SELECT val FROM _r WHERE label='denied'),  1::numeric,  'batch force_negative without the permission raises P0003');
SELECT is((SELECT val FROM _r WHERE label='flour'),  -90::numeric, 'forced batch lets material go to -90');
SELECT is((SELECT val FROM _r WHERE label='bread'),   1::numeric,  'batch finished good produced (+1)');

SELECT * FROM finish();
ROLLBACK;
