-- 20260517000150_add_categories_kds_station.sql
-- Session 13 / Phase 4.B — Schema extensions for KDS station routing + prep timer.
--
-- Adds :
--   * categories.kds_station TEXT  CHECK IN (hot|cold|bar|prep|expo) DEFAULT 'expo'
--   * order_items.prep_started_at TIMESTAMPTZ   (driven by kds_start_prep_timer_v1)
--   * order_items.bumped_at       TIMESTAMPTZ   (driven by kds_bump_item_v1)
-- Indexes :
--   * idx_categories_kds_station ON categories(kds_station) WHERE deleted_at IS NULL
--   * idx_oi_kds_prep_timer ON order_items(prep_started_at) WHERE prep_started_at IS NOT NULL
-- Seeds the legacy mapping :
--   dispatch_station='kitchen' → kds_station='hot'
--   dispatch_station='barista' → kds_station='bar'
--   dispatch_station='bakery'  → kds_station='prep'
--   dispatch_station='none'    → kds_station='expo'
-- Permissions :
--   * kds.operate (operate the KDS — bump, recall, undo, start prep timer)
--   * Grants : SUPER_ADMIN, ADMIN, MANAGER, CASHIER (waiter NOT granted).
--
-- Idempotent — uses IF NOT EXISTS guards and ON CONFLICT skips.
-- Spec ref : docs/workplan/plans/2026-05-13-session-13-phase-4.B-kds-ext.md

-- ===========================================================================
-- 1. categories.kds_station
-- ===========================================================================
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS kds_station TEXT
    NOT NULL DEFAULT 'expo'
    CHECK (kds_station IN ('hot', 'cold', 'bar', 'prep', 'expo'));

COMMENT ON COLUMN categories.kds_station IS
  'Phase 4.B KDS routing : hot=hot kitchen, cold=cold prep, bar=barista, prep=bakery prep, expo=expedite/pickup. '
  'Used by StationFilter UI ; the legacy dispatch_station column drives the realtime channel filter.';

CREATE INDEX IF NOT EXISTS idx_categories_kds_station
  ON categories(kds_station)
  WHERE deleted_at IS NULL;

-- Seed mapping from legacy dispatch_station. Idempotent : only updates rows
-- still at the default 'expo' AND whose dispatch_station has a recognised
-- mapping. Run twice → second run is noop because rows already in mapped state.
UPDATE categories SET kds_station = 'hot'
 WHERE dispatch_station = 'kitchen' AND kds_station = 'expo';

UPDATE categories SET kds_station = 'bar'
 WHERE dispatch_station = 'barista' AND kds_station = 'expo';

UPDATE categories SET kds_station = 'prep'
 WHERE dispatch_station = 'bakery' AND kds_station = 'expo';
-- 'none' → 'expo' is already the default, no update needed.

-- ===========================================================================
-- 2. order_items.prep_started_at + bumped_at
-- ===========================================================================
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS prep_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bumped_at       TIMESTAMPTZ;

COMMENT ON COLUMN order_items.prep_started_at IS
  'Phase 4.B : timestamp set by kds_start_prep_timer_v1 — drives the PrepTimer MM:SS display.';
COMMENT ON COLUMN order_items.bumped_at IS
  'Phase 4.B : timestamp set by kds_bump_item_v1 (preparing→ready). Used by kds_undo_bump_v1 to enforce the 60s undo window.';

CREATE INDEX IF NOT EXISTS idx_oi_kds_prep_timer
  ON order_items(prep_started_at)
  WHERE prep_started_at IS NOT NULL;

-- ===========================================================================
-- 3. Permission : kds.operate
-- ===========================================================================

INSERT INTO permissions (code, module, action, description) VALUES
  ('kds.operate', 'kds', 'update',
   'Operate the KDS — start prep timer, bump items to ready, recall served orders, undo bump within 60s.')
ON CONFLICT (code) DO NOTHING;

-- Grants — managers + cashiers are typical KDS operators.
INSERT INTO role_permissions (role_code, permission_code, is_granted) VALUES
  ('SUPER_ADMIN', 'kds.operate', TRUE),
  ('ADMIN',       'kds.operate', TRUE),
  ('MANAGER',     'kds.operate', TRUE),
  ('CASHIER',     'kds.operate', TRUE)
ON CONFLICT (role_code, permission_code) DO NOTHING;
