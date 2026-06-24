-- 20260708000011_block_payment_on_historical_po.sql
-- Defense: a historical-import PO (reports-only) must never receive a recorded payment,
-- which would post a payment JE. receive/cancel are already blocked by their status guards.
-- NOTE: purchase_payments FK to the PO is `purchase_order_id` (verified against the schema).

CREATE OR REPLACE FUNCTION public.tr_block_payment_on_historical_po()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM purchase_orders
              WHERE id = NEW.purchase_order_id AND is_historical_import) THEN
    RAISE EXCEPTION 'cannot record a payment on a historical-import purchase order'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_payment_on_historical_po ON purchase_payments;
CREATE TRIGGER trg_block_payment_on_historical_po
  BEFORE INSERT ON purchase_payments
  FOR EACH ROW EXECUTE FUNCTION tr_block_payment_on_historical_po();

COMMENT ON TRIGGER trg_block_payment_on_historical_po ON purchase_payments IS
  'Phase 2a — blocks payments against reports-only historical-import POs (no payment JE).';
