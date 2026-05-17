-- 20260523000012_fix_record_rate_limit_v1_race.sql
-- Session 19 / Phase 1.A — Fix race in record_rate_limit_v1.
--
-- Code review found that when two concurrent service-role callers hit the
-- same (p_function_name, p_bucket_key) with no live bucket, both SELECT…FOR
-- UPDATE return zero rows (predicate locking on absent rows is a no-op in
-- Postgres) and both proceed to INSERT, producing duplicate live buckets
-- and effectively doubling the allowed budget for that window.
--
-- Mitigation : pg_advisory_xact_lock keyed on a stable hash of
-- (function_name, bucket_key). Cheap (one int8 lock per call) and only
-- serializes concurrent callers of the SAME bucket.
--
-- Also adds the inclusive-bound semantics note to the header per code
-- review MINOR item.

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
-- Semantics : current_count >= p_max_per_window rejects ; i.e.,
-- p_max_per_window is the inclusive upper bound on allowed requests
-- in a window.
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

  -- Serialize concurrent callers of the SAME bucket. Lock released at
  -- transaction commit/rollback. Other (function_name, bucket_key) tuples
  -- run independently.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_function_name || '|' || p_bucket_key, 0)
  );

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
    INSERT INTO edge_function_rate_limits
      (function_name, bucket_key, ip_address, request_count, window_start, window_end)
    VALUES
      (p_function_name, p_bucket_key, p_ip_address, 1, now(), now() + make_interval(secs => p_window_sec));
    RETURN QUERY SELECT TRUE, 0, 1;
    RETURN;
  END IF;

  IF v_live_count >= p_max_per_window THEN
    RETURN QUERY SELECT
      FALSE,
      GREATEST(0, EXTRACT(EPOCH FROM (v_live_window_end - now()))::INT),
      v_live_count;
    RETURN;
  END IF;

  UPDATE edge_function_rate_limits
  SET request_count = v_live_count + 1
  WHERE id = v_live_id;

  RETURN QUERY SELECT TRUE, 0, v_live_count + 1;
END;
$$;

COMMENT ON FUNCTION record_rate_limit_v1(TEXT, TEXT, TEXT, INT, INT) IS
  'Session 19 — atomic rate-limit upsert. Called from Edge Functions via '
  'checkRateLimitDurable in _shared/rate-limit.ts. Service-role only. '
  'Concurrency-safe via pg_advisory_xact_lock keyed on (function_name, bucket_key) '
  '— see fix migration 20260523000012.';

-- Grants are preserved across CREATE OR REPLACE for SECURITY DEFINER functions,
-- but re-assert to be safe.
REVOKE ALL ON FUNCTION record_rate_limit_v1(TEXT, TEXT, TEXT, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_rate_limit_v1(TEXT, TEXT, TEXT, INT, INT) FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION record_rate_limit_v1(TEXT, TEXT, TEXT, INT, INT) TO service_role;
