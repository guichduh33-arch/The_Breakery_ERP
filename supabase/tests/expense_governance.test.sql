-- supabase/tests/expense_governance.test.sql
-- Session 28 / Wave 4.A — pgTAP suite for Expense Governance (18 asserts T1-T18)
--
-- Tests cover:
--   T1  : submit_expense_v2 amount=50k → auto_approved=true
--   T2  : submit_expense_v2 amount=500k → snapshot has 1 step
--   T3  : submit_expense_v2 amount=2M → snapshot has 2 steps
--   T4  : approve_expense_v2 by created_by → P0001 sod_creator_block
--   T5  : approve_expense_v2 by CASHIER → 42501 perm gate
--   T6  : after step 1 by SUPER_ADMIN → current_approval_step=1
--   T7  : same approver tries step 2 → P0001 sod_already_approved
--   T8  : final step by different ADMIN → status=approved
--   T9  : set_expense_threshold_v1 overlapping range → P0002
--   T10 : set_expense_threshold_v1 by MANAGER (no thresholds.write) → 42501
--   T11 : category-specific 2-step override wins over NULL 1-step default
--   T12 : sync_cash_expense_to_session trigger → cash_out_total += amount
--   T13 : sync_cash trigger no open session → audit_log written, no block
--   T14 : audit_log rows written for threshold + approval RPCs
--   T15 : boundary inclusive lower — amount=100k → 2-step category bracket
--   T16 : legacy NULL snapshot → fallback 1-step approves OK
--   T17 : delete_expense_threshold_v1 → row removed
--   T18 : REVOKE EXECUTE FROM anon on all 4 S28 RPCs
--
-- Run via MCP execute_sql wrapped in BEGIN/ROLLBACK.
-- T3 step 1 is approved in fixtures; T7/T8 run inside plan section so T6 assertion
-- (step=1) is stable at assertion time.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

-- ============================================================================
-- Fixtures
-- ============================================================================

-- Inline ADMIN for T8 step-2 (different person from EMP000 who does step 1)
INSERT INTO auth.users (id, email)
VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 'admin2@gov28.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_profiles (id, auth_user_id, employee_code, full_name, role_code, pin_hash, is_active)
VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
        'EMP-GOV28-A2', 'Admin2 Gov28', 'ADMIN', 'x', true)
ON CONFLICT (id) DO NOTHING;

-- Test category (linked to 6190 Other Expenses)
INSERT INTO expense_categories (id, code, name, account_id)
  SELECT 'aaaaaaaa-0000-0000-0000-000000000001', 'T_GOV28_CAT', 'Gov28 Test Cat', a.id
  FROM accounts a WHERE a.code = '6190' LIMIT 1
ON CONFLICT DO NOTHING;

-- Auth as MANAGER (EMP003, auth sub = _004)
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';

INSERT INTO expenses (id, expense_number, category_id, amount, vat_amount, payment_method,
                      description, expense_date, created_by, status)
VALUES
  ('eeeeeeee-0000-0000-0000-000000000001', 'EXP-GOV28-001', 'aaaaaaaa-0000-0000-0000-000000000001',
   50000, 0, 'cash', 'T1 auto-approve', CURRENT_DATE,
   (SELECT id FROM user_profiles WHERE auth_user_id = '00000000-0000-0000-0000-000000000004' LIMIT 1), 'draft'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'EXP-GOV28-002', 'aaaaaaaa-0000-0000-0000-000000000001',
   500000, 0, 'transfer', 'T2 1-step', CURRENT_DATE,
   (SELECT id FROM user_profiles WHERE auth_user_id = '00000000-0000-0000-0000-000000000004' LIMIT 1), 'draft'),
  ('eeeeeeee-0000-0000-0000-000000000003', 'EXP-GOV28-003', 'aaaaaaaa-0000-0000-0000-000000000001',
   2000000, 0, 'transfer', 'T3 2-step', CURRENT_DATE,
   (SELECT id FROM user_profiles WHERE auth_user_id = '00000000-0000-0000-0000-000000000004' LIMIT 1), 'draft');

SELECT submit_expense_v2('eeeeeeee-0000-0000-0000-000000000001');
SELECT submit_expense_v2('eeeeeeee-0000-0000-0000-000000000002');
SELECT submit_expense_v2('eeeeeeee-0000-0000-0000-000000000003');

-- Approve T3 step 1 ONLY as EMP000 (SUPER_ADMIN) — step 2 left pending for T6/T7/T8
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';
SELECT approve_expense_v2('eeeeeeee-0000-0000-0000-000000000003');

-- Category-specific threshold [100k, 1M) 2 steps (used by T9/T11/T15/T17)
SELECT set_expense_threshold_v1(
  NULL, 'aaaaaaaa-0000-0000-0000-000000000001', 100000, 1000000,
  '[{"role_codes":["MANAGER","ADMIN","SUPER_ADMIN"],"label":"Manager approval"},
    {"role_codes":["ADMIN","SUPER_ADMIN"],"label":"Owner approval"}]'::jsonb
);

-- T11: 500k in T_GOV28_CAT → should get 2 steps (category-specific override)
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
INSERT INTO expenses (id, expense_number, category_id, amount, vat_amount, payment_method,
                      description, expense_date, created_by, status)
VALUES ('eeeeeeee-0000-0000-0000-000000000011', 'EXP-GOV28-011', 'aaaaaaaa-0000-0000-0000-000000000001',
        500000, 0, 'transfer', 'T11', CURRENT_DATE,
        (SELECT id FROM user_profiles WHERE auth_user_id = '00000000-0000-0000-0000-000000000004' LIMIT 1), 'draft');
SELECT submit_expense_v2('eeeeeeee-0000-0000-0000-000000000011');

-- T15: 100k boundary inclusive lower in T_GOV28_CAT
INSERT INTO expenses (id, expense_number, category_id, amount, vat_amount, payment_method,
                      description, expense_date, created_by, status)
VALUES ('eeeeeeee-0000-0000-0000-000000000015', 'EXP-GOV28-015', 'aaaaaaaa-0000-0000-0000-000000000001',
        100000, 0, 'transfer', 'T15', CURRENT_DATE,
        (SELECT id FROM user_profiles WHERE auth_user_id = '00000000-0000-0000-0000-000000000004' LIMIT 1), 'draft');
SELECT submit_expense_v2('eeeeeeee-0000-0000-0000-000000000015');

-- T16: legacy NULL snapshot (pre-S28 row inserted directly as submitted)
INSERT INTO expenses (id, expense_number, category_id, amount, vat_amount, payment_method,
                      description, expense_date, created_by, status, submitted_at, submitted_by)
VALUES ('eeeeeeee-0000-0000-0000-000000000016', 'EXP-GOV28-016', 'aaaaaaaa-0000-0000-0000-000000000001',
        500000, 0, 'transfer', 'T16', CURRENT_DATE,
        (SELECT id FROM user_profiles WHERE auth_user_id = '00000000-0000-0000-0000-000000000004' LIMIT 1),
        'submitted', now(),
        (SELECT id FROM user_profiles WHERE auth_user_id = '00000000-0000-0000-0000-000000000004' LIMIT 1));
-- required_approval_steps_snapshot intentionally NULL (legacy pre-S28)

SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';
SELECT approve_expense_v2('eeeeeeee-0000-0000-0000-000000000016');

-- ============================================================================
SELECT plan(18);

-- T1: auto_approved=true on 50k (stable flag, unaffected by T12 'paid' update)
SELECT is(
  (SELECT auto_approved FROM expenses WHERE id = 'eeeeeeee-0000-0000-0000-000000000001'),
  true,
  'T1 : amount 50k → auto_approved=true (auto-approve bracket [0, 100k))'
);

-- T2: snapshot 1 step
SELECT is(
  (SELECT jsonb_array_length(required_approval_steps_snapshot)
   FROM expenses WHERE id = 'eeeeeeee-0000-0000-0000-000000000002'),
  1,
  'T2 : amount 500k → snapshot has 1 step'
);

-- T3: snapshot 2 steps
SELECT is(
  (SELECT jsonb_array_length(required_approval_steps_snapshot)
   FROM expenses WHERE id = 'eeeeeeee-0000-0000-0000-000000000003'),
  2,
  'T3 : amount 2M → snapshot has 2 steps'
);

-- T4: SOD creator block (creator = EMP003, approves own T2 expense)
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
SELECT throws_ok(
  $$ SELECT approve_expense_v2('eeeeeeee-0000-0000-0000-000000000002') $$,
  'P0001', NULL,
  'T4 : SOD creator block → P0001 sod_creator_block'
);

-- T5: CASHIER (EMP001, auth _002) missing expenses.approve
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
SELECT throws_ok(
  $$ SELECT approve_expense_v2('eeeeeeee-0000-0000-0000-000000000002') $$,
  '42501', NULL,
  'T5 : CASHIER missing expenses.approve → 42501'
);

-- T6: T3 step 1 was approved in fixtures by EMP000 → step counter = 1
SELECT is(
  (SELECT current_approval_step FROM expenses WHERE id = 'eeeeeeee-0000-0000-0000-000000000003'),
  1::SMALLINT,
  'T6 : step 1 by SUPER_ADMIN → current_approval_step=1'
);

-- T7: same EMP000 tries to approve T3 step 2 → sod_already_approved
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';
SELECT throws_ok(
  $$ SELECT approve_expense_v2('eeeeeeee-0000-0000-0000-000000000003') $$,
  'P0001', NULL,
  'T7 : same approver cannot approve twice → P0001 sod_already_approved'
);

-- T8: different ADMIN (bbbbbbbb-...) approves T3 step 2 → status=approved
SET LOCAL "request.jwt.claims" = '{"sub":"bbbbbbbb-0000-0000-0000-000000000001"}';
SELECT approve_expense_v2('eeeeeeee-0000-0000-0000-000000000003');

SELECT is(
  (SELECT status FROM expenses WHERE id = 'eeeeeeee-0000-0000-0000-000000000003'),
  'approved',
  'T8 : final step by ADMIN → status=approved'
);

-- T9: overlapping NULL-category range [50k, 200k) conflicts with existing [0, 100k)
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';
SELECT throws_ok(
  $$ SELECT set_expense_threshold_v1(NULL, NULL, 50000, 200000, '[]'::jsonb) $$,
  'P0002', NULL,
  'T9 : overlapping NULL-category range → P0002 threshold_overlap'
);

-- T10: MANAGER missing expenses.thresholds.write
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
SELECT throws_ok(
  $$ SELECT set_expense_threshold_v1(NULL, NULL, 10000000, 20000000, '[]'::jsonb) $$,
  '42501', NULL,
  'T10 : MANAGER missing expenses.thresholds.write → 42501'
);

-- T11: category-specific 2-step wins over NULL 1-step default
SELECT is(
  (SELECT jsonb_array_length(required_approval_steps_snapshot)
   FROM expenses WHERE id = 'eeeeeeee-0000-0000-0000-000000000011'),
  2,
  'T11 : category-specific 2-step override wins over NULL 1-step default'
);

-- T12: cash sync trigger — open POS session then mark expense paid
INSERT INTO pos_sessions (id, opened_by, opening_cash, status)
VALUES ('cccccccc-0000-0000-0000-000000000001',
        (SELECT id FROM user_profiles WHERE auth_user_id = '00000000-0000-0000-0000-000000000004' LIMIT 1),
        100000, 'open');

UPDATE expenses
SET status  = 'paid',
    paid_at = now(),
    paid_by = (SELECT id FROM user_profiles WHERE auth_user_id = '00000000-0000-0000-0000-000000000004' LIMIT 1)
WHERE id = 'eeeeeeee-0000-0000-0000-000000000001';

SELECT is(
  (SELECT cash_out_total FROM pos_sessions WHERE id = 'cccccccc-0000-0000-0000-000000000001'),
  50000::NUMERIC,
  'T12 : cash sync trigger → pos_sessions.cash_out_total += 50000'
);

-- T13: no open session → audit_log written, UPDATE not blocked
UPDATE pos_sessions SET status = 'closed' WHERE id = 'cccccccc-0000-0000-0000-000000000001';

INSERT INTO expenses (id, expense_number, category_id, amount, vat_amount, payment_method,
                      description, expense_date, created_by, status)
VALUES ('eeeeeeee-0000-0000-0000-000000000013', 'EXP-GOV28-013', 'aaaaaaaa-0000-0000-0000-000000000001',
        30000, 0, 'cash', 'T13', CURRENT_DATE,
        (SELECT id FROM user_profiles WHERE auth_user_id = '00000000-0000-0000-0000-000000000004' LIMIT 1),
        'approved');

UPDATE expenses
SET status  = 'paid',
    paid_at = now(),
    paid_by = (SELECT id FROM user_profiles WHERE auth_user_id = '00000000-0000-0000-0000-000000000004' LIMIT 1)
WHERE id = 'eeeeeeee-0000-0000-0000-000000000013';

SELECT ok(
  EXISTS (SELECT 1 FROM audit_logs
          WHERE entity_id = 'eeeeeeee-0000-0000-0000-000000000013'::UUID
            AND action    = 'expense.cash_paid_no_session'),
  'T13 : no open session → audit_log expense.cash_paid_no_session written, no block'
);

-- T14: audit_log completeness for threshold + approval
SELECT ok(
  (SELECT COUNT(*) >= 1 FROM audit_logs
   WHERE entity_type = 'expense_approval_thresholds' AND action = 'expense_threshold.created')
  AND
  (SELECT COUNT(*) >= 1 FROM audit_logs
   WHERE entity_type = 'expense' AND action = 'expense.approved_step'),
  'T14 : audit_log rows written for set_expense_threshold_v1 and approve_expense_v2'
);

-- T15: boundary 100k inclusive lower → 2-step category bracket
SELECT is(
  (SELECT jsonb_array_length(required_approval_steps_snapshot)
   FROM expenses WHERE id = 'eeeeeeee-0000-0000-0000-000000000015'),
  2,
  'T15 : boundary 100k inclusive lower → category [100k, 1M) 2-step bracket'
);

-- T16: legacy NULL snapshot → fallback 1-step → approved
SELECT is(
  (SELECT status FROM expenses WHERE id = 'eeeeeeee-0000-0000-0000-000000000016'),
  'approved',
  'T16 : legacy expense (NULL snapshot) → fallback 1-step → status=approved'
);

-- T17: delete category-specific threshold
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';

DO $$
DECLARE v_tid UUID;
BEGIN
  SELECT id INTO v_tid FROM expense_approval_thresholds
  WHERE category_id = 'aaaaaaaa-0000-0000-0000-000000000001' LIMIT 1;
  IF v_tid IS NULL THEN RAISE EXCEPTION 'T17: category threshold not found'; END IF;
  PERFORM delete_expense_threshold_v1(v_tid);
  PERFORM set_config('test.t17_tid', v_tid::TEXT, false);
END $$;

SELECT ok(
  NOT EXISTS (SELECT 1 FROM expense_approval_thresholds
              WHERE id = current_setting('test.t17_tid')::UUID),
  'T17 : delete_expense_threshold_v1 → row removed'
);

-- T18: anon REVOKE on all 4 S28 RPCs
SELECT is(
  (SELECT bool_and(NOT has_function_privilege('anon', oid, 'EXECUTE'))
   FROM pg_proc
   WHERE proname IN ('submit_expense_v2', 'approve_expense_v2',
                     'set_expense_threshold_v1', 'delete_expense_threshold_v1')),
  true,
  'T18 : anon REVOKEd on all 4 S28 RPCs'
);

SELECT * FROM finish();

ROLLBACK;
