-- supabase/tests/b2b_credit.test.sql
-- Session 13 / Phase 3.C — pgTAP suite for validate_b2b_credit_limit_v1.
--
-- T_B2B_01: function exists
-- T_B2B_02: retail customer always allowed
-- T_B2B_03: b2b with NULL credit_limit returns unlimited (available=NULL)
-- T_B2B_04: b2b within limit returns allowed=true
-- T_B2B_05: b2b over limit returns allowed=false + would_exceed_by > 0
-- T_B2B_06: unknown customer raises customer_not_found

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(6);

-- Fixtures
INSERT INTO customers (id, name, customer_type)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'B2B_TEST_RETAIL', 'retail');

INSERT INTO customers (id, name, customer_type, b2b_company_name, b2b_credit_limit, b2b_current_balance)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000002', 'B2B_TEST_UNLIMITED', 'b2b', 'PT Unlimited', NULL, 5000000),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'B2B_TEST_CAPPED',    'b2b', 'PT Capped',   1000000, 200000);

-- T1: function exists
SELECT has_function(
  'public', 'validate_b2b_credit_limit_v1',
  ARRAY['uuid','numeric'],
  'T_B2B_01: validate_b2b_credit_limit_v1(uuid, numeric) exists'
);

-- T2: retail always allowed
SELECT is(
  (validate_b2b_credit_limit_v1('aaaaaaaa-0000-0000-0000-000000000001', 999999999)->>'allowed')::boolean,
  TRUE,
  'T_B2B_02: retail customer is always allowed regardless of amount'
);

-- T3: b2b unlimited (NULL limit) -> allowed=true, available=NULL
SELECT is(
  (validate_b2b_credit_limit_v1('aaaaaaaa-0000-0000-0000-000000000002', 50000000)->>'allowed')::boolean,
  TRUE,
  'T_B2B_03: b2b with NULL credit_limit is allowed (unlimited)'
);

-- T4: within limit (balance 200k + order 700k <= 1M)
SELECT is(
  (validate_b2b_credit_limit_v1('aaaaaaaa-0000-0000-0000-000000000003', 700000)->>'allowed')::boolean,
  TRUE,
  'T_B2B_04: b2b within credit limit is allowed'
);

-- T5: over limit (balance 200k + order 900k = 1.1M > 1M -> exceed_by 100k)
SELECT is(
  (validate_b2b_credit_limit_v1('aaaaaaaa-0000-0000-0000-000000000003', 900000))::jsonb,
  jsonb_build_object(
    'allowed', FALSE,
    'customer_type', 'b2b',
    'current_balance', 200000,
    'credit_limit', 1000000,
    'available', 800000,
    'would_exceed_by', 100000
  ),
  'T_B2B_05: b2b over credit limit returns allowed=false + would_exceed_by=100000'
);

-- T6: unknown customer raises customer_not_found
SELECT throws_ok(
  $$ SELECT validate_b2b_credit_limit_v1('00000000-0000-0000-0000-000000000000', 1000) $$,
  'P0002',
  'customer_not_found',
  'T_B2B_06: unknown customer raises customer_not_found (P0002)'
);

SELECT * FROM finish();
ROLLBACK;
