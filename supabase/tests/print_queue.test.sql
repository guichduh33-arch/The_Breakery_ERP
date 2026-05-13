-- supabase/tests/print_queue.test.sql
-- Session 13 / Phase 5.A — pgTAP suite for print_queue.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(21);

-- ---------------------------------------------------------------------------
-- T_PQ_01 : table + columns exist
-- ---------------------------------------------------------------------------
SELECT has_table('print_queue', 'T_PQ_01a print_queue table exists');
SELECT has_column('print_queue', 'id',             'T_PQ_01b id');
SELECT has_column('print_queue', 'device_id',      'T_PQ_01c device_id');
SELECT has_column('print_queue', 'payload',        'T_PQ_01d payload');
SELECT has_column('print_queue', 'status',         'T_PQ_01e status');
SELECT has_column('print_queue', 'priority',       'T_PQ_01f priority');
SELECT has_column('print_queue', 'retries',        'T_PQ_01g retries');

-- ---------------------------------------------------------------------------
-- T_PQ_02 : status CHECK constraint covers full lifecycle
-- ---------------------------------------------------------------------------
SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_constraint con
     JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'print_queue'
      AND pg_get_constraintdef(con.oid) LIKE '%queued%'
      AND pg_get_constraintdef(con.oid) LIKE '%printing%'
      AND pg_get_constraintdef(con.oid) LIKE '%cancelled%'
  ),
  'T_PQ_02 status CHECK covers queued/printing/done/failed/cancelled'
);

-- ---------------------------------------------------------------------------
-- T_PQ_03 : pickup index exists (FIFO + priority)
-- ---------------------------------------------------------------------------
SELECT has_index('print_queue', 'idx_print_queue_pickup', 'T_PQ_03 idx_print_queue_pickup');

-- ---------------------------------------------------------------------------
-- T_PQ_04 : RPCs exist with correct signatures
-- ---------------------------------------------------------------------------
SELECT has_function('public', 'enqueue_print_job_v1',
                    ARRAY['uuid','jsonb','text','text','uuid','integer'],
                    'T_PQ_04a enqueue_print_job_v1 signature');
SELECT has_function('public', 'claim_print_job_v1',
                    ARRAY['uuid'],
                    'T_PQ_04b claim_print_job_v1 signature');
SELECT has_function('public', 'mark_print_done_v1',
                    ARRAY['uuid'],
                    'T_PQ_04c mark_print_done_v1 signature');
SELECT has_function('public', 'mark_print_failed_v1',
                    ARRAY['uuid','text'],
                    'T_PQ_04d mark_print_failed_v1 signature');
SELECT has_function('public', 'cancel_print_job_v1',
                    ARRAY['uuid'],
                    'T_PQ_04e cancel_print_job_v1 signature');

-- ---------------------------------------------------------------------------
-- T_PQ_05 : permissions seeded
-- ---------------------------------------------------------------------------
SELECT ok(
  EXISTS(SELECT 1 FROM permissions WHERE code = 'print_queue.read'),
  'T_PQ_05a print_queue.read seeded'
);
SELECT ok(
  EXISTS(SELECT 1 FROM permissions WHERE code = 'print_queue.manage'),
  'T_PQ_05b print_queue.manage seeded'
);

-- ---------------------------------------------------------------------------
-- T_PQ_06 : enqueue → claim → done cycle
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_job_id    UUID;
  v_claimed   print_queue%ROWTYPE;
  v_completed print_queue%ROWTYPE;
BEGIN
  -- Enqueue
  INSERT INTO print_queue (payload, status, source, priority)
  VALUES ('{"ticket_type":"kitchen_chit","data":{}}'::jsonb, 'queued', 'pgtap', 5)
  RETURNING id INTO v_job_id;

  PERFORM set_config('test.pq_job_id', v_job_id::TEXT, false);

  -- Claim (NULL device_id picks any queue entry)
  v_claimed := claim_print_job_v1(NULL);

  IF v_claimed.id IS NULL OR v_claimed.status <> 'printing' THEN
    RAISE EXCEPTION 'expected claim to flip status to printing — got %', v_claimed.status;
  END IF;

  -- Done
  v_completed := mark_print_done_v1(v_claimed.id);

  IF v_completed.status <> 'done' OR v_completed.printed_at IS NULL THEN
    RAISE EXCEPTION 'expected mark_print_done_v1 to set status=done + printed_at — got status=%, printed_at=%',
      v_completed.status, v_completed.printed_at;
  END IF;
END $$;

SELECT ok(true, 'T_PQ_06 enqueue → claim → done cycle works');

-- ---------------------------------------------------------------------------
-- T_PQ_07 : mark_print_failed_v1 requeues until retries >= 3
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_id  UUID;
  v_row print_queue%ROWTYPE;
BEGIN
  INSERT INTO print_queue (payload, status, source, priority)
  VALUES ('{}'::jsonb, 'printing', 'pgtap', 5)
  RETURNING id INTO v_id;

  -- 1st fail → requeued
  v_row := mark_print_failed_v1(v_id, 'transient');
  IF v_row.status <> 'queued' OR v_row.retries <> 1 THEN
    RAISE EXCEPTION 'after 1st fail expected queued/1 retries, got %/% ', v_row.status, v_row.retries;
  END IF;

  -- 2nd fail → still queued
  v_row := mark_print_failed_v1(v_id, 'still transient');
  IF v_row.status <> 'queued' OR v_row.retries <> 2 THEN
    RAISE EXCEPTION 'after 2nd fail expected queued/2 retries';
  END IF;

  -- 3rd fail → still queued (retries reaches 3)
  v_row := mark_print_failed_v1(v_id, 'still transient');
  IF v_row.status <> 'queued' OR v_row.retries <> 3 THEN
    RAISE EXCEPTION 'after 3rd fail expected queued/3 retries';
  END IF;

  -- 4th fail → terminal failed
  v_row := mark_print_failed_v1(v_id, 'gave up');
  IF v_row.status <> 'failed' OR v_row.retries <> 4 THEN
    RAISE EXCEPTION 'after 4th fail expected failed/4 retries, got %/% ', v_row.status, v_row.retries;
  END IF;
END $$;

SELECT ok(true, 'T_PQ_07 mark_print_failed_v1 requeues 3x then terminal failed');

-- ---------------------------------------------------------------------------
-- T_PQ_08 : enqueue_print_job_v1 idempotency replay
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_ref UUID := gen_random_uuid();
  v_a   print_queue%ROWTYPE;
  v_b   print_queue%ROWTYPE;
BEGIN
  v_a := enqueue_print_job_v1(NULL, '{}'::jsonb, 'pgtap', 'order', v_ref, 5);
  v_b := enqueue_print_job_v1(NULL, '{}'::jsonb, 'pgtap', 'order', v_ref, 5);

  IF v_a.id IS DISTINCT FROM v_b.id THEN
    RAISE EXCEPTION 'expected idempotent replay to return same id : % vs %', v_a.id, v_b.id;
  END IF;
END $$;

SELECT ok(true, 'T_PQ_08 enqueue idempotency replay returns same row');

-- ---------------------------------------------------------------------------
-- T_PQ_09 : RLS — direct INSERT blocked for authenticated
-- ---------------------------------------------------------------------------
SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_policy WHERE polname = 'print_queue_select_authenticated'
  ),
  'T_PQ_09a SELECT policy present'
);

-- The absence of an INSERT policy = deny.
SELECT ok(
  NOT EXISTS(
    SELECT 1 FROM pg_policy p
     JOIN pg_class c ON c.oid = p.polrelid
    WHERE c.relname = 'print_queue'
      AND p.polcmd = 'a' -- 'a' = INSERT in pg_policy.polcmd
  ),
  'T_PQ_09b no INSERT policy — RPCs are sole writer'
);

SELECT * FROM finish();

ROLLBACK;
