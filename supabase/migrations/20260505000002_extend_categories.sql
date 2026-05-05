-- 20260505000002_extend_categories.sql
-- Session 2 / migration 2 : routage KDS par catégorie (K5)
--
-- K5: Routing par station = Category-level uniquement.
--      Override par produit reporté à session 7 (backoffice).

ALTER TABLE categories
  ADD COLUMN dispatch_station TEXT NOT NULL DEFAULT 'none'
    CHECK (dispatch_station IN ('kitchen', 'barista', 'bakery', 'none'));

-- Mapping initial basé sur les slugs seedés en session 1.
-- Idempotent : aucun effet si les slugs n'existent pas (cas test isolé).
UPDATE categories SET dispatch_station = 'barista' WHERE slug = 'beverage';
UPDATE categories SET dispatch_station = 'bakery'  WHERE slug IN ('bread', 'pastry');
UPDATE categories SET dispatch_station = 'kitchen' WHERE slug = 'sandwiches';

COMMENT ON COLUMN categories.dispatch_station IS
  'Station KDS de routage : kitchen | barista | bakery | none. Copié sur order_items.dispatch_station au moment du send-to-kitchen.';
