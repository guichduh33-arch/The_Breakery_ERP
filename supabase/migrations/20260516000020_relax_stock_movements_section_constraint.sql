-- 20260516000020_relax_stock_movements_section_constraint.sql
-- Session 12 hotfix : extend chk_stock_movements_section_required to also
-- exempt admin-level movements that operate on product-global stock without
-- a section context (adjustment, waste).
--
-- The original constraint (migration 20260516000016) required at least one
-- section_id for every movement NOT in the "external flow" set
-- (purchase, incoming, sale, sale_void, purchase_return). This was correct
-- for transfers and production movements, but blocks admin operations
-- routed through adjust_stock_v1 / waste_stock_v1 which by design do NOT
-- carry a section (they correct or burn global product stock).
--
-- This migration relaxes the constraint by adding `adjustment` and `waste`
-- to the exempted list. Internal section-bound movements (transfer_in/out,
-- production_in/out, etc.) continue to require sections.

ALTER TABLE stock_movements
  DROP CONSTRAINT IF EXISTS chk_stock_movements_section_required;

ALTER TABLE stock_movements
  ADD CONSTRAINT chk_stock_movements_section_required CHECK (
    movement_type IN (
      'purchase', 'incoming', 'sale', 'sale_void', 'purchase_return',
      'adjustment', 'waste'
    )
    OR from_section_id IS NOT NULL
    OR to_section_id IS NOT NULL
  );

COMMENT ON CONSTRAINT chk_stock_movements_section_required ON stock_movements IS
  'Section is mandatory for internal movements (transfers, production_in/out, '
  'opname_*). External flows (purchase/sale/return) and admin-global flows '
  '(adjustment, waste) are exempt and operate on the product-aggregated stock.';
