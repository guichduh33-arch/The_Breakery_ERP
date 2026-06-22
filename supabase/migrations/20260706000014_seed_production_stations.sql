-- 20260706000014_seed_production_stations.sql
--
-- Seed the four production "stations" surfaced as tabs on the redesigned
-- Production page: Pastry / Hot Kitchen / Viennoiserie / Bakery.
--
-- They are ordinary `sections` rows with kind='production'. Codes are prefixed
-- STN_ because the legacy production section "Pastry Kitchen" already owns the
-- bare code PASTRY. Idempotent: ON CONFLICT (code) DO NOTHING so re-applying is
-- a no-op. Products are linked to a station via `product_sections`
-- (set_product_sections_v1) — seeded here with no rows.

INSERT INTO public.sections (code, name, kind, is_active, display_order)
VALUES
  ('STN_PASTRY',       'Pastry',       'production', true, 110),
  ('STN_HOT_KITCHEN',  'Hot Kitchen',  'production', true, 120),
  ('STN_VIENNOISERIE', 'Viennoiserie', 'production', true, 130),
  ('STN_BAKERY',       'Bakery',       'production', true, 140)
ON CONFLICT (code) DO NOTHING;
