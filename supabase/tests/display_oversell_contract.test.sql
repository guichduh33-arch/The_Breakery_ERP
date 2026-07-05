-- display_oversell_contract.test.sql — S61 F-2
-- Contrat d'erreur des gardes d'insuffisance de _record_sale_stock_v1 :
--   T1 : display, flag OFF, stock insuffisant → P0002 (était P0001)
--   T2 : display, flag ON,  stock insuffisant → P0002 (était 23514 via CHECK)
--   T3 : tracked non-display, flag OFF, stock 0 → P0002 (était P0001)
--   T4 : display, stock suffisant → déduction OK (display_stock 5-2=3, pas de régression)
-- Lancer via MCP execute_sql (BEGIN…ROLLBACK porté par ce fichier).
BEGIN;
SELECT plan(4);

CREATE TEMP TABLE _ids AS
SELECT gen_random_uuid() AS disp, gen_random_uuid() AS trk,
       (SELECT id FROM categories LIMIT 1) AS cat,
       (SELECT id FROM user_profiles LIMIT 1) AS prof,
       gen_random_uuid() AS ord;
INSERT INTO products (id, sku, name, category_id, retail_price, current_stock, unit, is_display_item)
SELECT disp, 'S61F2-DISP', 's61 disp', cat, 1000, 100, 'pcs', true FROM _ids;
INSERT INTO products (id, sku, name, category_id, retail_price, current_stock, unit, track_inventory, is_display_item)
SELECT trk, 'S61F2-TRK', 's61 trk', cat, 1000, 0, 'pcs', true, false FROM _ids;
-- le trigger display crée la ligne display_stock ; forcer quantity=5
UPDATE display_stock SET quantity = 5 WHERE product_id = (SELECT disp FROM _ids);

SELECT throws_ok(
  format($q$SELECT _record_sale_stock_v1(%L::uuid, 6, %L::uuid, %L::uuid, 't1', p_allow_negative := false)$q$,
         (SELECT disp FROM _ids), (SELECT ord FROM _ids), (SELECT prof FROM _ids)),
  'P0002', NULL, 'T1: display oversell flag OFF -> P0002');

SELECT throws_ok(
  format($q$SELECT _record_sale_stock_v1(%L::uuid, 6, %L::uuid, %L::uuid, 't2', p_allow_negative := true)$q$,
         (SELECT disp FROM _ids), (SELECT ord FROM _ids), (SELECT prof FROM _ids)),
  'P0002', NULL, 'T2: display oversell flag ON -> P0002 (garde inconditionnelle, plus de 23514)');

SELECT throws_ok(
  format($q$SELECT _record_sale_stock_v1(%L::uuid, 1, %L::uuid, %L::uuid, 't3', p_allow_negative := false)$q$,
         (SELECT trk FROM _ids), (SELECT ord FROM _ids), (SELECT prof FROM _ids)),
  'P0002', NULL, 'T3: tracked non-display insuffisant flag OFF -> P0002');

SELECT lives_ok(
  format($q$SELECT _record_sale_stock_v1(%L::uuid, 2, %L::uuid, %L::uuid, 't4', p_allow_negative := false)$q$,
         (SELECT disp FROM _ids), (SELECT ord FROM _ids), (SELECT prof FROM _ids)),
  'T4: display avec stock suffisant passe');
SELECT * FROM finish();
ROLLBACK;
