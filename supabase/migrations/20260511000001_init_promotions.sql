-- 20260511000001_init_promotions.sql
-- Session 9 / migration 1 : promotions engine (auto-evaluated discounts)
-- Spec §3.1 — enums + table promotions with type-specific CHECK constraints,
-- date/hour range constraints, indexes, trigger, RLS.

CREATE TYPE promotion_type  AS ENUM ('percentage', 'fixed_amount', 'bogo', 'free_product');
CREATE TYPE promotion_scope AS ENUM ('cart', 'product', 'category');

CREATE TABLE promotions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                        TEXT NOT NULL,
  slug                        TEXT NOT NULL UNIQUE,
  description                 TEXT,
  type                        promotion_type NOT NULL,
  scope                       promotion_scope,                  -- NULL pour BOGO/free_product

  -- Percentage / Fixed amount config
  discount_value              DECIMAL(14,2)
                              CHECK (discount_value IS NULL OR discount_value >= 0),
  max_discount_amount         DECIMAL(14,2)
                              CHECK (max_discount_amount IS NULL OR max_discount_amount >= 0),
  scope_product_ids           UUID[] NOT NULL DEFAULT '{}',     -- si scope=product
  scope_category_ids          UUID[] NOT NULL DEFAULT '{}',     -- si scope=category

  -- BOGO config
  bogo_trigger_product_ids    UUID[] NOT NULL DEFAULT '{}',
  bogo_reward_product_ids     UUID[] NOT NULL DEFAULT '{}',
  bogo_trigger_qty            INTEGER CHECK (bogo_trigger_qty IS NULL OR bogo_trigger_qty >= 1),
  bogo_reward_qty             INTEGER CHECK (bogo_reward_qty IS NULL OR bogo_reward_qty >= 1),
  bogo_reward_discount_pct    DECIMAL(5,2)
                              CHECK (bogo_reward_discount_pct IS NULL
                                     OR (bogo_reward_discount_pct >= 0 AND bogo_reward_discount_pct <= 100)),

  -- Free product config
  gift_product_id             UUID REFERENCES products(id) ON DELETE SET NULL,
  gift_qty                    INTEGER NOT NULL DEFAULT 1 CHECK (gift_qty >= 1),

  -- Conditions
  min_items_total             DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK (min_items_total >= 0),
  customer_category_ids       UUID[] NOT NULL DEFAULT '{}',
  customer_tier_ids           UUID[] NOT NULL DEFAULT '{}',
  start_at                    TIMESTAMPTZ,
  end_at                      TIMESTAMPTZ,
  day_of_week_mask            SMALLINT NOT NULL DEFAULT 127
                              CHECK (day_of_week_mask >= 0 AND day_of_week_mask <= 127),
  start_hour                  SMALLINT CHECK (start_hour IS NULL OR (start_hour >= 0 AND start_hour <= 23)),
  end_hour                    SMALLINT CHECK (end_hour   IS NULL OR (end_hour   >= 0 AND end_hour   <= 23)),

  -- Stacking
  priority                    INTEGER NOT NULL DEFAULT 0,
  stackable_with_promo        BOOLEAN NOT NULL DEFAULT false,
  stackable_with_manual       BOOLEAN NOT NULL DEFAULT true,

  -- Lifecycle
  is_active                   BOOLEAN NOT NULL DEFAULT true,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at                  TIMESTAMPTZ,

  -- Type-specific field requirements (P1 + P2 + P7 + P8)
  CONSTRAINT chk_promotion_type_fields CHECK (
    (type IN ('percentage', 'fixed_amount')
      AND discount_value IS NOT NULL AND scope IS NOT NULL)
    OR (type = 'bogo'
      AND array_length(bogo_trigger_product_ids, 1) >= 1
      AND array_length(bogo_reward_product_ids,  1) >= 1
      AND bogo_trigger_qty IS NOT NULL AND bogo_reward_qty IS NOT NULL
      AND bogo_reward_discount_pct IS NOT NULL)
    OR (type = 'free_product' AND gift_product_id IS NOT NULL)
  ),

  -- Date range valid (start < end if both set)
  CONSTRAINT chk_promotion_date_range CHECK (
    start_at IS NULL OR end_at IS NULL OR start_at < end_at
  ),

  -- Hour range valid (both set OR both null ; start < end)
  CONSTRAINT chk_promotion_hour_range CHECK (
    (start_hour IS NULL AND end_hour IS NULL)
    OR (start_hour IS NOT NULL AND end_hour IS NOT NULL AND start_hour < end_hour)
  )
);

-- Active promotions ordered by priority (used by evaluator + POS list query)
CREATE INDEX idx_promotions_active
  ON promotions(priority DESC, created_at DESC)
  WHERE is_active = true AND deleted_at IS NULL;

-- Type filter for backoffice list views
CREATE INDEX idx_promotions_type
  ON promotions(type)
  WHERE deleted_at IS NULL;

CREATE TRIGGER promotions_set_updated_at
  BEFORE UPDATE ON promotions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS (spec §3.5)
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read" ON promotions FOR SELECT
  USING (is_authenticated() AND deleted_at IS NULL);

CREATE POLICY "perm_create" ON promotions FOR INSERT
  WITH CHECK (has_permission(auth.uid(), 'promotions.create'));

CREATE POLICY "perm_update" ON promotions FOR UPDATE
  USING (has_permission(auth.uid(), 'promotions.update'));

-- Soft-delete = UPDATE deleted_at. We expose a separate UPDATE policy that requires
-- promotions.delete. Note: a user with promotions.update can already update non-deleted_at
-- columns via perm_update; perm_delete coexists and OR-merges (any matching policy passes).
CREATE POLICY "perm_delete" ON promotions FOR UPDATE
  USING (has_permission(auth.uid(), 'promotions.delete'));

COMMENT ON TABLE promotions IS
  'Session 9 — auto-evaluated promotions. 4 types (percentage/fixed_amount/bogo/free_product) with stacking (priority + flags) + conditions (date/dow/hour/min total/customer category+tier).';
