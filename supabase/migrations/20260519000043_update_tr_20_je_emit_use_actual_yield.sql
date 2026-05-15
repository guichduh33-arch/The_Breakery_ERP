-- 20260519000043_update_tr_20_je_emit_use_actual_yield.sql
-- Session 15 / Phase 2.A — JE source-of-truth audit (Decision D5).
--
-- Audit-only migration. NO behavioural change to tr_stock_movement_je().
--
-- Rationale : the trigger already computes JE value as
--   v_value := round_idr(cost_price * ABS(NEW.quantity))
-- which reads from `stock_movements.quantity`. Migration 20260519000042 changed
-- record_production_v1 to pass `v_actual_yield` (not `p_quantity_produced`) as
-- the quantity for the production_in stock_movement. Therefore the Dr Inventory
-- finished-goods JE value automatically reflects actual yield without touching
-- the trigger.
--
-- This migration only refreshes the comment on the trigger function to document
-- the new contract (audit trail per CLAUDE.md migration discipline).

COMMENT ON FUNCTION tr_stock_movement_je() IS
  'D11/D12/D20 [m4] split 2/3 — JE for waste / adjustment_in-out / opname_in-out / '
  'production_in-out. Resolves accounts via mapping ; period-guarded ; idempotent via '
  'UNIQUE (reference_type, reference_id, metadata->>movement_type) (constraint added 000023). '
  'Attached as `tr_20_je_emit` in migration 000023. '
  'Session 15 D5 update : for production_in, NEW.quantity is set by '
  'record_production_v1 to actual_yield_qty (was quantity_produced before '
  'migration 20260519000042). The JE value therefore reflects the actual baked '
  'output ; no trigger logic change required because ABS(NEW.quantity) was '
  'already the source of truth.';

COMMENT ON TRIGGER tr_20_je_emit ON stock_movements IS
  'M1 (Decision Pack 2026-05-13). Numeric prefix _20_ encodes AFTER INSERT firing order. '
  'ONLY trigger that writes journal_entries from stock_movements. FIFO lot resolution is '
  'handled UPFRONT inside record_stock_movement_v1, NOT via trigger. '
  'Session 15 D5 : production_in movements now carry actual_yield_qty as quantity '
  '(set by record_production_v1) ; trigger behaviour unchanged.';
