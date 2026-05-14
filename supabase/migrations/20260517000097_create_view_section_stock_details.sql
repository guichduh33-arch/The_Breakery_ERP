-- 20260517000097_create_view_section_stock_details.sql
-- Session 13 / Phase 2.D — view_section_stock_details.
--
-- Pure read view exposing the cross-product of section_stock + sections + products
-- with cost-valued stock_value column. Replaces the phantom 'stock_balances' name
-- carried over from V2 docs that never actually existed as a relation in V3.
--
-- security_invoker = on so the existing RLS on the underlying tables (sections /
-- section_stock auth_read, products read via inventory.read in app code) gates
-- access correctly. Authenticated users can SELECT.

CREATE OR REPLACE VIEW view_section_stock_details
  WITH (security_invoker = on)
AS
SELECT
  ss.section_id,
  s.code        AS section_code,
  s.name        AS section_name,
  s.kind        AS section_kind,
  ss.product_id,
  p.sku         AS product_sku,
  p.name        AS product_name,
  p.unit        AS unit,
  ss.quantity   AS quantity,
  p.cost_price  AS cost_price,
  (ss.quantity * COALESCE(p.cost_price, 0)) AS stock_value,
  p.min_stock_threshold,
  ss.updated_at AS last_updated_at
FROM section_stock ss
JOIN sections s ON s.id = ss.section_id
JOIN products p ON p.id = ss.product_id
WHERE s.deleted_at IS NULL
  AND p.deleted_at IS NULL;

COMMENT ON VIEW view_section_stock_details IS
  'Session 13 — Phase 2.D. Pure read view joining section_stock × sections × '
  'products. stock_value = quantity * COALESCE(cost_price, 0). Replaces the '
  'phantom V2 stock_balances name. security_invoker = on means underlying RLS '
  'gates apply (auth_read on section_stock + sections + products).';

GRANT SELECT ON view_section_stock_details TO authenticated;
