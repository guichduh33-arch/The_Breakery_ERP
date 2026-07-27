-- 20260727000246_adjustment_je_emit_types_noop.sql
--
-- Audit stock 2026-07-27 (Q1, décision Mamat) : le movement_type legacy
-- 'adjustment' (émis par adjust_stock_v1 avec un delta SIGNÉ) était absent
-- du CASE de tr_stock_movement_je — chaque ajustement manuel modifiait la
-- valeur d'inventaire sans écriture comptable (47 mouvements sans JE en
-- live au moment de l'audit ; l'historique n'est PAS repris ici).
--
-- Fix : 'adjustment' rejoint la liste des types couverts, avec le même
-- mapping que l'opname/adjustment directionnel, la direction étant portée
-- par le signe de NEW.quantity :
--   quantity > 0 → DR INVENTORY_GENERAL / CR ADJUSTMENT_INCOME  (4510)
--   quantity < 0 → DR ADJUSTMENT_EXPENSE (6510) / CR INVENTORY_GENERAL
--
-- Corps repris du live (pg_get_functiondef, 2026-07-27) — seuls l'IN-list
-- et la branche CASE 'adjustment' sont ajoutés. Trigger function : pas de
-- versioning _vN (pattern historique _022/_023), CREATE OR REPLACE en place.
-- [types-noop] : aucun changement de schéma ni de signature RPC.

CREATE OR REPLACE FUNCTION public.tr_stock_movement_je()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF (NEW.metadata->>'reverse_of_production') = 'true' THEN
    RETURN NEW;
  END IF;

  IF NEW.movement_type NOT IN (
    'waste',
    'adjustment',
    'adjustment_in', 'adjustment_out',
    'opname_in',     'opname_out',
    'production_in', 'production_out'
  ) THEN
    RETURN NEW;
  END IF;

  v_cost_price := COALESCE(NEW.unit_cost, (SELECT cost_price FROM products WHERE id = NEW.product_id), 0);
  v_value      := round_idr(v_cost_price * ABS(NEW.quantity));

  IF v_value <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_existing FROM journal_entries
    WHERE reference_type = 'stock_movement'
      AND reference_id   = NEW.id
      AND metadata->>'movement_type' = NEW.movement_type::TEXT
    LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN NEW;
  END IF;

  PERFORM check_fiscal_period_open(NEW.created_at::date);

  CASE NEW.movement_type
    WHEN 'waste' THEN
      v_dr_key := 'WASTE_EXPENSE'; v_cr_key := 'INVENTORY_GENERAL';
      v_dr_desc := 'Stock waste'; v_cr_desc := 'Inventory consumed (waste)';
    WHEN 'adjustment' THEN
      -- Legacy signed adjustment (adjust_stock_v1) : direction par le signe.
      IF NEW.quantity > 0 THEN
        v_dr_key := 'INVENTORY_GENERAL'; v_cr_key := 'ADJUSTMENT_INCOME';
        v_dr_desc := 'Inventory positive adjustment'; v_cr_desc := 'Adjustment income';
      ELSE
        v_dr_key := 'ADJUSTMENT_EXPENSE'; v_cr_key := 'INVENTORY_GENERAL';
        v_dr_desc := 'Adjustment expense'; v_cr_desc := 'Inventory negative adjustment';
      END IF;
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
END $function$;
