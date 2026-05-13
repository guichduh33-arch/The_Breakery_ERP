-- supabase/tests/cash_register.test.sql
-- Session 13 / Phase 3.C — pgTAP suite for cash_movements / close_shift_v1.
--
-- T_SHIFT_01: pos_sessions has cash_in_total/cash_out_total/variance_total/closing_notes columns
-- T_SHIFT_02: cash_movements table exists
-- T_SHIFT_03: record_cash_movement_v1 + close_shift_v1 functions exist
-- T_SHIFT_04: shift close with zero variance emits NO JE
-- T_SHIFT_05: shift close with positive variance (over) emits balanced JE via mappings
-- T_SHIFT_06: shift close with negative variance (short) emits balanced JE via mappings
-- T_SHIFT_07: shift close is idempotent (second call returns existing status)
-- T_SHIFT_08: variance threshold columns exist on business_config

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(8);

-- T_SHIFT_01
SELECT has_column('public', 'pos_sessions', 'cash_in_total',  'T_SHIFT_01a: pos_sessions.cash_in_total');
SELECT has_column('public', 'pos_sessions', 'cash_out_total', 'T_SHIFT_01b: pos_sessions.cash_out_total');
SELECT has_column('public', 'pos_sessions', 'variance_total', 'T_SHIFT_01c: pos_sessions.variance_total');
SELECT has_column('public', 'pos_sessions', 'closing_notes',  'T_SHIFT_01d: pos_sessions.closing_notes');

-- T_SHIFT_02
SELECT has_table('public', 'cash_movements', 'T_SHIFT_02: cash_movements table exists');

-- T_SHIFT_03
SELECT has_function('public', 'record_cash_movement_v1',
  ARRAY['uuid','text','numeric','text','uuid'],
  'T_SHIFT_03a: record_cash_movement_v1');
SELECT has_function('public', 'close_shift_v1',
  ARRAY['uuid','numeric','text','uuid'],
  'T_SHIFT_03b: close_shift_v1');

-- T_SHIFT_08
SELECT has_column('public', 'business_config', 'shift_variance_threshold_pct',
  'T_SHIFT_08a: business_config.shift_variance_threshold_pct');
SELECT has_column('public', 'business_config', 'shift_variance_threshold_abs',
  'T_SHIFT_08b: business_config.shift_variance_threshold_abs');

-- (T_SHIFT_04..07 covered in Vitest live RPC tests where we can authenticate
-- as a manager and post the full lifecycle. plpgsql trusted callers do not
-- pass through has_permission gating cleanly in pgTAP transactions.)

SELECT * FROM finish();
ROLLBACK;
