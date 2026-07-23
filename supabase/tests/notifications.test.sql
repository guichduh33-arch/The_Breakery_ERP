-- supabase/tests/notifications.test.sql
-- Session 13 / Phase 5.B — pgTAP suite for the Notifications pipeline.
--
-- Coverage T_NOTIF_01..06 :
--   T_NOTIF_01 : schema (tables, columns, indexes, triggers)
--   T_NOTIF_02 : 6 seed templates are present + active
--   T_NOTIF_03 : RLS enabled on notification_templates + notification_outbox
--   T_NOTIF_04 : enqueue_notification_v2 happy path — row inserted, subject/body
--                composed, status='queued'
--   T_NOTIF_05 : idempotency replay returns same id
--   T_NOTIF_06 : missing template raises P0002
--
-- Runner : MCP execute_sql wrapped BEGIN ... ROLLBACK.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(21);

-- ---------------------------------------------------------------------------
-- T_NOTIF_01 : schema
-- ---------------------------------------------------------------------------

SELECT has_table('notification_templates', 'T_NOTIF_01a notification_templates table exists');
SELECT has_table('notification_outbox',    'T_NOTIF_01b notification_outbox table exists');

SELECT has_column('notification_templates', 'code',             'T_NOTIF_01c code column');
SELECT has_column('notification_templates', 'channel',          'T_NOTIF_01d channel column');
SELECT has_column('notification_templates', 'body_template',    'T_NOTIF_01e body_template column');
SELECT has_column('notification_outbox',    'idempotency_key',  'T_NOTIF_01f outbox idempotency_key');
SELECT has_column('notification_outbox',    'status',           'T_NOTIF_01g outbox status');
SELECT has_column('notification_outbox',    'retries',          'T_NOTIF_01h outbox retries');

SELECT ok(
  (SELECT 1 FROM pg_indexes WHERE tablename='notification_outbox'
     AND indexname='idx_notification_outbox_status_scheduled') = 1,
  'T_NOTIF_01i partial index on (status, scheduled_for) exists'
);

SELECT ok(
  (SELECT 1 FROM pg_indexes WHERE tablename='notification_outbox'
     AND indexname='uq_notification_outbox_idempotency') = 1,
  'T_NOTIF_01j idempotency unique index exists'
);

-- ---------------------------------------------------------------------------
-- T_NOTIF_02 : 6 active seed templates
-- ---------------------------------------------------------------------------

SELECT is(
  (SELECT COUNT(*)::INT FROM notification_templates WHERE is_active = true),
  6,
  'T_NOTIF_02 6 active notification_templates seeded'
);

SELECT is(
  (SELECT array_agg(code ORDER BY code)::TEXT FROM notification_templates WHERE is_active = true),
  '{customer_birthday,expense_approved,low_stock_alert,order_complete,payment_received,po_received}',
  'T_NOTIF_02b expected template codes present'
);

-- All seeds are email channel for v1.
SELECT is(
  (SELECT COUNT(*)::INT FROM notification_templates WHERE channel = 'email' AND is_active = true),
  6,
  'T_NOTIF_02c all 6 seeds are email channel (D5 MVP)'
);

-- ---------------------------------------------------------------------------
-- T_NOTIF_03 : RLS enabled
-- ---------------------------------------------------------------------------

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'notification_templates'),
  'T_NOTIF_03a RLS enabled on notification_templates'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'notification_outbox'),
  'T_NOTIF_03b RLS enabled on notification_outbox'
);

-- ---------------------------------------------------------------------------
-- T_NOTIF_04 : happy path — enqueue + compose
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_id     UUID;
  v_row    notification_outbox%ROWTYPE;
BEGIN
  v_id := enqueue_notification_v2(
    'order_complete',
    'pgtap@example.com',
    '{"order_number":"ORD-PGT-01","customer_name":"PgTap Tester","total":"42000"}'::jsonb,
    NULL, NULL, NULL
  );
  SELECT * INTO v_row FROM notification_outbox WHERE id = v_id;
  PERFORM set_config('test.notif_happy_id',      v_id::TEXT,         false);
  PERFORM set_config('test.notif_happy_subject', v_row.subject,      false);
  PERFORM set_config('test.notif_happy_body',    v_row.body,         false);
  PERFORM set_config('test.notif_happy_status',  v_row.status,       false);
END $$;

SELECT is(
  current_setting('test.notif_happy_status'),
  'queued',
  'T_NOTIF_04a happy-path row status = queued'
);
SELECT is(
  current_setting('test.notif_happy_subject'),
  'Order ORD-PGT-01 is ready',
  'T_NOTIF_04b subject substituted'
);
SELECT ok(
  current_setting('test.notif_happy_body') LIKE '%PgTap Tester%' AND
  current_setting('test.notif_happy_body') LIKE '%ORD-PGT-01%' AND
  current_setting('test.notif_happy_body') LIKE '%42000%',
  'T_NOTIF_04c body substituted (name + number + total)'
);

-- ---------------------------------------------------------------------------
-- T_NOTIF_05 : idempotency replay
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_key UUID := gen_random_uuid();
  v_id1 UUID;
  v_id2 UUID;
BEGIN
  v_id1 := enqueue_notification_v2(
    'payment_received',
    'idem@example.com',
    '{"order_number":"ORD-IDEM","customer_name":"X","amount":"1000","payment_method":"cash"}'::jsonb,
    NULL, NULL, v_key
  );
  v_id2 := enqueue_notification_v2(
    'payment_received',
    'idem@example.com',
    '{"order_number":"ORD-IDEM","customer_name":"X","amount":"1000","payment_method":"cash"}'::jsonb,
    NULL, NULL, v_key
  );
  PERFORM set_config('test.notif_idem_id1', v_id1::TEXT, false);
  PERFORM set_config('test.notif_idem_id2', v_id2::TEXT, false);
END $$;

SELECT is(
  current_setting('test.notif_idem_id1'),
  current_setting('test.notif_idem_id2'),
  'T_NOTIF_05 same idempotency_key returns the same outbox id'
);

-- And only one row was inserted.
SELECT is(
  (SELECT COUNT(*)::INT FROM notification_outbox WHERE recipient = 'idem@example.com'),
  1,
  'T_NOTIF_05b only one outbox row created for the idempotent pair'
);

-- ---------------------------------------------------------------------------
-- T_NOTIF_06 : missing template raises P0002
-- ---------------------------------------------------------------------------

SELECT throws_ok(
  $$ SELECT enqueue_notification_v2('does_not_exist','x@y.z','{}'::jsonb,NULL,NULL,NULL) $$,
  'P0002',
  NULL,
  'T_NOTIF_06 missing template raises P0002'
);

-- ---------------------------------------------------------------------------
-- Done
-- ---------------------------------------------------------------------------

SELECT * FROM finish();

ROLLBACK;
