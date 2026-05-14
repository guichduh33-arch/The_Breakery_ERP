-- 20260517000081_extend_promotions_columns_phase_2c.sql
-- Session 13 / Phase 2.C — Part 2/2 : columns + CHECK constraint.
--
-- Companion to 20260517000080 (enum extension). Adds:
--   * `bogo_buy_quantity`, `bogo_get_quantity`, `bogo_get_product_id`
--     (new BOGO "buy N get M of product P" shape).
--   * `threshold_amount`, `threshold_type` (subtotal|quantity).
--   * `bundle_product_ids`, `bundle_price`.
-- Replaces `chk_promotion_type_fields` to validate every type's required
-- field combo (legacy BOGO array shape + new single-product shape both
-- accepted under `type='bogo'`).
--
-- See `docs/workplan/refs/2026-05-14-session-13-wave-2-deviations.md`
-- §D-W2-2C-04, §D-W2-2C-05, §D-W2-2C-06.

ALTER TABLE promotions
  ADD COLUMN IF NOT EXISTS bogo_buy_quantity      INTEGER
                            CHECK (bogo_buy_quantity IS NULL OR bogo_buy_quantity >= 1),
  ADD COLUMN IF NOT EXISTS bogo_get_quantity      INTEGER
                            CHECK (bogo_get_quantity IS NULL OR bogo_get_quantity >= 1),
  ADD COLUMN IF NOT EXISTS bogo_get_product_id    UUID
                            REFERENCES products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS threshold_amount       DECIMAL(14,2)
                            CHECK (threshold_amount IS NULL OR threshold_amount >= 0),
  ADD COLUMN IF NOT EXISTS threshold_type         TEXT
                            CHECK (threshold_type IS NULL
                                   OR threshold_type IN ('subtotal','quantity')),
  ADD COLUMN IF NOT EXISTS bundle_product_ids     UUID[],
  ADD COLUMN IF NOT EXISTS bundle_price           DECIMAL(14,2)
                            CHECK (bundle_price IS NULL OR bundle_price >= 0);

CREATE INDEX IF NOT EXISTS idx_promotions_bogo_get_product
  ON promotions(bogo_get_product_id)
  WHERE bogo_get_product_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE promotions
  DROP CONSTRAINT IF EXISTS chk_promotion_type_fields;

ALTER TABLE promotions
  ADD CONSTRAINT chk_promotion_type_fields CHECK (
    (type IN ('percentage', 'fixed_amount')
      AND discount_value IS NOT NULL
      AND scope IS NOT NULL)
    OR (type = 'bogo' AND (
      -- Legacy multi-product array shape (Session 9)
      (array_length(bogo_trigger_product_ids, 1) >= 1
       AND array_length(bogo_reward_product_ids,  1) >= 1
       AND bogo_trigger_qty IS NOT NULL
       AND bogo_reward_qty  IS NOT NULL
       AND bogo_reward_discount_pct IS NOT NULL)
      OR
      -- New single-product shape (Phase 2.C) — buy N get M of product P
      (bogo_buy_quantity   IS NOT NULL
       AND bogo_get_quantity  IS NOT NULL
       AND bogo_get_product_id IS NOT NULL)
    ))
    OR (type = 'free_product'
      AND gift_product_id IS NOT NULL)
    OR (type = 'threshold'
      AND threshold_amount IS NOT NULL
      AND threshold_type   IS NOT NULL
      AND discount_value   IS NOT NULL)
    OR (type = 'bundle'
      AND bundle_product_ids IS NOT NULL
      AND array_length(bundle_product_ids, 1) >= 2
      AND bundle_price IS NOT NULL)
  );

COMMENT ON COLUMN promotions.bogo_buy_quantity IS
  'Session 13 Phase 2.C — buy quantity for the new BOGO shape (any trigger product unless bogo_trigger_product_ids is also set).';
COMMENT ON COLUMN promotions.bogo_get_quantity IS
  'Session 13 Phase 2.C — free reward quantity in the new BOGO shape.';
COMMENT ON COLUMN promotions.bogo_get_product_id IS
  'Session 13 Phase 2.C — single reward SKU in the new BOGO shape.';
COMMENT ON COLUMN promotions.threshold_amount IS
  'Session 13 Phase 2.C — threshold trigger (rupiah if type=subtotal, units if type=quantity).';
COMMENT ON COLUMN promotions.threshold_type IS
  'Session 13 Phase 2.C — discriminates threshold_amount semantics: subtotal | quantity.';
COMMENT ON COLUMN promotions.bundle_product_ids IS
  'Session 13 Phase 2.C — bundle composition (all must be in cart with qty >= 1).';
COMMENT ON COLUMN promotions.bundle_price IS
  'Session 13 Phase 2.C — fixed bundle price ; discount = matched_subtotal - bundle_price.';
