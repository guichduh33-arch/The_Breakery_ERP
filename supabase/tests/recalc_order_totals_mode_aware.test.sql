-- supabase/tests/recalc_order_totals_mode_aware.test.sql
-- Lot 6a (2/8) — preuve de CÂBLAGE : `_recalc_order_totals` lit réellement le
-- réglage `business_config.tax_inclusive` via `_pb1_split_v1`.
--
-- Pourquoi ce test en plus de `recalc_order_totals_pb1_inclusive.test.sql` :
-- ce dernier prouve la NON-RÉGRESSION (mode inclusive, comportement d'origine
-- inchangé) — mais une formule figée en dur le passerait à l'identique. Seul un
-- test qui bascule le mode prouve que le réglage est devenu effectif sur cette
-- voie, et donc sur add/remove/update_order_item_v1 + hold_order_v1 qui y
-- délèguent tous.
--
-- La bascule est faite DANS la transaction et annulée par le ROLLBACK.
--
-- Run via MCP execute_sql wrapped in BEGIN/ROLLBACK.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

-- Taux figé à 10 % pour que les attendus ne dépendent pas de la config live.
UPDATE business_config SET tax_rate = 0.1000 WHERE id = 1;
-- Mode EXCLUSIVE : prix catalogue HT, le PB1 s'ajoute.
UPDATE business_config SET tax_inclusive = false WHERE id = 1;

DO $$
DECLARE
  v_cashier UUID := (SELECT id FROM user_profiles WHERE role_code='CASHIER' LIMIT 1);
  v_product UUID := (SELECT id FROM products WHERE is_active=true LIMIT 1);
  v_session UUID;
  v_order   UUID;
BEGIN
  -- Clôture transactionnelle d'une éventuelle session ouverte fuitée pour ce
  -- profil (annulée par le ROLLBACK final) — cf. S77 D-7.
  UPDATE pos_sessions SET status='closed', closed_at=now(), closed_by=v_cashier, closing_cash=0
   WHERE opened_by = v_cashier AND status='open';

  INSERT INTO pos_sessions (opened_by, opening_cash)
  VALUES (v_cashier, 100000) RETURNING id INTO v_session;

  INSERT INTO orders (order_number, session_id, served_by, order_type, status, subtotal, tax_amount, total)
  VALUES ('T-ORD-EXCL-' || gen_random_uuid()::text, v_session, v_cashier, 'dine_in', 'draft', 0, 0, 0)
  RETURNING id INTO v_order;

  -- Ligne unique, brut 100000 (prix HT en mode exclusive)
  INSERT INTO order_items (order_id, product_id, name_snapshot, quantity, unit_price, line_total)
  VALUES (v_order, v_product, 'Exclusive line', 1, 100000, 100000);

  PERFORM _recalc_order_totals(v_order);
  PERFORM set_config('breakery.excl_order', v_order::text, false);
END $$;

SELECT plan(3);

SELECT is(
  (SELECT subtotal FROM orders WHERE id = current_setting('breakery.excl_order')::uuid),
  100000::NUMERIC,
  'exclusive — subtotal == sum(line_total) == 100000 (inchangé par le mode)'
);

SELECT is(
  (SELECT tax_amount FROM orders WHERE id = current_setting('breakery.excl_order')::uuid),
  10000::NUMERIC,
  'exclusive — tax == round_idr(100000 * 0.1) == 10000 (part AJOUTÉE, pas extraite)'
);

SELECT is(
  (SELECT total FROM orders WHERE id = current_setting('breakery.excl_order')::uuid),
  110000::NUMERIC,
  'exclusive — total == subtotal + taxe == 110000 : le réglage est EFFECTIF'
);

SELECT * FROM finish();
ROLLBACK;
