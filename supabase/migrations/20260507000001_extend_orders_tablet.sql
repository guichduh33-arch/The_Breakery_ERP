-- 20260507000001_extend_orders_tablet.sql
-- Session 5 / migration 1 : extend orders for tablet ordering
-- Adds created_via, waiter_id, sent_to_kitchen_at on orders row.
-- Makes session_id + served_by nullable (tablet orders have no POS session at creation).
-- Extends order_status enum with 'pending_payment'.
-- Updates has_permission() to recognise 'waiter' role_code.

-- 1. Extend order_status ENUM
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'pending_payment';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'completed';

-- 2. Make orders.session_id + served_by nullable (tablet orders created before POS pickup)
ALTER TABLE orders
  ALTER COLUMN session_id DROP NOT NULL,
  ALTER COLUMN served_by DROP NOT NULL;

-- 3. Add tablet columns
ALTER TABLE orders
  ADD COLUMN created_via TEXT NOT NULL DEFAULT 'pos'
    CHECK (created_via IN ('pos', 'tablet')),
  ADD COLUMN waiter_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN sent_to_kitchen_at TIMESTAMPTZ;

-- 4. Sparse index for POS hub inbox query (tablet pending_payment, ordered newest first)
CREATE INDEX idx_orders_pending_tablet
  ON orders(sent_to_kitchen_at DESC)
  WHERE status = 'pending_payment' AND created_via = 'tablet';

-- 5. Update has_permission() to add 'waiter' role_code mapping
CREATE OR REPLACE FUNCTION has_permission(p_uid UUID, p_perm TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role_code INTO v_role FROM user_profiles WHERE auth_user_id = p_uid AND deleted_at IS NULL;
  IF v_role IS NULL THEN
    RETURN false;
  END IF;

  RETURN CASE
    WHEN v_role IN ('SUPER_ADMIN', 'ADMIN') THEN true
    WHEN v_role = 'MANAGER' THEN p_perm IN (
      'pos.session.open','pos.session.close_own','pos.session.close_other',
      'pos.session.view_all','pos.sale.create','pos.sale.void','pos.sale.update',
      'products.read','products.create','products.update'
    )
    WHEN v_role = 'CASHIER' THEN p_perm IN (
      'pos.session.open','pos.session.close_own','pos.sale.create','products.read',
      'payments.process'
    )
    WHEN v_role = 'waiter' THEN p_perm IN ('sales.create', 'products.read')
    ELSE false
  END;
END $$;

COMMENT ON FUNCTION has_permission IS
  'v2: adds waiter role_code mapping (sales.create, products.read). CASHIER gains payments.process.';
