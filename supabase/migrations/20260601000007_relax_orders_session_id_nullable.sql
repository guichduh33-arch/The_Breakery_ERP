-- 20260601000007_relax_orders_session_id_nullable.sql
-- Session 24 / Phase 1.A.1 / migration 3
--
-- Une commande B2B est créée depuis le backoffice (pas le POS), donc n'a pas
-- de pos_session associée. On relax la contrainte NOT NULL sur session_id +
-- on ajoute une CHECK conditionnelle qui force session_id NOT NULL sauf si
-- order_type='b2b'.
--
-- Compatible avec rows existantes : toutes les orders pré-S24 ont session_id
-- NOT NULL (POS path), donc la CHECK passe trivialement.

ALTER TABLE orders ALTER COLUMN session_id DROP NOT NULL;

ALTER TABLE orders
  ADD CONSTRAINT orders_session_id_required_for_pos
  CHECK (session_id IS NOT NULL OR order_type = 'b2b');

COMMENT ON COLUMN orders.session_id IS
  'POS session_id requis pour commandes dine_in/take_out/delivery ; NULL autorisé si order_type=b2b (S24).';
