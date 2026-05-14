-- Session 13 / Phase 3.C — Migration 136
-- Variance thresholds on business_config + new permissions for shift /
-- B2B / reservations workflows.

ALTER TABLE business_config
  ADD COLUMN IF NOT EXISTS shift_variance_threshold_pct NUMERIC(6,4) NOT NULL DEFAULT 0.0050,
  ADD COLUMN IF NOT EXISTS shift_variance_threshold_abs NUMERIC(14,2) NOT NULL DEFAULT 50000;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'business_config_shift_variance_pct_range'
  ) THEN
    ALTER TABLE business_config
      ADD CONSTRAINT business_config_shift_variance_pct_range
        CHECK (shift_variance_threshold_pct >= 0 AND shift_variance_threshold_pct <= 1);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'business_config_shift_variance_abs_nonneg'
  ) THEN
    ALTER TABLE business_config
      ADD CONSTRAINT business_config_shift_variance_abs_nonneg
        CHECK (shift_variance_threshold_abs >= 0);
  END IF;
END $$;

COMMENT ON COLUMN business_config.shift_variance_threshold_pct IS
  'Shift-close variance alert threshold as a fraction of expected_cash (0.005 = 0.5%).';
COMMENT ON COLUMN business_config.shift_variance_threshold_abs IS
  'Shift-close variance alert threshold in absolute IDR (50000 default). Triggers UI warning when |variance| exceeds it.';

INSERT INTO business_config (id, name)
VALUES (1, 'The Breakery')
ON CONFLICT (id) DO NOTHING;

INSERT INTO permissions (code, module, action, description)
VALUES
  ('shift.open',                    'shift',    'create',
   'Open a POS session (sets opening cash).'),
  ('shift.close',                   'shift',    'update',
   'Close a POS session: compute variance, post variance JE.'),
  ('shift.cash_movement',           'shift',    'create',
   'Record mid-shift cash in/out adjustments.'),
  ('customers.b2b.update',          'customers','update',
   'Edit B2B-specific fields (company name, tax ID, credit limit, terms).'),
  ('inventory.reservation.create',  'inventory','create',
   'Create stock reservations (hold).'),
  ('inventory.reservation.release', 'inventory','update',
   'Release / consume stock reservations.')
ON CONFLICT (code) DO UPDATE
  SET description = EXCLUDED.description,
      module      = EXCLUDED.module,
      action      = EXCLUDED.action;

-- Role codes in this DB: ADMIN, SUPER_ADMIN, MANAGER, CASHIER, waiter.
INSERT INTO role_permissions (role_code, permission_code, is_granted)
VALUES
  ('SUPER_ADMIN','shift.open',                    TRUE),
  ('ADMIN',      'shift.open',                    TRUE),
  ('MANAGER',    'shift.open',                    TRUE),
  ('CASHIER',    'shift.open',                    TRUE),
  ('waiter',     'shift.open',                    TRUE),
  ('SUPER_ADMIN','shift.close',                   TRUE),
  ('ADMIN',      'shift.close',                   TRUE),
  ('MANAGER',    'shift.close',                   TRUE),
  ('SUPER_ADMIN','shift.cash_movement',           TRUE),
  ('ADMIN',      'shift.cash_movement',           TRUE),
  ('MANAGER',    'shift.cash_movement',           TRUE),
  ('SUPER_ADMIN','customers.b2b.update',          TRUE),
  ('ADMIN',      'customers.b2b.update',          TRUE),
  ('MANAGER',    'customers.b2b.update',          TRUE),
  ('SUPER_ADMIN','inventory.reservation.create',  TRUE),
  ('ADMIN',      'inventory.reservation.create',  TRUE),
  ('MANAGER',    'inventory.reservation.create',  TRUE),
  ('CASHIER',    'inventory.reservation.create',  TRUE),
  ('waiter',     'inventory.reservation.create',  TRUE),
  ('SUPER_ADMIN','inventory.reservation.release', TRUE),
  ('ADMIN',      'inventory.reservation.release', TRUE),
  ('MANAGER',    'inventory.reservation.release', TRUE),
  ('CASHIER',    'inventory.reservation.release', TRUE),
  ('waiter',     'inventory.reservation.release', TRUE)
ON CONFLICT (role_code, permission_code) DO UPDATE SET is_granted = TRUE;
