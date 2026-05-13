-- 20260517000181_pick_notifications_batch_rpc.sql
-- Session 13 / Phase 5.B — companion RPC for notification-dispatch EF.
--
-- Atomically claims a batch of queued/retry-due outbox rows by marking
-- them `sending` in a single transaction. Uses FOR UPDATE SKIP LOCKED so
-- concurrent dispatchers don't fight over the same rows.
--
-- Called only by service_role (the EF). NOT exposed to authenticated.

CREATE OR REPLACE FUNCTION pick_notifications_batch_v1(p_limit INT DEFAULT 50)
RETURNS TABLE (
  id              UUID,
  template_code   TEXT,
  channel         TEXT,
  recipient       TEXT,
  subject         TEXT,
  body            TEXT,
  status          TEXT,
  retries         INT,
  scheduled_for   TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT o.id
    FROM   notification_outbox o
    WHERE  o.status IN ('queued','retry')
      AND  o.scheduled_for <= now()
    ORDER  BY o.scheduled_for ASC, o.created_at ASC
    LIMIT  GREATEST(p_limit, 1)
    FOR UPDATE SKIP LOCKED
  ),
  bumped AS (
    UPDATE notification_outbox o
       SET status = 'sending'
      FROM picked p
     WHERE o.id = p.id
   RETURNING o.id, o.template_code, o.channel, o.recipient, o.subject, o.body,
             o.status, o.retries, o.scheduled_for
  )
  SELECT b.id, b.template_code, b.channel, b.recipient, b.subject, b.body,
         b.status, b.retries, b.scheduled_for
  FROM bumped b;
END;
$$;

COMMENT ON FUNCTION pick_notifications_batch_v1(INT) IS
  'Session 13 / Phase 5.B — service_role-only batch claim for notification-dispatch EF. Marks claimed rows status=sending atomically. FOR UPDATE SKIP LOCKED.';

REVOKE ALL ON FUNCTION pick_notifications_batch_v1(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pick_notifications_batch_v1(INT) TO service_role;
