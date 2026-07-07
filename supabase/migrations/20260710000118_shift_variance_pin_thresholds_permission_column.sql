-- 20260710000118_shift_variance_pin_thresholds_permission_column.sql
-- S66 (fiche 12 D2.1 / B1.4) — socle du PIN manager sur gros écart de clôture :
--   1. Seuils dédiés business_config (distincts et plus élevés que les seuils
--      note S60) — décision propriétaire 2026-07-07 : défauts 200 000 IDR / 2 %.
--   2. Permission shift.variance.approve (qui a le droit d'approuver un gros
--      écart) seedée aux 3 rôles manager — miroir du seed accounting.year.close.
--   3. pos_sessions.variance_approved_by : traçabilité requêtable de
--      l'approbateur (en plus du metadata audit_logs), servira au futur rapport
--      « écarts par caissier » (fiche 12 D2.4).
-- La garde serveur elle-même arrive dans close_shift_v4 (_119).

ALTER TABLE business_config
  ADD COLUMN shift_variance_pin_threshold_abs NUMERIC NOT NULL DEFAULT 200000
    CONSTRAINT business_config_shift_var_pin_abs_check CHECK (shift_variance_pin_threshold_abs >= 0),
  ADD COLUMN shift_variance_pin_threshold_pct NUMERIC NOT NULL DEFAULT 0.02
    CONSTRAINT business_config_shift_var_pin_pct_check CHECK (shift_variance_pin_threshold_pct >= 0);

INSERT INTO permissions (code, module, action, description) VALUES
  ('shift.variance.approve', 'shift', 'variance.approve',
    'Approve a large shift-close cash variance (manager PIN gate, close_shift_v4)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('MANAGER',     'shift.variance.approve'),
  ('ADMIN',       'shift.variance.approve'),
  ('SUPER_ADMIN', 'shift.variance.approve')
ON CONFLICT (role_code, permission_code) DO NOTHING;

ALTER TABLE pos_sessions
  ADD COLUMN variance_approved_by UUID NULL REFERENCES user_profiles(id);

COMMENT ON COLUMN pos_sessions.variance_approved_by IS
  'S66: user_profiles.id of the manager who approved an above-PIN-threshold '
  'close variance via close_shift_v4 (NULL when the variance stayed below '
  'business_config.shift_variance_pin_threshold_abs/pct).';
