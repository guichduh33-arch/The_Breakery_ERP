-- 20260706000013_backfill_unit_cost_conversion.sql
-- Data correction for the receive_purchase_order_v2 unit-cost bug fixed in
-- 20260706000012. Before that fix, a PO received in a non-base unit (factor ≠ 1)
-- stored the per-PO-unit price as a per-base-unit cost on both
-- stock_movements.unit_cost and products.cost_price, and inflated recipe costs
-- that consume the affected raw material.
--
-- Real impact at time of writing: 1 product — Almond Ground (SEE-012), base kg,
-- Doz = 11.3 kg, bought 1 Doz @ Rp 2,000,000 → cost_price 2,000,000/kg instead
-- of 176,991.15/kg — which cascaded into 5 dependent recipes.
--
-- This migration is data-driven (no hard-coded UUIDs) and idempotent:
--   Step 1 — correct stock_movements.unit_cost for purchase movements whose
--            unit_cost is still the un-converted PO-line price (guard:
--            sm.unit_cost = poi.unit_cost). Ledger is append-only for app code,
--            but a migration runs as the owner; precedent: Stock Audit _013.
--   Step 2 — recompute products.cost_price (WAC over the now-corrected purchase
--            movements) for the affected raw materials.
--   Step 3 — recompute_all_recipe_costs_v1() to cascade the corrected raw cost
--            into every dependent recipe product (auth.uid() NULL → cron-exempt).

DO $$
DECLARE
  v_mv_fixed   INT;
  v_cost_fixed INT;
  v_recompute  JSONB;
BEGIN
  -- ── Step 1: correct the historical ledger unit_cost (per base unit) ─────────
  WITH corrected AS (
    UPDATE stock_movements sm
       SET unit_cost = round(poi.unit_cost / NULLIF(poi.unit_factor_to_base, 0), 2)
      FROM purchase_order_items poi
     WHERE sm.movement_type = 'purchase'
       AND (sm.metadata->>'po_item_id')::uuid = poi.id
       AND poi.unit_factor_to_base IS DISTINCT FROM 1
       AND poi.unit_cost IS NOT NULL
       AND sm.unit_cost = poi.unit_cost          -- idempotency: only un-converted rows
     RETURNING sm.id
  )
  SELECT count(*) INTO v_mv_fixed FROM corrected;

  -- ── Step 2: recompute raw-material cost_price via WAC over purchase movements ─
  WITH affected AS (
    SELECT DISTINCT poi.product_id
      FROM purchase_order_items poi
     WHERE poi.unit_factor_to_base IS DISTINCT FROM 1
       AND poi.received_quantity > 0
  ),
  wac AS (
    SELECT sm.product_id,
           round(SUM(sm.quantity * sm.unit_cost) / NULLIF(SUM(sm.quantity), 0), 2) AS cost
      FROM stock_movements sm
     WHERE sm.movement_type = 'purchase'
       AND sm.unit_cost IS NOT NULL
       AND sm.product_id IN (SELECT product_id FROM affected)
     GROUP BY sm.product_id
  ),
  upd AS (
    UPDATE products p
       SET cost_price = wac.cost, updated_at = now()
      FROM wac
     WHERE p.id = wac.product_id
       AND wac.cost IS NOT NULL
       AND p.cost_price IS DISTINCT FROM wac.cost
     RETURNING p.id
  )
  SELECT count(*) INTO v_cost_fixed FROM upd;

  -- ── Step 3: cascade into dependent recipe products ──────────────────────────
  v_recompute := public.recompute_all_recipe_costs_v1();

  RAISE NOTICE 'backfill unit_cost conversion: movements_fixed=%, raw_cost_fixed=%, recipe_recompute=%',
    v_mv_fixed, v_cost_fixed, v_recompute;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    NULL,
    'inventory.unit_cost_backfill',
    'stock_movements',
    NULL,
    jsonb_build_object(
      'movements_fixed', v_mv_fixed,
      'raw_cost_fixed',  v_cost_fixed,
      'recipe_recompute', v_recompute - 'implausible',
      'migration',       '20260706000013',
      'source',          'receive_v2_unit_cost_fix'
    )
  );
END $$;
