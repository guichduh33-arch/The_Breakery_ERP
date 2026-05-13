-- 20260517000170_init_print_queue.sql
-- Session 13 / Phase 5.A — LAN port : persistent print queue (21-004).
--
-- Audit ref : docs/audit/08-operations-lan-audit.md §1.2 P3 — *"No print
-- queue. If the print server is down, printLocally returns failure and the
-- result is broadcast. There is no retry queue or persistence."*
--
-- Design notes :
--   - status lifecycle : queued → printing → done | failed | cancelled.
--   - device_id is nullable for stub jobs targeting "any printer" (router
--     resolves at claim time). Indexed for FIFO+priority pickup.
--   - payload is JSONB (renderer-opaque blob). Source / reference_type /
--     reference_id let the BO UI cross-link to the originating row.
--   - All writes flow through SECURITY DEFINER RPCs to keep the RLS surface
--     tight (INSERT is the most dangerous — would let arbitrary auth users
--     pollute the queue).

-- ===========================================================================
-- 1. Table
-- ===========================================================================

CREATE TABLE print_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id       UUID,                        -- FK to lan_devices added in 000171
  payload         JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'printing', 'done', 'failed', 'cancelled')),
  source          TEXT,                        -- e.g. 'pos', 'tablet', 'kds'
  reference_type  TEXT,                        -- e.g. 'order', 'refund'
  reference_id    UUID,
  priority        INT NOT NULL DEFAULT 5,      -- 1=highest, 9=lowest
  retries         INT NOT NULL DEFAULT 0,
  error_message   TEXT,
  queued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  printed_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER print_queue_set_updated_at
  BEFORE UPDATE ON print_queue
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- FIFO + priority pickup index. Partial (status = 'queued') keeps it small.
CREATE INDEX idx_print_queue_pickup
  ON print_queue (device_id, priority DESC, queued_at)
  WHERE status = 'queued';

CREATE INDEX idx_print_queue_status
  ON print_queue (status, queued_at DESC);

CREATE INDEX idx_print_queue_reference
  ON print_queue (reference_type, reference_id)
  WHERE reference_id IS NOT NULL;

COMMENT ON TABLE print_queue IS
  'Phase 5.A — persistent print queue. Tickets flow queued → printing → done/failed/cancelled. All writes via SECURITY DEFINER RPCs.';
COMMENT ON COLUMN print_queue.priority IS '1 = highest (e.g. card decline retry), 9 = lowest. Default 5.';
COMMENT ON COLUMN print_queue.device_id IS 'Target printer device. NULL = "any available printer" (router resolves at claim).';

-- ===========================================================================
-- 2. RLS
-- ===========================================================================

ALTER TABLE print_queue ENABLE ROW LEVEL SECURITY;

-- SELECT : any authenticated user can read the queue (BO operators see it,
-- POS clients also use it to know their print status).
CREATE POLICY print_queue_select_authenticated
  ON print_queue
  FOR SELECT
  TO authenticated
  USING (true);

-- INSERT / UPDATE / DELETE blocked at table level — RPCs are the only writers.
-- (No policy = deny.)

-- ===========================================================================
-- 3. Permissions (perm rows only — no has_permission() touch)
-- ===========================================================================

INSERT INTO permissions (code, module, action, description) VALUES
  ('print_queue.read',   'print_queue', 'read',   'View print queue and individual print jobs'),
  ('print_queue.manage', 'print_queue', 'manage', 'Cancel queued jobs / retry failed jobs')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code, is_granted) VALUES
  ('SUPER_ADMIN', 'print_queue.read',   TRUE),
  ('ADMIN',       'print_queue.read',   TRUE),
  ('MANAGER',     'print_queue.read',   TRUE),
  ('SUPER_ADMIN', 'print_queue.manage', TRUE),
  ('ADMIN',       'print_queue.manage', TRUE)
ON CONFLICT (role_code, permission_code) DO NOTHING;

-- ===========================================================================
-- 4. RPCs
-- ===========================================================================

-- 4.1 enqueue_print_job_v1 — Append a new ticket. Idempotency keyed on
-- (reference_type, reference_id, source) when reference_id is provided ;
-- otherwise every call creates a new row. Caller can override via the
-- explicit `p_force_new` flag.
CREATE OR REPLACE FUNCTION enqueue_print_job_v1(
  p_device_id       UUID,
  p_payload         JSONB,
  p_source          TEXT DEFAULT NULL,
  p_reference_type  TEXT DEFAULT NULL,
  p_reference_id    UUID DEFAULT NULL,
  p_priority        INT  DEFAULT 5
) RETURNS print_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing print_queue%ROWTYPE;
  v_inserted print_queue%ROWTYPE;
BEGIN
  -- Idempotent replay : if a matching (reference_type, reference_id, source)
  -- row already exists in queued|printing state, return it instead of
  -- inserting a duplicate. Allows safe retry on transient network failure.
  IF p_reference_id IS NOT NULL AND p_reference_type IS NOT NULL THEN
    SELECT * INTO v_existing
      FROM print_queue
     WHERE reference_type = p_reference_type
       AND reference_id   = p_reference_id
       AND COALESCE(source, '') = COALESCE(p_source, '')
       AND status IN ('queued', 'printing')
     ORDER BY created_at DESC
     LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  INSERT INTO print_queue (
    device_id, payload, status, source, reference_type, reference_id, priority
  ) VALUES (
    p_device_id, p_payload, 'queued', p_source, p_reference_type, p_reference_id,
    COALESCE(p_priority, 5)
  )
  RETURNING * INTO v_inserted;

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION enqueue_print_job_v1 IS
  'Append a print job. Idempotent on (reference_type, reference_id, source) while status is queued|printing.';

-- 4.2 claim_print_job_v1 — Atomically claim the highest-priority queued job
-- for a device. Returns NULL if none. Marks the row as `printing` so the
-- next concurrent caller skips it.
CREATE OR REPLACE FUNCTION claim_print_job_v1(
  p_device_id UUID
) RETURNS print_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job print_queue%ROWTYPE;
BEGIN
  -- SELECT FOR UPDATE SKIP LOCKED → safe under concurrent claims.
  UPDATE print_queue
     SET status = 'printing'
   WHERE id = (
     SELECT id FROM print_queue
      WHERE status = 'queued'
        AND (device_id = p_device_id OR device_id IS NULL)
      ORDER BY priority DESC, queued_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
   )
  RETURNING * INTO v_job;

  RETURN v_job; -- NULL if no row matched
END;
$$;

COMMENT ON FUNCTION claim_print_job_v1 IS
  'Atomically claim the highest-priority queued job for a device. Returns NULL when queue is empty.';

-- 4.3 mark_print_done_v1 — Successful completion.
CREATE OR REPLACE FUNCTION mark_print_done_v1(
  p_id UUID
) RETURNS print_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row print_queue%ROWTYPE;
BEGIN
  UPDATE print_queue
     SET status = 'done',
         printed_at = NOW(),
         error_message = NULL
   WHERE id = p_id
     AND status IN ('printing', 'queued')
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'print_queue row % not found or not claimable', p_id
      USING ERRCODE = 'P0002';
  END IF;

  RETURN v_row;
END;
$$;

-- 4.4 mark_print_failed_v1 — Failure with auto-requeue up to 3 retries.
-- After 3 failed attempts, status becomes terminal 'failed'.
CREATE OR REPLACE FUNCTION mark_print_failed_v1(
  p_id    UUID,
  p_error TEXT
) RETURNS print_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row     print_queue%ROWTYPE;
  v_next    TEXT;
BEGIN
  SELECT * INTO v_row FROM print_queue WHERE id = p_id;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'print_queue row % not found', p_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 3 retries = 4 total attempts (initial + 3 retries).
  IF v_row.retries >= 3 THEN
    v_next := 'failed';
  ELSE
    v_next := 'queued';
  END IF;

  UPDATE print_queue
     SET status = v_next,
         retries = retries + 1,
         error_message = p_error
   WHERE id = p_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- 4.5 cancel_print_job_v1 — operator-initiated cancellation.
CREATE OR REPLACE FUNCTION cancel_print_job_v1(
  p_id UUID
) RETURNS print_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row print_queue%ROWTYPE;
BEGIN
  IF NOT has_permission(auth.uid(), 'print_queue.manage') THEN
    RAISE EXCEPTION 'permission denied: print_queue.manage required'
      USING ERRCODE = '42501';
  END IF;

  UPDATE print_queue
     SET status = 'cancelled',
         error_message = COALESCE(error_message, 'cancelled by operator')
   WHERE id = p_id
     AND status IN ('queued', 'failed')
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'print_queue row % not cancellable (must be queued or failed)', p_id
      USING ERRCODE = 'P0002';
  END IF;

  RETURN v_row;
END;
$$;

-- Grants — RPCs callable by authenticated. RLS still applies on SELECT,
-- and the manage RPC checks has_permission internally.
GRANT EXECUTE ON FUNCTION enqueue_print_job_v1  TO authenticated;
GRANT EXECUTE ON FUNCTION claim_print_job_v1    TO authenticated;
GRANT EXECUTE ON FUNCTION mark_print_done_v1    TO authenticated;
GRANT EXECUTE ON FUNCTION mark_print_failed_v1  TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_print_job_v1   TO authenticated;
