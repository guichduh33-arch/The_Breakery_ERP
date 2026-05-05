-- 20260508000001_add_discount_columns.sql
-- Session 6 — add discount columns to orders (cart-level) and order_items (line-level).
-- NET method (D6): orders.discount_amount is stored for analytics; no separate JE line.
-- orders.discount_authorized_by nullable FK tracks which manager approved > threshold discounts.

ALTER TABLE orders
  ADD COLUMN discount_amount        DECIMAL(14,2) NOT NULL DEFAULT 0
    CHECK (discount_amount >= 0),
  ADD COLUMN discount_type          TEXT
    CHECK (discount_type IS NULL OR discount_type IN ('percentage', 'fixed_amount')),
  ADD COLUMN discount_value         DECIMAL(14,2)
    CHECK (discount_value IS NULL OR discount_value >= 0),
  ADD COLUMN discount_reason        TEXT,
  ADD COLUMN discount_authorized_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL;

ALTER TABLE order_items
  ADD COLUMN discount_amount DECIMAL(14,2) NOT NULL DEFAULT 0
    CHECK (discount_amount >= 0),
  ADD COLUMN discount_type   TEXT
    CHECK (discount_type IS NULL OR discount_type IN ('percentage', 'fixed_amount')),
  ADD COLUMN discount_value  DECIMAL(14,2)
    CHECK (discount_value IS NULL OR discount_value >= 0),
  ADD COLUMN discount_reason TEXT;

COMMENT ON COLUMN orders.discount_amount        IS 'Cart-level absolute discount in IDR (post-compute, net method)';
COMMENT ON COLUMN orders.discount_type          IS 'percentage | fixed_amount — how discount_value was entered';
COMMENT ON COLUMN orders.discount_value         IS 'Raw user input: 10 if percentage, 5000 if fixed_amount';
COMMENT ON COLUMN orders.discount_reason        IS 'Required reason text (>= 5 chars enforced client-side)';
COMMENT ON COLUMN orders.discount_authorized_by IS 'Manager who authorised the discount when above threshold';

COMMENT ON COLUMN order_items.discount_amount IS 'Line-level absolute discount in IDR';
COMMENT ON COLUMN order_items.discount_type   IS 'percentage | fixed_amount';
COMMENT ON COLUMN order_items.discount_value  IS 'Raw user input value';
COMMENT ON COLUMN order_items.discount_reason IS 'Reason for line-level discount';
