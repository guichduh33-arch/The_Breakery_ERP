-- supabase/tests/s2_01_stock_lots_retired.test.sql
-- S2-01 / S2-02 (volet base) / S2-08 — la mécanique de lots et de péremption
-- est retirée (ADR-004), la table `stock_lots` reste dormante.
--
-- Invariant inverse de l'ancien FIFO : un mouvement de sortie ne consulte plus
-- aucun lot, même quand un lot actif existe pour le produit ; un lot fourni
-- explicitement est refusé.
--
-- Exécution : MCP execute_sql ou `supabase db query`, enveloppe BEGIN/ROLLBACK,
-- aucune écriture conservée.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(20);

-- ============================================================
-- Objets retirés
-- ============================================================
SELECT hasnt_function('public', 'create_stock_lot_v1', 'create_stock_lot_v1 retirée');
SELECT hasnt_function('public', '_kitchen_stock_lot_v1', '_kitchen_stock_lot_v1 retirée');
SELECT hasnt_function('public', '_resolve_fifo_lot', '_resolve_fifo_lot retirée');
SELECT hasnt_function('public', 'get_expiring_lots_v1', 'get_expiring_lots_v1 retirée');
SELECT hasnt_function('public', 'mark_expired_lots_hourly', 'mark_expired_lots_hourly retirée');
SELECT hasnt_function('public', 'get_perishable_turnover_v1', 'S2-08 — get_perishable_turnover_v1 retirée');
SELECT hasnt_function('public', 'receive_purchase_order_v6', 'receive_purchase_order_v6 remplacée');
SELECT hasnt_function('public', 'revert_production_v4', 'revert_production_v4 remplacée');
SELECT hasnt_function('public', 'get_product_dashboard_v8', 'get_product_dashboard_v8 remplacée');
SELECT hasnt_column('public', 'business_config', 'production_yield_variance_threshold_pct',
  'S2-02 — le seuil d écart de rendement est retiré');

-- ============================================================
-- Ce qui survit
-- ============================================================
SELECT has_table('public', 'stock_lots', 'ADR-004 — stock_lots reste, dormante');
SELECT has_column('public', 'stock_movements', 'lot_id', 'stock_movements.lot_id reste (historique)');

SELECT ok(
  NOT has_function_privilege('anon', 'public.receive_purchase_order_v7(uuid,jsonb,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.revert_production_v5(uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.get_product_dashboard_v9(uuid,integer)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.receive_purchase_order_v7(uuid,jsonb,uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.revert_production_v5(uuid,text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.get_product_dashboard_v9(uuid,integer)', 'EXECUTE'),
  'Les trois versions neuves : authenticated oui, anon non');

SELECT ok(
  NOT has_function_privilege('authenticated',
    'public.record_stock_movement_v2(uuid,movement_type,numeric,text,numeric,uuid,uuid,text,uuid,uuid,jsonb,uuid,boolean)',
    'EXECUTE'),
  'La primitive du ledger reste fermée à authenticated');

-- Plus aucune fonction ne lit ni n'écrit stock_lots, sauf le rapport des pertes,
-- qui affiche le lot d'une perte passée.
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prokind = 'f'
      AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'extensions')
      AND p.proname <> 'get_wastage_report_v4'
      AND pg_get_functiondef(p.oid) ILIKE '%stock_lots%'),
  0,
  'Aucune fonction hors rapport des pertes ne cite stock_lots');

SELECT is(
  (SELECT count(*)::int FROM pg_proc p
    WHERE p.prokind = 'f' AND pg_get_functiondef(p.oid) ILIKE '%shelf_life%'
      AND p.proname ~ '^(receive_purchase_order|record_production|record_batch_production|record_kitchen_production)'),
  0,
  'Ni réception ni production ne lit la durée de conservation');

-- ============================================================
-- Comportement : un lot actif n'est plus consommé
-- ============================================================
CREATE TEMP TABLE s2_lot_fixture (product uuid, lot uuid);
DO $$
DECLARE v_p uuid := gen_random_uuid(); v_l uuid := gen_random_uuid();
BEGIN
  INSERT INTO products (id, sku, name, category_id, retail_price, current_stock, cost_price, unit,
                        product_type, is_active, track_inventory, deduct_stock, default_shelf_life_hours)
  VALUES (v_p, 'S201-' || v_p, 'S2-01 lot fixture',
          (SELECT id FROM categories WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1), 1000, 10, 100, 'pcs',
          'finished', true, true, true, 24);
  INSERT INTO stock_lots (id, product_id, quantity, unit, expires_at, status)
  VALUES (v_l, v_p, 5, 'pcs', now() + interval '1 day', 'active');
  INSERT INTO s2_lot_fixture VALUES (v_p, v_l);
END $$;

-- En session postgres, la primitive écrit au nom du profil SYSTEM.
SELECT lives_ok(
  format($q$SELECT record_stock_movement_v2(p_product_id := %L, p_movement_type := 'waste',
            p_quantity := -2, p_reason := 'S2-01 waste without lot')$q$,
         (SELECT product FROM s2_lot_fixture)),
  'Une perte passe sans lot');

SELECT is(
  (SELECT quantity FROM stock_lots WHERE id = (SELECT lot FROM s2_lot_fixture)),
  5::numeric,
  'Le lot actif n a pas été décrémenté');

SELECT ok(
  (SELECT lot_id IS NULL FROM stock_movements
    WHERE product_id = (SELECT product FROM s2_lot_fixture) AND movement_type = 'waste'),
  'Le mouvement ne porte aucun lot');

SELECT throws_ok(
  format($q$SELECT record_stock_movement_v2(p_product_id := %L, p_movement_type := 'waste',
            p_quantity := -1, p_reason := 'S2-01 explicit lot', p_lot_id := %L)$q$,
         (SELECT product FROM s2_lot_fixture), (SELECT lot FROM s2_lot_fixture)),
  'P0001', 'lot_tracking_retired',
  'Un lot fourni explicitement est refusé');

SELECT * FROM finish();
ROLLBACK;
