-- S72 Lot 1 — POS terminal registry for the operational audit journal.
-- Each physical terminal (counter / tablet / KDS / kiosk) holds an opaque
-- device_token in its localStorage; the token identifies the device across
-- restarts and offline spans. Rows are auto-provisioned on first event batch
-- (kind='unknown', is_registered=false) and a manager names/confirms them via
-- register_pos_device_v1. Read = managers (reports.audit.read); no client DML.

CREATE TABLE public.pos_devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_token  text NOT NULL UNIQUE,
  label         text NOT NULL,
  kind          text NOT NULL DEFAULT 'unknown'
                  CHECK (kind IN ('counter','tablet','kds','kiosk','unknown')),
  is_registered boolean NOT NULL DEFAULT false,
  registered_by uuid,
  registered_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  is_active     boolean NOT NULL DEFAULT true
);

ALTER TABLE public.pos_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY pos_devices_read ON public.pos_devices
  FOR SELECT TO authenticated
  USING (has_permission(auth.uid(), 'reports.audit.read'));

REVOKE ALL ON public.pos_devices FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.pos_devices FROM authenticated;
GRANT SELECT ON public.pos_devices TO authenticated;

-- Manager registers / renames a terminal (idempotent on token).
CREATE OR REPLACE FUNCTION public.register_pos_device_v1(
  p_device_token text,
  p_label        text,
  p_kind         text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.audit.read') THEN
    RAISE EXCEPTION 'permission denied: reports.audit.read required' USING ERRCODE = '42501';
  END IF;
  IF p_device_token IS NULL OR length(p_device_token) < 8 THEN
    RAISE EXCEPTION 'device_token required (>= 8 chars)' USING ERRCODE = 'P0001';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('counter','tablet','kds','kiosk','unknown') THEN
    RAISE EXCEPTION 'invalid kind' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.pos_devices (device_token, label, kind, is_registered, registered_by, registered_at)
    VALUES (p_device_token, COALESCE(NULLIF(trim(p_label),''), 'Terminal'), p_kind, true, auth.uid(), now())
    ON CONFLICT (device_token) DO UPDATE
      SET label = EXCLUDED.label,
          kind = EXCLUDED.kind,
          is_registered = true,
          registered_by = auth.uid(),
          registered_at = now()
    RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.register_pos_device_v1(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_pos_device_v1(text, text, text) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
COMMENT ON TABLE public.pos_devices IS
  'S72 POS terminal registry (opaque device_token per physical device); auto-provisioned on first event, named by a manager via register_pos_device_v1. Append-only-ish: no client DML.';
