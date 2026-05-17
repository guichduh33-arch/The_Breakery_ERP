-- 20260523000010_create_record_rate_limit_v1_rpc.sql
-- Session 19 / Phase 1.A — Durable rate-limit primitive (Thread A).
--
-- Atomic upsert against edge_function_rate_limits (S13 migration
-- 20260517000031). Single CTE statement holds a brief row-lock on the
-- live bucket. SECURITY DEFINER ; service_role only.
--
-- Decision refs : D1 (mem + durable layered), D4 (5 EFs), D11 (svc-role only),
-- D19 (migration block 20260523000010..011 = Thread A).

CREATE OR REPLACE FUNCTION record_rate_limit_v1(
  p_function_name   TEXT,
  p_bucket_key      TEXT,
  p_ip_address      TEXT,
  p_max_per_window  INT,
  p_window_sec      INT DEFAULT 60
) RETURNS TABLE (
  allowed         BOOLEAN,
  retry_after_sec INT,
  current_count   INT
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_live_id          BIGINT;
  v_live_count       INT;
  v_live_window_end  TIMESTAMPTZ;
BEGIN
  IF p_function_name IS NULL OR length(p_function_name) = 0 THEN
    RAISE EXCEPTION 'function_name_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_bucket_key IS NULL OR length(p_bucket_key) = 0 THEN
    RAISE EXCEPTION 'bucket_key_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_max_per_window IS NULL OR p_max_per_window <= 0 THEN
    RAISE EXCEPTION 'max_per_window_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF p_window_sec IS NULL OR p_window_sec <= 0 THEN
    RAISE EXCEPTION 'window_sec_invalid' USING ERRCODE = 'P0001';
  END IF;

  -- Pick the live bucket for (function_name, bucket_key) if any.
  SELECT id, request_count, window_end
    INTO v_live_id, v_live_count, v_live_window_end
  FROM edge_function_rate_limits
  WHERE function_name = p_function_name
    AND bucket_key    = p_bucket_key
    AND window_end    > now()
  ORDER BY window_end DESC
  LIMIT 1
  FOR UPDATE;

  IF v_live_id IS NULL THEN
    -- No live bucket → open a new window with count=1.
    INSERT INTO edge_function_rate_limits
      (function_name, bucket_key, ip_address, request_count, window_start, window_end)
    VALUES
      (p_function_name, p_bucket_key, p_ip_address, 1, now(), now() + make_interval(secs => p_window_sec));
    RETURN QUERY SELECT TRUE, 0, 1;
    RETURN;
  END IF;

  IF v_live_count >= p_max_per_window THEN
    -- Bucket full → reject + report retry.
    RETURN QUERY SELECT
      FALSE,
      GREATEST(0, EXTRACT(EPOCH FROM (v_live_window_end - now()))::INT),
      v_live_count;
    RETURN;
  END IF;

  -- Bump the existing bucket.
  UPDATE edge_function_rate_limits
  SET request_count = v_live_count + 1
  WHERE id = v_live_id;

  RETURN QUERY SELECT TRUE, 0, v_live_count + 1;
END;
$$;

COMMENT ON FUNCTION record_rate_limit_v1(TEXT, TEXT, TEXT, INT, INT) IS
  'Session 19 — atomic rate-limit upsert. Called from Edge Functions via '
  'checkRateLimitDurable in _shared/rate-limit.ts. Service-role only.';

REVOKE ALL ON FUNCTION record_rate_limit_v1(TEXT, TEXT, TEXT, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_rate_limit_v1(TEXT, TEXT, TEXT, INT, INT) FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION record_rate_limit_v1(TEXT, TEXT, TEXT, INT, INT) TO service_role;
