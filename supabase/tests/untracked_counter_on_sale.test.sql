-- S1-11 — vendre un produit non suivi ne change pas son compteur ; vendre un
-- produit suivi le change. Le mouvement de stock reste écrit dans les deux cas.
-- Transaction annulée.
BEGIN;
SELECT plan(9);

CREATE TEMP TABLE _ids AS
SELECT gen_random_uuid() AS trk, gen_random_uuid() AS unt,
       (SELECT id FROM categories LIMIT 1) AS cat,
       (SELECT id FROM user_profiles LIMIT 1) AS prof,
       gen_random_uuid() AS ord;
INSERT INTO products (id, sku, name, category_id, retail_price, current_stock, unit, track_inventory, is_display_item)
SELECT trk, 'S111-TRK-' || left(trk::text, 8), 's1-11 tracked', cat, 1000, 10, 'pcs', true, false FROM _ids;
INSERT INTO products (id, sku, name, category_id, retail_price, current_stock, unit, track_inventory, is_display_item)
SELECT unt, 'S111-UNT-' || left(unt::text, 8), 's1-11 untracked', cat, 1000, 5, 'pcs', false, false FROM _ids;

-- Vente.
DO $$ DECLARE r record; BEGIN SELECT * INTO r FROM _ids;
  PERFORM _record_sale_stock_v1(r.trk, 3, r.ord, r.prof, 's', p_allow_negative := false);
  PERFORM _record_sale_stock_v1(r.unt, 3, r.ord, r.prof, 's', p_allow_negative := false);
END $$;

SELECT is((SELECT current_stock FROM products WHERE id = (SELECT trk FROM _ids)), 7::numeric,
  'vente d''un produit suivi : le compteur baisse');
SELECT is((SELECT current_stock FROM products WHERE id = (SELECT unt FROM _ids)), 5::numeric,
  'vente d''un produit non suivi : le compteur ne bouge pas');
SELECT is((SELECT count(*)::int FROM stock_movements
            WHERE product_id = (SELECT unt FROM _ids) AND movement_type = 'sale'), 1,
  'vente d''un produit non suivi : le mouvement de vente reste écrit');

-- Un produit non suivi se vend au-delà de son compteur, même sans stock négatif autorisé.
SELECT lives_ok(
  format($q$SELECT _record_sale_stock_v1(%L::uuid, 50, %L::uuid, %L::uuid, 's', p_allow_negative := false)$q$,
         (SELECT unt FROM _ids), (SELECT ord FROM _ids), (SELECT prof FROM _ids)),
  'produit non suivi : aucune garde de solde');
SELECT is((SELECT current_stock FROM products WHERE id = (SELECT unt FROM _ids)), 5::numeric,
  'produit non suivi : le compteur reste à 5 après une vente de 50');

-- Restitution (annulation, remboursement) : symétrique.
DO $$ DECLARE r record; BEGIN SELECT * INTO r FROM _ids;
  PERFORM _restore_sale_stock_v1(r.trk, 1, r.ord, r.prof, 'v', 'sale_void', 'order');
  PERFORM _restore_sale_stock_v1(r.unt, 1, r.ord, r.prof, 'v', 'sale_void', 'order');
END $$;
SELECT is((SELECT current_stock FROM products WHERE id = (SELECT trk FROM _ids)), 8::numeric,
  'restitution d''un produit suivi : le compteur remonte');
SELECT is((SELECT current_stock FROM products WHERE id = (SELECT unt FROM _ids)), 5::numeric,
  'restitution d''un produit non suivi : le compteur ne bouge pas');

-- Perte sur commande annulée.
DO $$ DECLARE r record; BEGIN SELECT * INTO r FROM _ids;
  PERFORM _record_cancel_waste_stock_v1(r.unt, 2, 'cancel', r.ord, NULL, r.prof, NULL);
END $$;
SELECT is((SELECT current_stock FROM products WHERE id = (SELECT unt FROM _ids)), 5::numeric,
  'perte sur annulation d''un produit non suivi : le compteur ne bouge pas');

-- Le produit suivi garde sa garde de solde.
SELECT throws_ok(
  format($q$SELECT _record_sale_stock_v1(%L::uuid, 100, %L::uuid, %L::uuid, 's', p_allow_negative := false)$q$,
         (SELECT trk FROM _ids), (SELECT ord FROM _ids), (SELECT prof FROM _ids)),
  'P0002', NULL, 'produit suivi, stock insuffisant, stock négatif interdit : refus');

SELECT * FROM finish();
ROLLBACK;
