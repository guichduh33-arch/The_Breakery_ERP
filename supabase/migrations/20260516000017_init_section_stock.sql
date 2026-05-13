-- 20260516000017_init_section_stock.sql
-- Session 12 / Phase 1 (complete) / migration 6 :
--   Cache dénormalisé section_stock(section_id, product_id, quantity).
--
-- Pourquoi : products.current_stock est un cache global (toutes sections confondues).
--   Pour répondre à "combien de farine y a-t-il en cuisine ?" sans agréger tout le
--   ledger à chaque appel, on tient un cache par section maintenu par les RPCs.
--
-- Source de vérité reste stock_movements (append-only ledger) ; section_stock est
--   un dérivé recalculable. Un job audit nightly (à créer session ultérieure) peut
--   reconstruire à partir de SUM(stock_movements.quantity) GROUP BY (product_id, section_id).
--
-- Maintenance : les RPCs de Phase 2-5 (adjust, receive, transfer.receive, production,
--   opname.finalize) UPDATE / UPSERT cette table en transaction avec l'INSERT
--   stock_movements. Pour Phase 1 elle est créée vide (les rows existantes seront
--   reconstruites à la première opération sur chaque produit×section).

CREATE TABLE section_stock (
  section_id  UUID           NOT NULL REFERENCES sections(id) ON DELETE RESTRICT,
  product_id  UUID           NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity    DECIMAL(10,3)  NOT NULL DEFAULT 0,
  unit        TEXT           NOT NULL,
  updated_at  TIMESTAMPTZ    NOT NULL DEFAULT now(),
  PRIMARY KEY (section_id, product_id)
);

CREATE INDEX idx_section_stock_product
  ON section_stock(product_id);

CREATE INDEX idx_section_stock_low
  ON section_stock(quantity)
  WHERE quantity > 0;

CREATE TRIGGER section_stock_set_updated_at
  BEFORE UPDATE ON section_stock
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE section_stock IS
  'Cache dénormalisé du stock par (section, product). Maintenu par les RPCs Phase 2-5 '
  '(adjust, receive, transfer, production, opname). Source de vérité = stock_movements.';
COMMENT ON COLUMN section_stock.quantity IS
  'Quantité courante en stock pour ce produit dans cette section. Mise à jour inline '
  'par les RPCs admin. Drift vs SUM(stock_movements) détectable par audit nightly.';

-- RLS : lecture pour tout user authentifié, write réservé aux RPCs SECURITY DEFINER
ALTER TABLE section_stock ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read" ON section_stock FOR SELECT
  USING (is_authenticated());

-- Pas de policy INSERT/UPDATE/DELETE → REVOKE pour authenticated
REVOKE INSERT, UPDATE, DELETE ON section_stock FROM authenticated;
