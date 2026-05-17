-- 20260523000020_add_session_timeout_to_roles.sql
-- Session 19 / Phase 1.B — Per-role session timeout (Thread B).
--
-- Decision refs : D6 (security-leaning defaults), D8 (per-role, not per-user),
-- D19 (migration block 20260523000019..021 = Thread B).
--
-- Default profile (D6) :
--   CASHIER     → 30  (high turnover, walk-up risk)
--   waiter      → 30  (same)
--   MANAGER     → 60
--   ADMIN       → 120
--   SUPER_ADMIN → 240
--
-- Bounds : 5 minutes (avoid lockout loop) .. 480 minutes (8h shift cap).

ALTER TABLE roles
  ADD COLUMN IF NOT EXISTS session_timeout_minutes INT NOT NULL DEFAULT 30
    CHECK (session_timeout_minutes BETWEEN 5 AND 480);

UPDATE roles SET session_timeout_minutes = 30  WHERE code = 'CASHIER';
UPDATE roles SET session_timeout_minutes = 30  WHERE code = 'waiter';
UPDATE roles SET session_timeout_minutes = 60  WHERE code = 'MANAGER';
UPDATE roles SET session_timeout_minutes = 120 WHERE code = 'ADMIN';
UPDATE roles SET session_timeout_minutes = 240 WHERE code = 'SUPER_ADMIN';

COMMENT ON COLUMN roles.session_timeout_minutes IS
  'Idle session timeout in minutes. Read by useIdleTimeout in apps. '
  'Editable via update_role_session_timeout_v1 RPC. Bounds: 5..480.';
