-- 20260706000026_create_import_customers_rpc.sql
-- Phase 1 bulk import — customers CREATE-ONLY. Resolves category by name or slug.
-- Flags duplicates (in-file and vs DB) by phone (fallback email). Excludes
-- system-managed columns (balance, points, totals). Gate customers.create.

CREATE OR REPLACE FUNCTION public.import_customers_v1(
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
  v_cat_id    UUID;
BEGIN
  IF v_caller IS NULL OR NOT has_permission(v_caller, 'customers.create') THEN
    RAISE EXCEPTION 'permission denied: customers.create required' USING ERRCODE = '42501';
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

  DROP TABLE IF EXISTS t_cust, t_err;

  CREATE TEMP TABLE t_cust ON COMMIT DROP AS
  SELECT ord::INT                                              AS row_num,
         NULLIF(trim(elt->>'name'), '')                       AS name,
         NULLIF(trim(elt->>'phone'), '')                      AS phone,
         NULLIF(trim(elt->>'email'), '')                      AS email,
         COALESCE(NULLIF(trim(elt->>'customer_type'), ''), 'retail') AS customer_type,
         NULLIF(trim(elt->>'category'), '')                   AS category,
         NULLIF(trim(elt->>'birth_date'), '')                 AS birth_date,
         (elt->>'marketing_consent')::BOOLEAN                 AS marketing_consent,
         NULLIF(trim(elt->>'b2b_company_name'), '')           AS b2b_company_name,
         NULLIF(trim(elt->>'b2b_tax_id'), '')                 AS b2b_tax_id,
         (elt->>'b2b_payment_terms_days')::NUMERIC            AS b2b_payment_terms_days,
         (elt->>'b2b_credit_limit')::NUMERIC                  AS b2b_credit_limit
    FROM jsonb_array_elements(COALESCE(p_payload, '[]'::jsonb)) WITH ORDINALITY AS t(elt, ord);

  CREATE TEMP TABLE t_err (sheet TEXT, row_num INT, sku TEXT, code TEXT, message TEXT) ON COMMIT DROP;

  -- validation
  INSERT INTO t_err SELECT 'Customers', row_num, name, 'missing_required', 'name is required'
    FROM t_cust WHERE name IS NULL;
  INSERT INTO t_err SELECT 'Customers', row_num, COALESCE(phone, name), 'invalid_customer_type',
         format('customer_type "%s" must be retail or b2b', customer_type)
    FROM t_cust WHERE customer_type NOT IN ('retail', 'b2b');
  INSERT INTO t_err SELECT 'Customers', row_num, COALESCE(phone, name), 'invalid_birth_date',
         format('birth_date "%s" must be YYYY-MM-DD', birth_date)
    FROM t_cust WHERE birth_date IS NOT NULL AND birth_date !~ '^\d{4}-\d{2}-\d{2}$';
  INSERT INTO t_err SELECT 'Customers', c.row_num, COALESCE(c.phone, c.name), 'unknown_category',
         format('category "%s" not found (by name or slug)', c.category)
    FROM t_cust c
   WHERE c.category IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM customer_categories cc
                      WHERE cc.deleted_at IS NULL AND (cc.name = c.category OR cc.slug = c.category));
  -- in-file duplicate by phone / email
  INSERT INTO t_err SELECT 'Customers', MIN(row_num), phone, 'duplicate_in_file',
         format('phone "%s" appears %s times in the file', phone, COUNT(*))
    FROM t_cust WHERE phone IS NOT NULL GROUP BY phone HAVING COUNT(*) > 1;
  INSERT INTO t_err SELECT 'Customers', MIN(row_num), email, 'duplicate_in_file',
         format('email "%s" appears %s times in the file', email, COUNT(*))
    FROM t_cust WHERE email IS NOT NULL GROUP BY email HAVING COUNT(*) > 1;
  -- already exists in DB by phone / email (create-only)
  INSERT INTO t_err SELECT 'Customers', c.row_num, c.phone, 'duplicate_exists',
         format('a customer with phone "%s" already exists', c.phone)
    FROM t_cust c WHERE c.phone IS NOT NULL
     AND EXISTS (SELECT 1 FROM customers x WHERE x.deleted_at IS NULL AND x.phone = c.phone);
  INSERT INTO t_err SELECT 'Customers', c.row_num, c.email, 'duplicate_exists',
         format('a customer with email "%s" already exists', c.email)
    FROM t_cust c WHERE c.email IS NOT NULL
     AND EXISTS (SELECT 1 FROM customers x WHERE x.deleted_at IS NULL AND x.email = c.email);

  -- birth_date validity probe (regex-passing but impossible dates)
  FOR r IN SELECT row_num, birth_date FROM t_cust
            WHERE birth_date IS NOT NULL AND birth_date ~ '^\d{4}-\d{2}-\d{2}$' LOOP
    BEGIN
      PERFORM r.birth_date::date;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO t_err VALUES ('Customers', r.row_num, NULL, 'invalid_birth_date',
        format('birth_date "%s" is not a valid calendar date', r.birth_date));
    END;
  END LOOP;

  SELECT jsonb_build_object('Customers', jsonb_build_object(
    'create', (SELECT COUNT(*) FROM t_cust WHERE name IS NOT NULL)
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

  -- writes: create only
  FOR r IN SELECT * FROM t_cust ORDER BY row_num LOOP
    v_cat_id := NULL;
    IF r.category IS NOT NULL THEN
      SELECT id INTO v_cat_id FROM customer_categories
       WHERE deleted_at IS NULL AND (name = r.category OR slug = r.category) LIMIT 1;
    END IF;
    INSERT INTO customers (
      name, phone, email, customer_type, category_id, birth_date, marketing_consent,
      b2b_company_name, b2b_tax_id, b2b_payment_terms_days, b2b_credit_limit
    ) VALUES (
      r.name, r.phone, r.email, r.customer_type::customer_type, v_cat_id,
      NULLIF(r.birth_date, '')::date, COALESCE(r.marketing_consent, FALSE),
      r.b2b_company_name, r.b2b_tax_id, r.b2b_payment_terms_days::INT, r.b2b_credit_limit
    );
  END LOOP;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_caller, 'customers.imported', 'customer', NULL, v_summary);

  BEGIN
    INSERT INTO import_master_data_idempotency_keys (key, entity, report, created_by)
    VALUES (p_idempotency_key, 'customers', v_report, v_caller);
  EXCEPTION WHEN unique_violation THEN
    SELECT report INTO v_existing FROM import_master_data_idempotency_keys WHERE key = p_idempotency_key;
    RETURN v_existing || jsonb_build_object('idempotent_replay', true);
  END;

  RETURN v_report;
END;
$$;

COMMENT ON FUNCTION public.import_customers_v1(JSONB, BOOLEAN, UUID) IS
  'Phase 1 bulk import — customers create-only, category by name/slug, duplicate detection. Gate customers.create.';

REVOKE ALL ON FUNCTION public.import_customers_v1(JSONB, BOOLEAN, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.import_customers_v1(JSONB, BOOLEAN, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.import_customers_v1(JSONB, BOOLEAN, UUID) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
