-- inventory_allow_negative.test.sql
-- Vérifie le paramètre p_allow_negative de record_stock_movement_v1 (Task 2).
-- record_stock_movement_v1 est un primitive INTERNE (REVOKE authenticated) →
-- testé via pgTAP/execute_sql en contexte postgres (profil SYSTEM), pas via
-- un client Vitest authentifié.
--
-- Lancer via MCP execute_sql, enveloppe BEGIN … ROLLBACK (ce fichier la porte).

BEGIN;
SELECT plan(3);

-- Fixture : un produit suivi, current_stock forcé à 1 dans la transaction.
DO $$
DECLARE v_pid uuid;
BEGIN
  SELECT id INTO v_pid FROM products WHERE track_inventory = true ORDER BY created_at LIMIT 1;
  IF v_pid IS NULL THEN RAISE EXCEPTION 'fixture: no tracked product found'; END IF;
  UPDATE products SET current_stock = 1 WHERE id = v_pid;
  -- Mémorise l'id pour les assertions suivantes.
  CREATE TEMP TABLE _ctx(pid uuid) ON COMMIT DROP;
  INSERT INTO _ctx VALUES (v_pid);
END $$;

-- 1. Défaut (p_allow_negative absent) : sortie > stock → insufficient_stock (P0002).
SELECT throws_ok(
  format($$ SELECT record_stock_movement_v1(
       p_product_id := %L::uuid, p_movement_type := 'adjustment',
       p_quantity := -5, p_reason := 'test neg block') $$, (SELECT pid FROM _ctx)),
  'P0002', NULL,
  'blocks negative when p_allow_negative defaults false');

-- 2. p_allow_negative := true → la sortie passe (pas d'exception).
SELECT lives_ok(
  format($$ SELECT record_stock_movement_v1(
       p_product_id := %L::uuid, p_movement_type := 'adjustment',
       p_quantity := -5, p_reason := 'test neg allow', p_allow_negative := true) $$,
       (SELECT pid FROM _ctx)),
  'allows negative when p_allow_negative := true');

-- 3. Le stock résultant est bien négatif (1 - 5 = -4).
SELECT is(
  (SELECT current_stock FROM products WHERE id = (SELECT pid FROM _ctx)),
  -4::numeric(10,3),
  'current_stock went negative to -4 after the allowed movement');

SELECT * FROM finish();
ROLLBACK;
