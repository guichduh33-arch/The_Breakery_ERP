-- 20260619000040_create_pos_customer_rpcs.sql
-- Security hardening (security-fraud-guard gap 4, checklist D).
--
-- GAP 4 — customers PII READ has no permission gate.
-- The customers SELECT policy `auth_read` only checks is_authenticated(), so any
-- authenticated role (CASHIER included) can `SELECT * FROM customers` and bulk-read
-- every phone / email / birth_date — a clean internal exfiltration channel.
--
-- Fix (this migration = additive half): give the POS a narrow, definer-mediated
-- read path so it keeps working once the table SELECT is gated behind
-- `customers.read` (migration 20260619000041). The RPCs run as owner (bypass RLS)
-- and project ONLY the POS-needed columns — never birth_date / marketing_consent /
-- b2b_* (those stay BackOffice-only behind customers.read). The projection matches
-- the columns the POS hooks already selected, so the POS Customer type is unchanged.
--
-- These are intentionally callable by `authenticated` (the POS attach-customer flow
-- is a cashier action). Bulk dump is blocked at the table level by _041; here the
-- search is capped (min 2 chars, limit 20) to discourage enumeration.

-- ----------------------------------------------------------------------------
-- search_customers_v1 — name/phone ILIKE search for the POS attach flow.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_customers_v1(
  p_query TEXT,
  p_limit INT DEFAULT 20
) RETURNS TABLE (
  id              UUID,
  name            TEXT,
  phone           TEXT,
  email           TEXT,
  customer_type   customer_type,
  loyalty_points  INTEGER,
  lifetime_points INTEGER,
  total_spent     NUMERIC,
  total_visits    INTEGER,
  last_visit_at   TIMESTAMPTZ,
  category_id     UUID,
  created_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_term TEXT := btrim(coalesce(p_query, ''));
  v_lim  INT  := LEAST(GREATEST(coalesce(p_limit, 20), 1), 50);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF length(v_term) < 2 THEN
    RETURN;  -- empty set, mirrors the previous client-side guard
  END IF;

  RETURN QUERY
    SELECT c.id, c.name, c.phone, c.email, c.customer_type,
           c.loyalty_points, c.lifetime_points, c.total_spent, c.total_visits,
           c.last_visit_at, c.category_id, c.created_at, c.updated_at, c.deleted_at
    FROM customers c
    WHERE c.deleted_at IS NULL
      AND (c.name ILIKE '%' || v_term || '%' OR c.phone ILIKE '%' || v_term || '%')
    ORDER BY c.name
    LIMIT v_lim;
END $$;

REVOKE EXECUTE ON FUNCTION public.search_customers_v1(TEXT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_customers_v1(TEXT, INT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.search_customers_v1(TEXT, INT) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.search_customers_v1 IS
  'S34 security gap 4: POS customer search (name/phone ILIKE, min 2 chars, cap 50). Definer, narrow projection (no birth_date/marketing_consent/b2b_*). Replaces direct customers SELECT now gated behind customers.read.';

-- ----------------------------------------------------------------------------
-- get_customer_v1 — single-customer lookup by id for the POS.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_customer_v1(
  p_id UUID
) RETURNS TABLE (
  id              UUID,
  name            TEXT,
  phone           TEXT,
  email           TEXT,
  customer_type   customer_type,
  loyalty_points  INTEGER,
  lifetime_points INTEGER,
  total_spent     NUMERIC,
  total_visits    INTEGER,
  last_visit_at   TIMESTAMPTZ,
  category_id     UUID,
  created_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
    SELECT c.id, c.name, c.phone, c.email, c.customer_type,
           c.loyalty_points, c.lifetime_points, c.total_spent, c.total_visits,
           c.last_visit_at, c.category_id, c.created_at, c.updated_at, c.deleted_at
    FROM customers c
    WHERE c.id = p_id AND c.deleted_at IS NULL;
END $$;

REVOKE EXECUTE ON FUNCTION public.get_customer_v1(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_customer_v1(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_customer_v1(UUID) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.get_customer_v1 IS
  'S34 security gap 4: POS single-customer lookup by id (e.g. refresh loyalty after a sale). Definer, narrow projection.';

-- ----------------------------------------------------------------------------
-- create_customer_v1 — POS walk-in customer create (returns the new row).
-- Needed because, once customers SELECT is gated, a CASHIER `.insert().select()`
-- RETURNING would be filtered by RLS and yield no row.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_customer_v1(
  p_name          TEXT,
  p_phone         TEXT DEFAULT NULL,
  p_email         TEXT DEFAULT NULL,
  p_customer_type customer_type DEFAULT 'retail'
) RETURNS TABLE (
  id              UUID,
  name            TEXT,
  phone           TEXT,
  email           TEXT,
  customer_type   customer_type,
  loyalty_points  INTEGER,
  lifetime_points INTEGER,
  total_spent     NUMERIC,
  total_visits    INTEGER,
  last_visit_at   TIMESTAMPTZ,
  category_id     UUID,
  created_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF length(btrim(coalesce(p_name, ''))) < 1 THEN
    RAISE EXCEPTION 'Customer name required' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO customers (name, phone, email, customer_type)
  VALUES (btrim(p_name), NULLIF(btrim(coalesce(p_phone,'')), ''),
          NULLIF(btrim(coalesce(p_email,'')), ''), coalesce(p_customer_type, 'retail'))
  RETURNING customers.id INTO v_id;

  RETURN QUERY
    SELECT c.id, c.name, c.phone, c.email, c.customer_type,
           c.loyalty_points, c.lifetime_points, c.total_spent, c.total_visits,
           c.last_visit_at, c.category_id, c.created_at, c.updated_at, c.deleted_at
    FROM customers c WHERE c.id = v_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.create_customer_v1(TEXT, TEXT, TEXT, customer_type) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_customer_v1(TEXT, TEXT, TEXT, customer_type) FROM anon;
GRANT  EXECUTE ON FUNCTION public.create_customer_v1(TEXT, TEXT, TEXT, customer_type) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.create_customer_v1 IS
  'S34 security gap 4: POS walk-in customer create. Definer so the RETURNING row survives the customers.read SELECT gate. Narrow projection.';
