-- 20260506000003_extend_kitchen_status_served.sql
-- Session 4 / migration 3 : extend kitchen_status CHECK + served_at/by columns
-- K1: 'served' est un 4e statut terminal après 'ready'
-- The constraint added in 20260505000003 is named order_items_kitchen_status_check

ALTER TABLE order_items
  DROP CONSTRAINT order_items_kitchen_status_check;

ALTER TABLE order_items
  ADD CONSTRAINT order_items_kitchen_status_check
  CHECK (kitchen_status IN ('pending', 'preparing', 'ready', 'served'));

ALTER TABLE order_items
  ADD COLUMN served_at TIMESTAMPTZ,
  ADD COLUMN served_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL;
