-- 20260706000025_create_import_master_data_idem_and_suppliers_rpc.sql
-- Phase 1 bulk import — shared idempotency table + suppliers import (upsert by code).
-- Dry-run = validate + summary, zero writes. Commit = validate then atomic upsert.
-- Gate suppliers.create. Idempotency S25 flavor 2. Anon defense-in-depth S20.

CREATE TABLE import_master_data_idempotency_keys (
  key        UUID PRIMARY KEY,
  entity     TEXT NOT NULL,
  report     JSONB NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE import_master_data_idempotency_keys IS
  'Phase 1 bulk import idempotency keys (suppliers/customers), S25 flavor 2. Replay returns stored report.';

ALTER TABLE import_master_data_idempotency_keys ENABLE ROW LEVEL SECURITY;
-- No policy: RPC-only access (SECURITY DEFINER bypasses RLS).
REVOKE ALL ON import_master_data_idempotency_keys FROM PUBLIC;
REVOKE ALL ON import_master_data_idempotency_keys FROM anon;
REVOKE ALL ON import_master_data_idempotency_keys FROM authenticated;

CREATE OR REPLACE FUNCTION public.import_suppliers_v1(
  p_payload         JSONB,
  p_dry_run         BOOLEAN DEFAULT TRUE,
  p_idempotency_key UUID    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller    UUID := auth.uid();
  v_existing  JSONB;
  v_errors    JSONB;
  v_summary   JSONB;
  v_report    JSONB;
  v_err_count INT;
  r           RECORD;
BEGIN
  IF v_caller IS NULL OR NOT has_permission(v_caller, 'suppliers.create') THEN
    RAISE EXCEPTION 'permission denied: suppliers.create required' USING ERRCODE = '42501';
  END IF;

  IF NOT p_dry_run THEN
    IF p_idempotency_key IS NULL THEN
      RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = 'P0001';
    END IF;
    SELECT report INTO v_existing
      FROM import_master_data_idempotency_keys WHERE key = p_idempotency_key;
    IF FOUND THEN
      RETURN v_existing || jsonb_build_object('idempotent_replay', true);
    END IF;
  END IF;

  DROP TABLE IF EXISTS t_sup, t_err;

  CREATE TEMP TABLE t_sup ON COMMIT DROP AS
  SELECT ord::INT                                AS row_num,
         NULLIF(trim(elt->>'code'), '')          AS code,
         NULLIF(trim(elt->>'name'), '')          AS name,
         NULLIF(trim(elt->>'contact_phone'), '') AS contact_phone,
         NULLIF(trim(elt->>'contact_email'), '') AS contact_email,
         NULLIF(trim(elt->>'address'), '')       AS address,
         (elt->>'payment_terms_days')::NUMERIC   AS payment_terms_days,
         NULLIF(elt->>'notes', '')               AS notes,
         (elt->>'is_active')::BOOLEAN            AS is_active
    FROM jsonb_array_elements(COALESCE(p_payload, '[]'::jsonb)) WITH ORDINALITY AS t(elt, ord);

  CREATE TEMP TABLE t_err (sheet TEXT, row_num INT, sku TEXT, code TEXT, message TEXT) ON COMMIT DROP;

  -- validation
  INSERT INTO t_err SELECT 'Suppliers', row_num, code, 'missing_required', 'code and name are required'
    FROM t_sup WHERE code IS NULL OR name IS NULL;
  INSERT INTO t_err SELECT 'Suppliers', row_num, code, 'too_long', 'code must be <= 32 chars'
    FROM t_sup WHERE code IS NOT NULL AND char_length(code) > 32;
  INSERT INTO t_err SELECT 'Suppliers', row_num, code, 'too_long', 'name must be <= 120 chars'
    FROM t_sup WHERE name IS NOT NULL AND char_length(name) > 120;
  INSERT INTO t_err SELECT 'Suppliers', row_num, code, 'invalid_payment_terms',
         'payment_terms_days must be an integer between 0 and 365'
    FROM t_sup WHERE payment_terms_days IS NOT NULL
       AND (payment_terms_days <> floor(payment_terms_days) OR payment_terms_days < 0 OR payment_terms_days > 365);
  INSERT INTO t_err SELECT 'Suppliers', MIN(row_num), code, 'duplicate_code',
         format('code "%s" appears %s times in the file', code, COUNT(*))
    FROM t_sup WHERE code IS NOT NULL GROUP BY code HAVING COUNT(*) > 1;

  -- summary (create = new code, update = existing non-deleted code)
  SELECT jsonb_build_object('Suppliers', jsonb_build_object(
    'create', (SELECT COUNT(*) FROM t_sup s WHERE s.code IS NOT NULL
                 AND NOT EXISTS (SELECT 1 FROM suppliers x WHERE x.code = s.code AND x.deleted_at IS NULL)),
    'update', (SELECT COUNT(*) FROM t_sup s WHERE s.code IS NOT NULL
                 AND EXISTS (SELECT 1 FROM suppliers x WHERE x.code = s.code AND x.deleted_at IS NULL))
  )) INTO v_summary;

  SELECT COUNT(*), COALESCE(jsonb_agg(jsonb_build_object(
           'sheet', sheet, 'row', row_num, 'sku', sku, 'code', code, 'message', message) ORDER BY row_num),
         '[]'::jsonb)
    INTO v_err_count, v_errors FROM t_err;

  v_report := jsonb_build_object('valid', v_err_count = 0, 'errors', v_errors,
                                 'summary', v_summary, 'idempotent_replay', false);

  IF p_dry_run OR v_err_count > 0 THEN
    RETURN v_report;
  END IF;

  -- writes: upsert by code
  FOR r IN SELECT * FROM t_sup ORDER BY row_num LOOP
    IF EXISTS (SELECT 1 FROM suppliers WHERE code = r.code AND deleted_at IS NULL) THEN
      UPDATE suppliers SET
        name               = r.name,
        contact_phone      = r.contact_phone,
        contact_email      = r.contact_email,
        address            = r.address,
        payment_terms_days = COALESCE(r.payment_terms_days::INT, payment_terms_days),
        notes              = r.notes,
        is_active          = COALESCE(r.is_active, is_active),
        updated_at         = now()
      WHERE code = r.code AND deleted_at IS NULL;
    ELSE
      INSERT INTO suppliers (code, name, contact_phone, contact_email, address, payment_terms_days, notes, is_active)
      VALUES (r.code, r.name, r.contact_phone, r.contact_email, r.address,
              COALESCE(r.payment_terms_days::INT, 30), r.notes, COALESCE(r.is_active, TRUE));
    END IF;
  END LOOP;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_caller, 'suppliers.imported', 'supplier', NULL, v_summary);

  BEGIN
    INSERT INTO import_master_data_idempotency_keys (key, entity, report, created_by)
    VALUES (p_idempotency_key, 'suppliers', v_report, v_caller);
  EXCEPTION WHEN unique_violation THEN
    SELECT report INTO v_existing FROM import_master_data_idempotency_keys WHERE key = p_idempotency_key;
    RETURN v_existing || jsonb_build_object('idempotent_replay', true);
  END;

  RETURN v_report;
END;
$$;

COMMENT ON FUNCTION public.import_suppliers_v1(JSONB, BOOLEAN, UUID) IS
  'Phase 1 bulk import — suppliers upsert-by-code. Dry-run validation report + atomic commit. Gate suppliers.create.';

REVOKE ALL ON FUNCTION public.import_suppliers_v1(JSONB, BOOLEAN, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.import_suppliers_v1(JSONB, BOOLEAN, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.import_suppliers_v1(JSONB, BOOLEAN, UUID) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
