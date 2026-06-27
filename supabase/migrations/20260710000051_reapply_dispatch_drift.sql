-- 20260710000051_reapply_dispatch_drift.sql
-- Session 50 / W1.1 — Idempotent reapply of dispatch objects from migrations
-- 030..043 (Spec B-1 Ph1+Ph2). Safe to apply even if all objects already
-- present : ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS + ADD, UPDATE
-- (no-op if data already migrated), CREATE OR REPLACE FUNCTION, REVOKE (no-op
-- if already revoked), CREATE INDEX IF NOT EXISTS.
--
-- ⚠️  Excludes the money-path RPC bodies (create_tablet_order_v2,
-- fire_counter_order_v4, complete_order_with_payment_v14,
-- create_product_v1, update_product_v1) — those are in-place replaces from
-- mig 042/043 that updated the dispatch_stations INSERT. Assuming the schema
-- is intact per CLAUDE.md caveat. If they are confirmed missing by MCP, the
-- team-lead must apply mig 042/043 directly.
--
-- ⚠️  GIN index on order_items.dispatch_stations: CREATE INDEX IF NOT EXISTS
-- without CONCURRENTLY (apply_migration runs in a transaction ; CONCURRENTLY
-- not allowed inside a txn). Small table in dev — safe.
--
-- DEV-S50-W1.1

-- ============================================================
-- Bloc 1 — categories.dispatch_station (mig 030)
-- ============================================================

-- 1a. Drop old CHECK constraint (allows 'bakery', missing 'display').
--     No-op if already dropped or if new constraint is already installed.
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_dispatch_station_check;

-- 1b. Migrate any residual 'bakery' values (idempotent : no-op if already 'display').
UPDATE categories  SET dispatch_station = 'display' WHERE dispatch_station = 'bakery';
UPDATE order_items SET dispatch_station = 'display' WHERE dispatch_station = 'bakery';

-- 1c. Re-add new constraint.
--     Runs after DROP IF EXISTS, so the constraint is always re-created cleanly.
ALTER TABLE categories
  ADD CONSTRAINT categories_dispatch_station_check
  CHECK (dispatch_station IN ('kitchen', 'barista', 'display', 'none'));

COMMENT ON COLUMN categories.dispatch_station IS
  'Station de dispatch de VENTE : kitchen | barista | display | none. '
  'Copié sur order_items.dispatch_station au send-to-kitchen. '
  'Distinct de la station de PRODUCTION (sections).';

COMMENT ON COLUMN order_items.dispatch_station IS
  'Copié de categories.dispatch_station au INSERT du RPC. '
  'Valeurs : kitchen | barista | display | none.';

-- ============================================================
-- Bloc 2 — mapping métier complet (mig 031, re-runnable UPDATEs)
-- ============================================================

-- barista
UPDATE categories SET dispatch_station = 'barista'
 WHERE category_type = 'finished' AND show_in_pos = true
   AND name IN ('Coffee', 'Speciale Latte', 'Special Drinks');

-- kitchen
UPDATE categories SET dispatch_station = 'kitchen'
 WHERE category_type = 'finished' AND show_in_pos = true
   AND name IN ('Panini', 'Simple Plate', 'Plate', 'Savoury', 'Sandwiches',
                'Savoury Croissant', 'Bagel', 'Classic Sandwiches',
                'Sandwiches Baguette');

-- display
UPDATE categories SET dispatch_station = 'display'
 WHERE category_type = 'finished' AND show_in_pos = true
   AND name IN ('Bread', 'Pastry', 'Viennoiserie', 'Buns', 'Cake',
                'Classic Breads', 'Classic Viennoiserie',
                'Individual Pastries', 'Others Viennoiserie',
                'Sourdough Breads', 'Savouries', 'Other drinks',
                'HASIL BOHEMI');

-- none (filet de sécurité : catégories non-POS ne doivent pas rester routées)
UPDATE categories SET dispatch_station = 'none'
 WHERE (show_in_pos = false OR category_type <> 'finished')
   AND dispatch_station <> 'none';

-- ============================================================
-- Bloc 3 — products.dispatch_stations + order_items.dispatch_stations (mig 040)
-- ============================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS dispatch_stations text[] NULL;

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS dispatch_stations text[] NULL;

-- DROP + ADD for CHECK constraint on products (idempotent via DROP IF EXISTS).
ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_dispatch_stations_check;
ALTER TABLE products
  ADD CONSTRAINT products_dispatch_stations_check
  CHECK (dispatch_stations IS NULL
    OR dispatch_stations <@ ARRAY['kitchen','barista','display']::text[]);

COMMENT ON COLUMN products.dispatch_stations IS
  'Override produit du routage de vente (multi-station). NULL = hériter '
  '[categories.dispatch_station]. Spec B-1 Ph2.';
COMMENT ON COLUMN order_items.dispatch_stations IS
  'Snapshot des stations résolues à la vente (multi). order_items.dispatch_station '
  '(single) = 1er élément, legacy. Spec B-1 Ph2.';

-- GIN index for KDS station-based reads.
-- Note: no CONCURRENTLY — apply_migration wraps in a transaction.
CREATE INDEX IF NOT EXISTS idx_oi_dispatch_stations_gin
  ON order_items USING GIN (dispatch_stations);

-- ============================================================
-- Bloc 4 — _resolve_dispatch_stations_v1 helper (mig 041)
-- ============================================================

CREATE OR REPLACE FUNCTION _resolve_dispatch_stations_v1(p_product_id uuid)
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT array_agg(u.s ORDER BY u.ord)
     FROM unnest(
       (SELECT COALESCE(p.dispatch_stations, ARRAY[c.dispatch_station])
        FROM products p
        JOIN categories c ON c.id = p.category_id
        WHERE p.id = p_product_id)
     ) WITH ORDINALITY AS u(s, ord)
     WHERE u.s <> 'none'),
    ARRAY[]::text[]);
$$;

-- Paire REVOKE S25 (pattern canonique 3 lignes, defense-in-depth).
-- Helper interne non appelable directement hors RPC.
REVOKE EXECUTE ON FUNCTION _resolve_dispatch_stations_v1(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION _resolve_dispatch_stations_v1(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION _resolve_dispatch_stations_v1(uuid) FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION _resolve_dispatch_stations_v1(uuid) IS
  'Spec B-1 Ph2 : résolution multi-station (override produit > catégorie). '
  'COALESCE(products.dispatch_stations, ARRAY[categories.dispatch_station]) '
  'filtré de none, ordre préservé (WITH ORDINALITY). {} si non routé.';
