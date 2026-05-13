-- supabase/tests/marketing.test.sql
-- Session 13 / Phase 6.B — pgTAP suite for the marketing cascade :
--   * customers.birth_date / marketing_consent schema additions
--   * 3 RPCs (get_customer_cohort_v1, get_customer_segments_v1,
--             get_promo_roi_v1)
--   * notify_birthday_customers_v1() wrapper
--   * pg_cron job `birthday-notify-daily`
--
-- Coverage T_MKT_01..08 :
--   T_MKT_01 : schema additions present (cols + index)
--   T_MKT_02 : RPCs declared
--   T_MKT_03 : cron job registered
--   T_MKT_04 : wrapper enqueues for opted-in customer with today's birthday
--   T_MKT_05 : wrapper SKIPS customer with marketing_consent=false
--   T_MKT_06 : wrapper SKIPS customer with NULL email
--   T_MKT_07 : wrapper SKIPS customer whose birthday != today
--   T_MKT_08 : wrapper is idempotent — second call returns 0 added new rows
--
-- Runner : MCP execute_sql wrapped in BEGIN ... ROLLBACK.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(19);

-- ---------------------------------------------------------------------------
-- T_MKT_01 : schema additions
-- ---------------------------------------------------------------------------

SELECT has_column('customers', 'birth_date',
  'T_MKT_01a customers.birth_date column exists');
SELECT has_column('customers', 'marketing_consent',
  'T_MKT_01b customers.marketing_consent column exists');

SELECT col_type_is('customers', 'birth_date', 'date',
  'T_MKT_01c birth_date is DATE');
SELECT col_type_is('customers', 'marketing_consent', 'boolean',
  'T_MKT_01d marketing_consent is BOOLEAN');

SELECT ok(
  (SELECT 1 FROM pg_indexes
     WHERE tablename='customers' AND indexname='idx_customers_birthday') = 1,
  'T_MKT_01e idx_customers_birthday index registered'
);

-- ---------------------------------------------------------------------------
-- T_MKT_02 : RPCs declared
-- ---------------------------------------------------------------------------

SELECT has_function('public', 'get_customer_cohort_v1', ARRAY['date','integer'],
  'T_MKT_02a get_customer_cohort_v1 exists');
SELECT has_function('public', 'get_customer_segments_v1', ARRAY['text'],
  'T_MKT_02b get_customer_segments_v1 exists');
SELECT has_function('public', 'get_promo_roi_v1', ARRAY['uuid','date','date'],
  'T_MKT_02c get_promo_roi_v1 exists');
SELECT has_function('public', 'notify_birthday_customers_v1',
  'T_MKT_02d notify_birthday_customers_v1 exists');

-- ---------------------------------------------------------------------------
-- T_MKT_03 : cron job
-- ---------------------------------------------------------------------------

SELECT ok(
  (SELECT COUNT(*)::INT FROM cron.job WHERE jobname='birthday-notify-daily') = 1,
  'T_MKT_03a birthday-notify-daily cron job exists'
);

SELECT is(
  (SELECT schedule FROM cron.job WHERE jobname='birthday-notify-daily'),
  '0 9 * * *',
  'T_MKT_03b birthday-notify-daily runs at 09:00 daily (UTC)'
);

-- ---------------------------------------------------------------------------
-- Test fixtures : 4 customers
--   A : opted-in, today's birthday, with email          -> ENQUEUE
--   B : NOT opted-in, today's birthday                  -> SKIP
--   C : opted-in, today's birthday, NULL email          -> SKIP
--   D : opted-in, OTHER day birthday, with email        -> SKIP
-- ---------------------------------------------------------------------------

INSERT INTO public.customers
  (id, name, email, customer_type, loyalty_points, lifetime_points,
   total_spent, total_visits, marketing_consent, birth_date)
VALUES
  ('aaaa1111-0000-0000-0000-000000000001', 'Cust A', 'a@test.local',
   'retail'::customer_type, 0, 0, 0, 0, true,  current_date),
  ('aaaa1111-0000-0000-0000-000000000002', 'Cust B', 'b@test.local',
   'retail'::customer_type, 0, 0, 0, 0, false, current_date),
  ('aaaa1111-0000-0000-0000-000000000003', 'Cust C', NULL,
   'retail'::customer_type, 0, 0, 0, 0, true,  current_date),
  ('aaaa1111-0000-0000-0000-000000000004', 'Cust D', 'd@test.local',
   'retail'::customer_type, 0, 0, 0, 0, true,  current_date - INTERVAL '37 days');

-- ---------------------------------------------------------------------------
-- T_MKT_04..07 : wrapper eligibility filter
-- ---------------------------------------------------------------------------

-- First invocation : exactly 1 row enqueued (Cust A).
SELECT is(
  (SELECT public.notify_birthday_customers_v1()),
  1,
  'T_MKT_04 wrapper enqueues exactly 1 customer (only Cust A qualifies)'
);

SELECT is(
  (SELECT COUNT(*)::INT FROM public.notification_outbox
     WHERE recipient = 'a@test.local'
       AND template_code = 'customer_birthday'),
  1,
  'T_MKT_05 Cust A row exists in outbox'
);

SELECT is(
  (SELECT COUNT(*)::INT FROM public.notification_outbox
     WHERE recipient = 'b@test.local'),
  0,
  'T_MKT_06 Cust B (consent=false) skipped'
);

SELECT is(
  (SELECT COUNT(*)::INT FROM public.notification_outbox
     WHERE recipient = 'd@test.local'),
  0,
  'T_MKT_07 Cust D (different birthday) skipped'
);

-- ---------------------------------------------------------------------------
-- T_MKT_08 : idempotency — same idempotency_key, same row, no duplicate insert.
-- ---------------------------------------------------------------------------

SELECT public.notify_birthday_customers_v1();  -- re-run

SELECT is(
  (SELECT COUNT(*)::INT FROM public.notification_outbox
     WHERE recipient = 'a@test.local'
       AND template_code = 'customer_birthday'),
  1,
  'T_MKT_08 wrapper is idempotent — Cust A still has exactly 1 outbox row'
);

-- ---------------------------------------------------------------------------
-- T_MKT_BONUS : function gating — running as postgres role bypasses
-- `auth.uid()` (returns NULL), so the RPCs raise permission_denied (42501).
-- We assert this consistent behaviour so callers know they need a JWT
-- with reports.read to execute these RPCs.
-- ---------------------------------------------------------------------------

SELECT throws_ok(
  $$ SELECT public.get_customer_segments_v1('all') $$,
  '42501',
  NULL,
  'T_MKT_BONUS_01 segments RPC enforces reports.read (42501 without JWT)'
);

SELECT throws_ok(
  $$ SELECT public.get_customer_cohort_v1(date_trunc('month', current_date - INTERVAL '6 months')::date, 6) $$,
  '42501',
  NULL,
  'T_MKT_BONUS_02 cohort RPC enforces reports.read'
);

SELECT throws_ok(
  $$ SELECT public.get_promo_roi_v1('00000000-0000-0000-0000-000000000000'::uuid, current_date - 30, current_date) $$,
  '42501',
  NULL,
  'T_MKT_BONUS_03 promo ROI enforces reports.read'
);

-- ---------------------------------------------------------------------------
-- finish
-- ---------------------------------------------------------------------------

SELECT * FROM finish();

ROLLBACK;
