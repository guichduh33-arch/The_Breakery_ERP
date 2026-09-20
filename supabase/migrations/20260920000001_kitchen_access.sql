-- Accès cuisine : habilitation nominative, stations et lectures sans coûts.
INSERT INTO public.permissions (code, module, action, description)
VALUES ('inventory.production.kitchen', 'inventory', 'production.kitchen', 'Record today production in assigned kitchen stations');

CREATE TABLE public.kitchen_user_sections (
  user_profile_id uuid NOT NULL REFERENCES public.user_profiles(id),
  section_id uuid NOT NULL REFERENCES public.sections(id),
  PRIMARY KEY (user_profile_id, section_id)
);
CREATE TABLE public.kitchen_submissions (
  id uuid PRIMARY KEY,
  user_profile_id uuid NOT NULL REFERENCES public.user_profiles(id),
  section_id uuid NOT NULL REFERENCES public.sections(id),
  request jsonb NOT NULL,
  response jsonb,
  transaction_id bigint NOT NULL DEFAULT txid_current(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.kitchen_user_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kitchen_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kitchen_user_sections, public.kitchen_submissions FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public._kitchen_profile_v1() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'inventory.production.kitchen') THEN
    RAISE EXCEPTION 'kitchen_forbidden' USING ERRCODE = 'P0003';
  END IF;
  SELECT id INTO v_id FROM user_profiles
    WHERE auth_user_id = auth.uid() AND deleted_at IS NULL AND is_active;
  IF v_id IS NULL THEN RAISE EXCEPTION 'kitchen_forbidden' USING ERRCODE = 'P0003'; END IF;
  RETURN v_id;
END $$;

CREATE FUNCTION public._kitchen_assert_section_v1(p_section_id uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid := _kitchen_profile_v1();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM kitchen_user_sections k JOIN sections s ON s.id = k.section_id
    WHERE k.user_profile_id = v_id AND k.section_id = p_section_id
      AND s.kind = 'production' AND s.is_active AND s.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'kitchen_section_forbidden' USING ERRCODE = 'P0003';
  END IF;
  RETURN v_id;
END $$;

-- Le contexte ne provient jamais d'un GUC ou d'un argument falsifiable.
-- Seule la RPC cuisine écrit cette table privée dans la transaction en cours.
CREATE FUNCTION public._kitchen_context_v1(p_section_id uuid, p_product_id uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM kitchen_submissions k JOIN user_profiles u ON u.id = k.user_profile_id
    WHERE u.auth_user_id = auth.uid() AND u.deleted_at IS NULL AND u.is_active
      AND k.section_id = p_section_id AND k.transaction_id = txid_current() AND k.response IS NULL
      AND (p_product_id IS NULL OR EXISTS (SELECT 1 FROM jsonb_array_elements(k.request->'items') i
        WHERE (i->>'product_id')::uuid = p_product_id)))
$$;

CREATE FUNCTION public.get_kitchen_stations_v1() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_profile uuid := _kitchen_profile_v1(); v_rows jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) ORDER BY s.display_order, s.name), '[]')
    INTO v_rows FROM sections s JOIN kitchen_user_sections k ON k.section_id = s.id
    WHERE k.user_profile_id = v_profile AND s.kind = 'production' AND s.is_active AND s.deleted_at IS NULL;
  RETURN v_rows;
END $$;

CREATE FUNCTION public.get_kitchen_products_v1(p_section_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_rows jsonb;
BEGIN
  PERFORM _kitchen_assert_section_v1(p_section_id);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'unit', p.unit,
    'units', jsonb_build_array(jsonb_build_object('code', p.unit, 'factor', 1)) ||
      coalesce((SELECT jsonb_agg(jsonb_build_object('code', a.code, 'factor', a.factor_to_base) ORDER BY a.display_order)
        FROM product_unit_alternatives a WHERE a.product_id = p.id AND a.deleted_at IS NULL AND a.code <> p.unit), '[]'))
    ORDER BY p.name), '[]') INTO v_rows FROM products p
    JOIN product_sections ps ON ps.product_id = p.id AND ps.section_id = p_section_id
    WHERE p.is_active AND p.deleted_at IS NULL AND p.deduct_stock
      AND p.product_type IN ('finished', 'semi_finished')
      AND EXISTS (SELECT 1 FROM recipes r WHERE r.product_id = p.id AND r.is_active AND r.deleted_at IS NULL);
  RETURN v_rows;
END $$;

CREATE FUNCTION public.get_kitchen_history_v1(p_section_id uuid, p_day date,
  p_before_time timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_rows jsonb;
BEGIN
  PERFORM _kitchen_assert_section_v1(p_section_id);
  IF p_day IS NULL OR (p_before_time IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION 'invalid_history_filter';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.production_date DESC, x.id DESC), '[]') INTO v_rows FROM (
    SELECT pr.id, pr.production_date, pr.production_number, p.name AS product_name, p.unit,
      pr.quantity_produced, pr.quantity_waste, pr.waste_reason, pr.notes, pr.reverted_at,
      u.full_name AS author
    FROM production_records pr JOIN products p ON p.id = pr.product_id
    LEFT JOIN user_profiles u ON u.id = pr.staff_id
    WHERE pr.section_id = p_section_id AND pr.production_date >= p_day::timestamptz
      AND pr.production_date < (p_day + 1)::timestamptz
      AND (p_before_time IS NULL OR (pr.production_date, pr.id) < (p_before_time, p_before_id))
    ORDER BY pr.production_date DESC, pr.id DESC LIMIT 51
  ) x;
  RETURN v_rows;
END $$;

CREATE FUNCTION public.get_user_kitchen_access_v1(p_user_profile_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_auth uuid; v_sections jsonb;
BEGIN
  IF v_uid IS NULL OR NOT has_permission(v_uid, 'rbac.manage') OR NOT EXISTS (
    SELECT 1 FROM user_profiles WHERE auth_user_id = v_uid AND role_code = 'SUPER_ADMIN' AND deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'super_admin_only' USING ERRCODE = 'P0003'; END IF;
  SELECT auth_user_id INTO v_auth FROM user_profiles WHERE id = p_user_profile_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name,
    'assigned', EXISTS (SELECT 1 FROM kitchen_user_sections k WHERE k.section_id = s.id AND k.user_profile_id = p_user_profile_id))
    ORDER BY s.display_order, s.name), '[]') INTO v_sections
    FROM sections s WHERE s.kind = 'production' AND s.is_active AND s.deleted_at IS NULL;
  RETURN jsonb_build_object('enabled', has_permission(v_auth, 'inventory.production.kitchen'), 'sections', v_sections);
END $$;

CREATE FUNCTION public.set_user_kitchen_access_v1(p_user_profile_id uuid, p_enabled boolean,
  p_section_ids uuid[], p_reason text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor uuid; v_before jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'rbac.manage') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id = auth.uid()
    AND role_code = 'SUPER_ADMIN' AND deleted_at IS NULL AND is_active;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'super_admin_only' USING ERRCODE = 'P0003'; END IF;
  IF p_enabled IS NULL OR p_section_ids IS NULL OR (p_enabled AND cardinality(p_section_ids) = 0) THEN
    RAISE EXCEPTION 'kitchen_sections_required';
  END IF;
  PERFORM 1 FROM user_profiles WHERE id = p_user_profile_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_section_ids) AS candidate(id) WHERE candidate.id IS NULL OR NOT EXISTS (
    SELECT 1 FROM sections s WHERE s.id = candidate.id AND s.kind = 'production' AND s.is_active AND s.deleted_at IS NULL
  )) THEN RAISE EXCEPTION 'invalid_kitchen_section'; END IF;
  SELECT coalesce(jsonb_agg(section_id), '[]') INTO v_before FROM kitchen_user_sections WHERE user_profile_id = p_user_profile_id;
  PERFORM set_user_permission_override_v1(p_user_profile_id, 'inventory.production.kitchen', p_enabled, p_reason);
  DELETE FROM kitchen_user_sections WHERE user_profile_id = p_user_profile_id;
  IF p_enabled THEN
    INSERT INTO kitchen_user_sections SELECT p_user_profile_id, id FROM (SELECT DISTINCT unnest(p_section_ids) id) x;
  END IF;
  INSERT INTO audit_logs(actor_id, action, entity_type, entity_id, payload)
    VALUES (v_actor, 'user.kitchen_sections_set', 'user_profiles', p_user_profile_id,
      jsonb_build_object('before', v_before, 'sections', CASE WHEN p_enabled THEN to_jsonb(p_section_ids) ELSE '[]'::jsonb END, 'reason', p_reason));
  RETURN true;
END $$;

-- Les comptes cuisine seuls passent par les projections sans coûts.
ALTER POLICY auth_read ON public.products USING (is_authenticated() AND deleted_at IS NULL AND
  (NOT has_permission(auth.uid(), 'inventory.production.kitchen') OR has_permission(auth.uid(), 'products.read') OR has_permission(auth.uid(), 'inventory.read')));
ALTER POLICY auth_read ON public.sections USING (is_authenticated() AND deleted_at IS NULL AND
  (NOT has_permission(auth.uid(), 'inventory.production.kitchen') OR has_permission(auth.uid(), 'inventory.read')));
ALTER POLICY auth_read ON public.product_sections USING (is_authenticated() AND
  (NOT has_permission(auth.uid(), 'inventory.production.kitchen') OR has_permission(auth.uid(), 'products.read') OR has_permission(auth.uid(), 'inventory.read')));

REVOKE ALL ON FUNCTION public._kitchen_profile_v1(), public._kitchen_assert_section_v1(uuid), public._kitchen_context_v1(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_kitchen_stations_v1(), public.get_kitchen_products_v1(uuid), public.get_kitchen_history_v1(uuid,date,timestamptz,uuid),
  public.get_user_kitchen_access_v1(uuid), public.set_user_kitchen_access_v1(uuid,boolean,uuid[],text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_kitchen_stations_v1(), public.get_kitchen_products_v1(uuid), public.get_kitchen_history_v1(uuid,date,timestamptz,uuid),
  public.get_user_kitchen_access_v1(uuid), public.set_user_kitchen_access_v1(uuid,boolean,uuid[],text) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
