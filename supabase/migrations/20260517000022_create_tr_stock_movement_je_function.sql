-- 20260517000022_create_tr_stock_movement_je_function.sql
-- Session 13 / Phase 1.A / [m4] split 2/3 :
--   Create tr_stock_movement_je() trigger function (NOT yet attached — see 000023).
--
-- Emits JE for stock-movement types that have an accounting impact :
--   waste              → DR WASTE_EXPENSE       / CR INVENTORY_GENERAL
--   adjustment_in      → DR INVENTORY_GENERAL   / CR ADJUSTMENT_INCOME
--   adjustment_out     → DR ADJUSTMENT_EXPENSE  / CR INVENTORY_GENERAL
--   opname_in          → DR INVENTORY_GENERAL   / CR OPNAME_INCOME
--   opname_out         → DR OPNAME_EXPENSE      / CR INVENTORY_GENERAL
--   production_in      → DR INVENTORY_FINISHED_GOODS / CR PRODUCTION_COGS (or paired with production_out)
--   production_out     → DR PRODUCTION_COGS     / CR INVENTORY_RAW_MATERIAL
--   transfer_in/out    → NO JE (intra-company sections)
--   purchase/incoming  → NO JE (covered by goods_receipt_notes trigger 000011)
--   sale/sale_void     → NO JE (covered by orders trigger 000010)
--   reservation_*      → NO JE (no economic event)
--
-- Idempotency : (reference_type, reference_id, metadata->>'movement_type') UNIQUE
-- — added in 000023 alongside the trigger attach.
-- Fiscal guard : check_fiscal_period_open(NEW.created_at::date).
-- Value : unit_cost × |quantity| (defaults to product.cost_price * |quantity| if unit_cost NULL).

-- Add metadata column to journal_entries if absent (needed by the UNIQUE constraint in 000023).
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::JSONB;

CREATE OR REPLACE FUNCTION tr_stock_movement_je()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_je_id       UUID;
  v_existing    UUID;
  v_entry_no    TEXT;
  v_value       DECIMAL(14,2);
  v_cost_price  DECIMAL(14,2);
  v_dr_account  UUID;
  v_cr_account  UUID;
  v_dr_desc     TEXT;
  v_cr_desc     TEXT;
  v_dr_key      TEXT;
  v_cr_key      TEXT;
BEGIN
  -- Only the movement types with accounting impact are handled.
  IF NEW.movement_type NOT IN (
    'waste',
    'adjustment_in', 'adjustment_out',
    'opname_in',     'opname_out',
    'production_in', 'production_out'
  ) THEN
    RETURN NEW;
  END IF;

  -- Compute value = unit_cost × |quantity|, falling back to product.cost_price.
  v_cost_price := COALESCE(NEW.unit_cost, (SELECT cost_price FROM products WHERE id = NEW.product_id), 0);
  v_value      := round_idr(v_cost_price * ABS(NEW.quantity));

  -- Skip zero-value postings (cost_price=0 product) — would create unbalanced JE.
  IF v_value <= 0 THEN
    RETURN NEW;
  END IF;

  -- Idempotency : skip if a JE already exists for this (reference_type, reference_id, movement_type).
  SELECT id INTO v_existing FROM journal_entries
    WHERE reference_type = 'stock_movement'
      AND reference_id   = NEW.id
      AND metadata->>'movement_type' = NEW.movement_type::TEXT
    LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Fiscal guard.
  PERFORM check_fiscal_period_open(NEW.created_at::date);

  -- Mapping resolution per movement_type.
  CASE NEW.movement_type
    WHEN 'waste' THEN
      v_dr_key := 'WASTE_EXPENSE'; v_cr_key := 'INVENTORY_GENERAL';
      v_dr_desc := 'Stock waste'; v_cr_desc := 'Inventory consumed (waste)';
    WHEN 'adjustment_in' THEN
      v_dr_key := 'INVENTORY_GENERAL'; v_cr_key := 'ADJUSTMENT_INCOME';
      v_dr_desc := 'Inventory positive adjustment'; v_cr_desc := 'Adjustment income';
    WHEN 'adjustment_out' THEN
      v_dr_key := 'ADJUSTMENT_EXPENSE'; v_cr_key := 'INVENTORY_GENERAL';
      v_dr_desc := 'Adjustment expense'; v_cr_desc := 'Inventory negative adjustment';
    WHEN 'opname_in' THEN
      v_dr_key := 'INVENTORY_GENERAL'; v_cr_key := 'OPNAME_INCOME';
      v_dr_desc := 'Opname positive variance'; v_cr_desc := 'Opname income';
    WHEN 'opname_out' THEN
      v_dr_key := 'OPNAME_EXPENSE'; v_cr_key := 'INVENTORY_GENERAL';
      v_dr_desc := 'Opname expense'; v_cr_desc := 'Opname negative variance';
    WHEN 'production_in' THEN
      v_dr_key := 'INVENTORY_FINISHED_GOODS'; v_cr_key := 'PRODUCTION_COGS';
      v_dr_desc := 'Finished goods produced'; v_cr_desc := 'COGS reversal (paired with production_out)';
    WHEN 'production_out' THEN
      v_dr_key := 'PRODUCTION_COGS'; v_cr_key := 'INVENTORY_RAW_MATERIAL';
      v_dr_desc := 'Raw material consumed'; v_cr_desc := 'Inventory raw material';
    ELSE
      RETURN NEW;
  END CASE;

  v_dr_account := resolve_mapping_account(v_dr_key);
  v_cr_account := resolve_mapping_account(v_cr_key);

  v_entry_no := next_journal_entry_number(NEW.created_at::date);

  INSERT INTO journal_entries (
    entry_number, entry_date, description, reference_type, reference_id,
    status, total_debit, total_credit, created_by, metadata
  ) VALUES (
    v_entry_no,
    NEW.created_at::date,
    'Stock movement ' || NEW.movement_type::TEXT || ' for product ' || NEW.product_id::TEXT,
    'stock_movement',
    NEW.id,
    'posted',
    v_value,
    v_value,
    NEW.created_by,
    jsonb_build_object('movement_type', NEW.movement_type::TEXT)
  ) RETURNING id INTO v_je_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
    (v_je_id, v_dr_account, v_value, 0,       v_dr_desc),
    (v_je_id, v_cr_account, 0,       v_value, v_cr_desc);

  RETURN NEW;
END $$;

COMMENT ON FUNCTION tr_stock_movement_je() IS
  'D11/D12/D20 [m4] split 2/3 — JE for waste / adjustment_in-out / opname_in-out / '
  'production_in-out. Resolves accounts via mapping ; period-guarded ; idempotent via '
  'UNIQUE (reference_type, reference_id, metadata->>movement_type) (constraint added 000023). '
  'Attached as `tr_20_je_emit` in migration 000023.';

REVOKE EXECUTE ON FUNCTION tr_stock_movement_je() FROM PUBLIC;
