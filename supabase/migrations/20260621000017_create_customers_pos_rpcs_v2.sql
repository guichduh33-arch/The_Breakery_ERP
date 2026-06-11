-- 20260621000017_create_customers_pos_rpcs_v2.sql
-- Session 37 / Wave C / Task C5 (SEC-03 + DB-03) — D6 ratifiée.
-- Bump search_customers_v1 / get_customer_v1 / create_customer_v1 → v2 :
-- les v1 (S34 _040, jamais câblées — dead code) retournaient une projection plate
-- SANS l'embed customer_categories, insuffisante pour le pricing POS
-- (CUSTOMER_SELECT embed la catégorie complète : price_modifier_type,
-- discount_percentage, loyalty_enabled, points_multiplier, is_default).
-- v2 ajoute une colonne `category JSONB` (NULL si pas de catégorie) avec exactement
-- la shape de l'embed PostgREST consommée par le POS — 1 seul round-trip (D6).
-- Le gate `customers.read` (_018, ré-auteur de 20260619000043) s'applique EN DERNIER,
-- après le câblage front des 4+1 sites POS — hard cutover S25-style.
-- Versioning monotone : DROP v1 dans la même migration.

DROP FUNCTION IF EXISTS public.search_customers_v1(TEXT, INT);
DROP FUNCTION IF EXISTS public.get_customer_v1(UUID);
DROP FUNCTION IF EXISTS public.create_customer_v1(TEXT, TEXT, TEXT, customer_type);

-- ----------------------------------------------------------------------------
-- search_customers_v2 — recherche name/phone pour le flux attach POS,
-- + embed catégorie pour le pricing.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_customers_v2(
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
  category        JSONB,
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
           c.last_visit_at, c.category_id,
           CASE WHEN cc.id IS NULL THEN NULL ELSE jsonb_build_object(
             'id', cc.id, 'name', cc.name, 'slug', cc.slug, 'color', cc.color,
             'icon', cc.icon, 'price_modifier_type', cc.price_modifier_type,
             'discount_percentage', cc.discount_percentage,
             'loyalty_enabled', cc.loyalty_enabled,
             'points_multiplier', cc.points_multiplier,
             'is_default', cc.is_default
           ) END,
           c.created_at, c.updated_at, c.deleted_at
    FROM customers c
    LEFT JOIN customer_categories cc ON cc.id = c.category_id AND cc.deleted_at IS NULL
    WHERE c.deleted_at IS NULL
      AND (c.name ILIKE '%' || v_term || '%' OR c.phone ILIKE '%' || v_term || '%')
    ORDER BY c.name
    LIMIT v_lim;
END $$;

REVOKE EXECUTE ON FUNCTION public.search_customers_v2(TEXT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_customers_v2(TEXT, INT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.search_customers_v2(TEXT, INT) TO authenticated;

COMMENT ON FUNCTION public.search_customers_v2 IS
  'S37 C5 (SEC-03): POS customer search v2 — v1 + embed category JSONB (pricing). Definer, narrow projection (no birth_date/marketing_consent/b2b_*). Pre-requisite for the customers.read gate.';

-- ----------------------------------------------------------------------------
-- get_customer_v2 — lookup single par id, + embed catégorie.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_customer_v2(
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
  category        JSONB,
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
           c.last_visit_at, c.category_id,
           CASE WHEN cc.id IS NULL THEN NULL ELSE jsonb_build_object(
             'id', cc.id, 'name', cc.name, 'slug', cc.slug, 'color', cc.color,
             'icon', cc.icon, 'price_modifier_type', cc.price_modifier_type,
             'discount_percentage', cc.discount_percentage,
             'loyalty_enabled', cc.loyalty_enabled,
             'points_multiplier', cc.points_multiplier,
             'is_default', cc.is_default
           ) END,
           c.created_at, c.updated_at, c.deleted_at
    FROM customers c
    LEFT JOIN customer_categories cc ON cc.id = c.category_id AND cc.deleted_at IS NULL
    WHERE c.id = p_id AND c.deleted_at IS NULL;
END $$;

REVOKE EXECUTE ON FUNCTION public.get_customer_v2(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_customer_v2(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_customer_v2(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_customer_v2 IS
  'S37 C5 (SEC-03): POS single-customer lookup v2 — v1 + embed category JSONB (held-restore badge re-fetch, post-sale loyalty refresh).';

-- ----------------------------------------------------------------------------
-- create_customer_v2 — création walk-in POS, + embed catégorie (NULL au create).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_customer_v2(
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
  category        JSONB,
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
           c.last_visit_at, c.category_id,
           CASE WHEN cc.id IS NULL THEN NULL ELSE jsonb_build_object(
             'id', cc.id, 'name', cc.name, 'slug', cc.slug, 'color', cc.color,
             'icon', cc.icon, 'price_modifier_type', cc.price_modifier_type,
             'discount_percentage', cc.discount_percentage,
             'loyalty_enabled', cc.loyalty_enabled,
             'points_multiplier', cc.points_multiplier,
             'is_default', cc.is_default
           ) END,
           c.created_at, c.updated_at, c.deleted_at
    FROM customers c
    LEFT JOIN customer_categories cc ON cc.id = c.category_id AND cc.deleted_at IS NULL
    WHERE c.id = v_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.create_customer_v2(TEXT, TEXT, TEXT, customer_type) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_customer_v2(TEXT, TEXT, TEXT, customer_type) FROM anon;
GRANT  EXECUTE ON FUNCTION public.create_customer_v2(TEXT, TEXT, TEXT, customer_type) TO authenticated;

COMMENT ON FUNCTION public.create_customer_v2 IS
  'S37 C5 (SEC-03): POS walk-in customer create v2 — v1 + embed category JSONB. Definer so the RETURNING row survives the customers.read SELECT gate.';

-- Défense-en-profondeur canonique (S20/S25).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
