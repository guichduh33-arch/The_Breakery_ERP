-- Session 13 / Phase 3.C — Migration 134
-- cash_movements ledger + record_cash_movement_v1 RPC.

CREATE TABLE IF NOT EXISTS public.cash_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES public.pos_sessions(id) ON DELETE CASCADE,
  direction       TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount          NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  reason          TEXT NOT NULL CHECK (length(trim(reason)) >= 3),
  idempotency_key UUID UNIQUE,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cash_movements_session
  ON public.cash_movements (session_id, created_at);

ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cash_movements_select_auth ON public.cash_movements;
CREATE POLICY cash_movements_select_auth
  ON public.cash_movements
  FOR SELECT
  TO authenticated
  USING (TRUE);

REVOKE INSERT, UPDATE, DELETE ON public.cash_movements FROM authenticated;
GRANT  SELECT ON public.cash_movements TO authenticated;

CREATE OR REPLACE FUNCTION public.record_cash_movement_v1(
  p_session_id      UUID,
  p_direction       TEXT,
  p_amount          NUMERIC,
  p_reason          TEXT,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid      UUID := auth.uid();
  v_profile  UUID;
  v_status   TEXT;
  v_mvt_id   UUID;
  v_in_tot   NUMERIC(14,2);
  v_out_tot  NUMERIC(14,2);
BEGIN
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'session_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_direction IS NULL OR p_direction NOT IN ('in','out') THEN
    RAISE EXCEPTION 'invalid_direction' USING ERRCODE = 'P0001';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount_must_be_positive' USING ERRCODE = 'P0001';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = 'P0001';
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  IF NOT public.has_permission(v_uid, 'shift.cash_movement') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_mvt_id FROM cash_movements
      WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF FOUND THEN
      SELECT cash_in_total, cash_out_total
        INTO v_in_tot, v_out_tot
        FROM pos_sessions WHERE id = p_session_id;
      RETURN jsonb_build_object(
        'movement_id', v_mvt_id,
        'session_id', p_session_id,
        'cash_in_total', v_in_tot,
        'cash_out_total', v_out_tot,
        'idempotent_replay', TRUE
      );
    END IF;
  END IF;

  SELECT status INTO v_status FROM pos_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status::text <> 'open' THEN
    RAISE EXCEPTION 'session_not_open' USING ERRCODE = 'P0003';
  END IF;

  INSERT INTO cash_movements (session_id, direction, amount, reason, idempotency_key, created_by)
  VALUES (p_session_id, p_direction, p_amount, p_reason, p_idempotency_key, v_profile)
  RETURNING id INTO v_mvt_id;

  IF p_direction = 'in' THEN
    UPDATE pos_sessions SET cash_in_total = cash_in_total + p_amount WHERE id = p_session_id;
  ELSE
    UPDATE pos_sessions SET cash_out_total = cash_out_total + p_amount WHERE id = p_session_id;
  END IF;

  SELECT cash_in_total, cash_out_total INTO v_in_tot, v_out_tot
    FROM pos_sessions WHERE id = p_session_id;

  INSERT INTO audit_log (action, subject_table, subject_id, payload, actor_profile_id)
  VALUES (
    'shift.cash_movement', 'cash_movements', v_mvt_id,
    jsonb_build_object(
      'session_id', p_session_id,
      'direction', p_direction,
      'amount', p_amount,
      'reason', p_reason,
      'idempotency_key', p_idempotency_key
    ),
    v_profile
  );

  RETURN jsonb_build_object(
    'movement_id', v_mvt_id,
    'session_id', p_session_id,
    'cash_in_total', v_in_tot,
    'cash_out_total', v_out_tot,
    'idempotent_replay', FALSE
  );
END $function$;

REVOKE ALL ON FUNCTION public.record_cash_movement_v1(UUID, TEXT, NUMERIC, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_cash_movement_v1(UUID, TEXT, NUMERIC, TEXT, UUID) TO authenticated;

COMMENT ON FUNCTION public.record_cash_movement_v1(UUID, TEXT, NUMERIC, TEXT, UUID) IS
  'Record a mid-shift cash adjustment (direction in|out). Updates pos_sessions.cash_in_total or cash_out_total atomically. Requires shift.cash_movement permission.';
