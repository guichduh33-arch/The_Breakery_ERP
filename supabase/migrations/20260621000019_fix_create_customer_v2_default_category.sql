-- 20260621000019_fix_create_customer_v2_default_category.sql
-- Session 37 / Wave C / Task C5 — corrective sur _017.
-- Le front POS (useCreateCustomer + Pos.tsx createCustomer inline) assignait la
-- catégorie par défaut (`customer_categories.is_default`) au moment de l'INSERT
-- direct. create_customer_v2 (_017) ne le faisait pas → un walk-in créé via la
-- RPC perdait le multiplier loyalty / pricing de la catégorie par défaut.
-- Corrective : la v2 résout la catégorie par défaut server-side (mieux : le
-- client n'a plus à pré-fetcher customer_categories) et retourne l'embed
-- `category` immédiatement peuplé. Signature inchangée → CREATE OR REPLACE.

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
  v_default_category UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF length(btrim(coalesce(p_name, ''))) < 1 THEN
    RAISE EXCEPTION 'Customer name required' USING ERRCODE = 'check_violation';
  END IF;

  -- Catégorie par défaut (parité avec l'ex-resolveDefaultCategoryId du front).
  SELECT cc.id INTO v_default_category
  FROM customer_categories cc
  WHERE cc.is_default = true AND cc.deleted_at IS NULL
  LIMIT 1;

  INSERT INTO customers (name, phone, email, customer_type, category_id)
  VALUES (btrim(p_name), NULLIF(btrim(coalesce(p_phone,'')), ''),
          NULLIF(btrim(coalesce(p_email,'')), ''), coalesce(p_customer_type, 'retail'),
          v_default_category)
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

COMMENT ON FUNCTION public.create_customer_v2 IS
  'S37 C5 (SEC-03) corrective: POS walk-in create v2 assigns the default customer category server-side (parity with the pre-cutover front behaviour) and returns the populated category embed.';
