-- 20260602120000_seed_display_stock_on_is_display_item.sql
-- M7 fix (audit 2026-06-01 §Medium) — close the `is_display_item` silent trap.
--
-- Problem: flagging a product `is_display_item = true` (BO GeneralPanel toggle or
-- NewProductDialog checkbox) created NO `display_stock` cache row. The product was
-- then invisible in the BO DisplayStockPage (empty join) and the very first POS sale
-- hit `complete_order_with_payment_v10` line 180-185 → COALESCE(0) < qty →
-- "Insufficient display stock" at checkout (product unsellable until a POS
-- `add_display_stock_v1`).
--
-- Fix: an AFTER trigger seeds a `display_stock(product_id, 0)` cache row the first
-- time a product is flagged. This makes the product VISIBLE ("needs stocking") in
-- DisplayStockPage instead of silently absent. Seeding 0 does NOT make it sellable
-- (the sale guard still requires qty > 0) — it only surfaces the operational state.
-- The paired BO banner (front-end) warns the manager at flag time.
--
-- CRITICAL: ON CONFLICT DO NOTHING preserves any counter already stocked from the
-- POS — re-saving a product whose vitrine holds 50 units must never reset it to 0.
--
-- No `display_movements` row is written for the seed: qty 0 means "nothing happened
-- yet", consistent with `display_stock` being a cache over the movements ledger.

CREATE OR REPLACE FUNCTION public.seed_display_stock_on_flag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Initialize the vitrine cache row at 0 the first time a product is flagged.
  -- ON CONFLICT DO NOTHING preserves any counter already stocked from the POS.
  INSERT INTO display_stock (product_id, quantity)
  VALUES (NEW.id, 0)
  ON CONFLICT (product_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

-- Trigger-function defense-in-depth (project doctrine — REVOKE EXECUTE FROM PUBLIC).
-- Moot for a trigger function (cannot be called directly) but kept for consistency.
REVOKE EXECUTE ON FUNCTION public.seed_display_stock_on_flag() FROM PUBLIC;

DROP TRIGGER IF EXISTS tr_seed_display_stock ON public.products;
CREATE TRIGGER tr_seed_display_stock
  AFTER INSERT OR UPDATE OF is_display_item ON public.products
  FOR EACH ROW
  WHEN (NEW.is_display_item = true)
  EXECUTE FUNCTION public.seed_display_stock_on_flag();

-- Backfill: products already flagged but missing a cache row (the M7 population).
INSERT INTO display_stock (product_id, quantity)
SELECT p.id, 0
  FROM products p
  LEFT JOIN display_stock ds ON ds.product_id = p.id
 WHERE p.is_display_item = true
   AND ds.product_id IS NULL;

COMMENT ON FUNCTION public.seed_display_stock_on_flag() IS
  'M7 audit fix — seeds display_stock(id,0) when a product is flagged is_display_item. '
  'ON CONFLICT DO NOTHING preserves existing counters (never resets a stocked vitrine).';
