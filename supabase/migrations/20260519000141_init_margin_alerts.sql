-- 20260519000141_init_margin_alerts.sql
-- Session 15 / Phase 5.A — margin_alerts table + RLS.
--
-- Holds one row per (currently-open OR historical) margin breach detected by
-- recompute_recipe_margins_v1. Each product has at most one open alert at any
-- given time (enforced by a partial unique index on product_id WHERE
-- acknowledged_at IS NULL). Acknowledging an alert (or auto-recovery from
-- the cron) closes it ; a new breach later creates a new row.
--
-- RLS :
--   - SELECT : reports.inventory.read (same level as Stock Variance).
--   - UPDATE : inventory.production.create (MANAGER+) — used to acknowledge ;
--             column-level guard via trigger restricts writes to
--             acknowledged_at / acknowledged_by / notes only.
--   - INSERT / DELETE : SECURITY DEFINER funcs only (no direct authenticated
--     writes). The recompute RPC owns all insertions.

CREATE TABLE margin_alerts (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id            UUID         NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  expected_margin_pct   DECIMAL(5,2) NOT NULL,
  target_margin_pct     DECIMAL(5,2) NOT NULL,
  delta_pct             DECIMAL(6,2) NOT NULL,
  cost_per_unit         DECIMAL(12,2) NOT NULL,
  selling_price         DECIMAL(12,2) NOT NULL,
  computed_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  acknowledged_at       TIMESTAMPTZ  NULL,
  acknowledged_by       UUID         NULL REFERENCES user_profiles(id) ON DELETE SET NULL,
  notes                 TEXT         NULL,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Each product can have at most ONE open alert at a time. Closed alerts
-- (acknowledged_at IS NOT NULL) are kept as history.
CREATE UNIQUE INDEX margin_alerts_one_open_per_product
  ON margin_alerts(product_id)
  WHERE acknowledged_at IS NULL;

CREATE INDEX idx_margin_alerts_product_computed
  ON margin_alerts(product_id, computed_at DESC);

CREATE INDEX idx_margin_alerts_open
  ON margin_alerts(computed_at DESC)
  WHERE acknowledged_at IS NULL;

CREATE TRIGGER margin_alerts_set_updated_at
  BEFORE UPDATE ON margin_alerts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────────────────
-- Column-level guard : authenticated users may only mutate
-- acknowledged_at / acknowledged_by / notes via direct UPDATE. The recompute
-- RPC runs as SECURITY DEFINER (owner postgres) and bypasses this trigger
-- by SET LOCAL session_replication_role = 'replica' is unnecessary because
-- the trigger checks current_user — postgres is allowed.
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_margin_alerts_ack_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Postgres / service_role / supabase_admin bypass (cron + RPC paths).
  IF current_user IN ('postgres','supabase_admin','service_role') THEN
    RETURN NEW;
  END IF;

  -- Authenticated callers may only touch the ack triad + notes.
  IF NEW.id                  IS DISTINCT FROM OLD.id
     OR NEW.product_id           IS DISTINCT FROM OLD.product_id
     OR NEW.expected_margin_pct  IS DISTINCT FROM OLD.expected_margin_pct
     OR NEW.target_margin_pct    IS DISTINCT FROM OLD.target_margin_pct
     OR NEW.delta_pct            IS DISTINCT FROM OLD.delta_pct
     OR NEW.cost_per_unit        IS DISTINCT FROM OLD.cost_per_unit
     OR NEW.selling_price        IS DISTINCT FROM OLD.selling_price
     OR NEW.computed_at          IS DISTINCT FROM OLD.computed_at
     OR NEW.created_at           IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'margin_alerts_ack_only'
      USING ERRCODE = 'P0001',
            DETAIL  = 'authenticated callers may only update acknowledged_at, acknowledged_by, notes';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER margin_alerts_ack_only_guard
  BEFORE UPDATE ON margin_alerts
  FOR EACH ROW EXECUTE FUNCTION enforce_margin_alerts_ack_only();

-- ──────────────────────────────────────────────────────────────────────────
-- RLS
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE margin_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "perm_read" ON margin_alerts
  FOR SELECT TO authenticated
  USING (has_permission(auth.uid(), 'reports.inventory.read'));

-- Acknowledge action gate. The column-level trigger restricts which columns
-- the authenticated caller can actually change.
CREATE POLICY "perm_update_ack" ON margin_alerts
  FOR UPDATE TO authenticated
  USING      (has_permission(auth.uid(), 'inventory.production.create'))
  WITH CHECK (has_permission(auth.uid(), 'inventory.production.create'));

-- INSERT / DELETE intentionally not granted to authenticated — only the
-- SECURITY DEFINER recompute RPC may insert (owner = postgres bypasses RLS),
-- and DELETE is reserved for service_role / admin cleanup.
REVOKE ALL ON margin_alerts FROM anon;
GRANT  SELECT, UPDATE ON margin_alerts TO authenticated;

COMMENT ON TABLE margin_alerts IS
  'Session 15 / Phase 5.A. One row per detected margin breach. Partial '
  'unique index ensures at most one OPEN alert per product. Acknowledged '
  'rows stay as history. Inserts via recompute_recipe_margins_v1 only.';

COMMENT ON COLUMN margin_alerts.delta_pct IS
  'expected_margin_pct - target_margin_pct. Negative = below target.';
COMMENT ON COLUMN margin_alerts.acknowledged_at IS
  'NULL = open. Set by Margin Watch UI or by auto-recovery from the cron.';
