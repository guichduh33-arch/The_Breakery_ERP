-- supabase/tests/b2b_foundation.test.sql
-- Session 24 / Phase 1.A.3 — pgTAP suite for B2B Foundation (S24).
--
-- Couvre les 11 migrations 20260601000005..022 :
--   T1  : b2b_payments table existe + RLS active + REVOKE INSERT
--   T2  : view_b2b_invoices retourne uniquement les orders B2B
--   T3  : view_ar_aging buckets correctement par age_days
--   T4  : record_b2b_payment_v1 happy path → balance décrémentée + JE émis
--   T5  : record_b2b_payment_v1 idempotency replay (même UUID)
--   T6  : record_b2b_payment_v1 overpayment → RAISE P0011
--   T7  : record_b2b_payment_v1 non-b2b customer → RAISE P0001
--   T8  : adjust_b2b_balance_v3 happy path positive delta (JE + manager PIN, S50 V2a-i)
--   T9  : adjust_b2b_balance_v3 happy path negative delta
--   T10 : adjust_b2b_balance_v3 underflow → RAISE P0011
--   T11 : create_b2b_order_v1 happy path → AR augmenté + JE + stock décrémenté
--   T12 : create_b2b_order_v1 credit limit exceeded → RAISE P0011
--   T13 : create_b2b_order_v1 idempotency replay
--   T14 : REVOKE UPDATE customers.b2b_current_balance pour authenticated
--   T15 : validate_b2b_credit_limit_v1 câblé dans create_b2b_order_v1
--
-- Run via MCP execute_sql wrap BEGIN/ROLLBACK ; pgtap extension est pré-créée
-- sur V3 dev.
BEGIN;
\ir helpers/b2b_foundation_cases_01.sql
\ir helpers/b2b_foundation_cases_02.sql
ROLLBACK;
