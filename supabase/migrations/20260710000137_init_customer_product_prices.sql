-- 20260710000137_init_customer_product_prices.sql
-- S69 Volet B — per-customer negotiated prices (B2B). Read: authenticated (RLS).
-- Writes go through SECURITY DEFINER RPCs gated on customer_prices.manage (Task 6).

CREATE TABLE customer_product_prices (
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products(id)  ON DELETE CASCADE,
  price       DECIMAL(12,2) NOT NULL CHECK (price >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, product_id)
);

CREATE TRIGGER customer_product_prices_set_updated_at
  BEFORE UPDATE ON customer_product_prices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE customer_product_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON customer_product_prices FOR SELECT USING (is_authenticated());

-- Role-level lockdown: no direct DML for app roles (RPC-only writes).
REVOKE ALL ON TABLE customer_product_prices FROM PUBLIC;
REVOKE ALL ON TABLE customer_product_prices FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE customer_product_prices FROM authenticated;
GRANT SELECT ON TABLE customer_product_prices TO authenticated;

-- Permission + role grants. `permissions` PK is `code`; `role_permissions` uses `role_code`.
INSERT INTO permissions (code, module, action, description)
VALUES ('customer_prices.manage', 'customer_prices', 'manage', 'Manage per-customer negotiated prices')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code)
SELECT r, 'customer_prices.manage'
FROM unnest(ARRAY['MANAGER','ADMIN','SUPER_ADMIN']) AS r
ON CONFLICT DO NOTHING;
