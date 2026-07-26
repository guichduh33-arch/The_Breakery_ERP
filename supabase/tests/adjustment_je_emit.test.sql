-- supabase/tests/adjustment_je_emit.test.sql
--
-- Audit stock 2026-07-27 (Q1) — le movement_type legacy 'adjustment'
-- (delta signé émis par adjust_stock_v1) émet désormais une JE via
-- tr_stock_movement_je (migration 20260727000246).
--
-- Runner : MCP execute_sql (enveloppe BEGIN … ROLLBACK), pas de runner local.
--
-- T1 : adjustment quantity > 0 → JE balanced (total_debit = total_credit > 0)
-- T2 : lignes = DR INVENTORY_GENERAL (1141) / CR ADJUSTMENT_INCOME (4510)
-- T3 : adjustment quantity < 0 → JE balanced
-- T4 : lignes = DR ADJUSTMENT_EXPENSE (6510) / CR INVENTORY_GENERAL (1141)
-- T5 : idempotence — exactement 1 JE par mouvement

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(5);

DO $$
DECLARE
  v_profile_id  UUID;
  v_product_id  UUID;
  v_mvt_pos     UUID;
  v_mvt_neg     UUID;
  v_je          RECORD;
  v_inv         UUID;
  v_adj_inc     UUID;
  v_adj_exp     UUID;
  v_cnt         INT;
BEGIN
  SELECT id INTO v_profile_id FROM user_profiles
    WHERE deleted_at IS NULL AND role_code = 'MANAGER' LIMIT 1;
  IF v_profile_id IS NULL THEN
    PERFORM set_config('breakery.adj_skip', 'no_manager', true);
    RETURN;
  END IF;

  SELECT id INTO v_product_id FROM products
    WHERE deleted_at IS NULL AND COALESCE(cost_price, 0) > 0
    LIMIT 1;
  IF v_product_id IS NULL THEN
    SELECT id INTO v_product_id FROM products WHERE deleted_at IS NULL LIMIT 1;
    UPDATE products SET cost_price = 1000 WHERE id = v_product_id;
  END IF;

  v_inv     := resolve_mapping_account('INVENTORY_GENERAL');
  v_adj_inc := resolve_mapping_account('ADJUSTMENT_INCOME');
  v_adj_exp := resolve_mapping_account('ADJUSTMENT_EXPENSE');

  -- T1/T2 : adjustment positif ('adjustment' est exempté de la contrainte
  -- section ; insert direct — pgTAP tourne en superuser, même convention
  -- que accounting.test.sql T23-T27).
  INSERT INTO stock_movements (
    product_id, movement_type, quantity, unit, reason, unit_cost, created_by, reference_type
  ) VALUES (
    v_product_id, 'adjustment', 2, 'pcs', 'pgTAP adjustment JE test (+)', 1000, v_profile_id, 'admin_action'
  ) RETURNING id INTO v_mvt_pos;

  SELECT * INTO v_je FROM journal_entries
    WHERE reference_type = 'stock_movement' AND reference_id = v_mvt_pos LIMIT 1;
  PERFORM set_config('breakery.adj_t1',
    (v_je.id IS NOT NULL AND v_je.total_debit = v_je.total_credit AND v_je.total_debit > 0)::TEXT,
    true);
  PERFORM set_config('breakery.adj_t2', (
    EXISTS (SELECT 1 FROM journal_entry_lines
            WHERE journal_entry_id = v_je.id AND account_id = v_inv AND debit > 0)
    AND EXISTS (SELECT 1 FROM journal_entry_lines
            WHERE journal_entry_id = v_je.id AND account_id = v_adj_inc AND credit > 0)
    )::TEXT, true);

  -- T3/T4 : adjustment négatif.
  INSERT INTO stock_movements (
    product_id, movement_type, quantity, unit, reason, unit_cost, created_by, reference_type
  ) VALUES (
    v_product_id, 'adjustment', -3, 'pcs', 'pgTAP adjustment JE test (-)', 1000, v_profile_id, 'admin_action'
  ) RETURNING id INTO v_mvt_neg;

  SELECT * INTO v_je FROM journal_entries
    WHERE reference_type = 'stock_movement' AND reference_id = v_mvt_neg LIMIT 1;
  PERFORM set_config('breakery.adj_t3',
    (v_je.id IS NOT NULL AND v_je.total_debit = v_je.total_credit AND v_je.total_debit > 0)::TEXT,
    true);
  PERFORM set_config('breakery.adj_t4', (
    EXISTS (SELECT 1 FROM journal_entry_lines
            WHERE journal_entry_id = v_je.id AND account_id = v_adj_exp AND debit > 0)
    AND EXISTS (SELECT 1 FROM journal_entry_lines
            WHERE journal_entry_id = v_je.id AND account_id = v_inv AND credit > 0)
    )::TEXT, true);

  -- T5 : 1 JE exactement par mouvement.
  SELECT COUNT(*)::INT INTO v_cnt FROM journal_entries
    WHERE reference_type = 'stock_movement' AND reference_id IN (v_mvt_pos, v_mvt_neg);
  PERFORM set_config('breakery.adj_t5', (v_cnt = 2)::TEXT, true);
END $$;

SELECT ok(
  COALESCE(current_setting('breakery.adj_t1', true) = 'true', false)
   OR current_setting('breakery.adj_skip', true) IS NOT NULL,
  'T1: adjustment (+) emits balanced JE'
);
SELECT ok(
  COALESCE(current_setting('breakery.adj_t2', true) = 'true', false)
   OR current_setting('breakery.adj_skip', true) IS NOT NULL,
  'T2: adjustment (+) = DR INVENTORY_GENERAL / CR ADJUSTMENT_INCOME'
);
SELECT ok(
  COALESCE(current_setting('breakery.adj_t3', true) = 'true', false)
   OR current_setting('breakery.adj_skip', true) IS NOT NULL,
  'T3: adjustment (−) emits balanced JE'
);
SELECT ok(
  COALESCE(current_setting('breakery.adj_t4', true) = 'true', false)
   OR current_setting('breakery.adj_skip', true) IS NOT NULL,
  'T4: adjustment (−) = DR ADJUSTMENT_EXPENSE / CR INVENTORY_GENERAL'
);
SELECT ok(
  COALESCE(current_setting('breakery.adj_t5', true) = 'true', false)
   OR current_setting('breakery.adj_skip', true) IS NOT NULL,
  'T5: exactly 1 JE per adjustment movement (idempotent)'
);

SELECT * FROM finish();

ROLLBACK;
