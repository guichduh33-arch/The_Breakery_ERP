-- Gestion des catégories : contrat validé par Mamat, 2026-09-30.
-- Préparation locale ; appliquer puis régénérer les types avant déploiement.
ALTER TABLE public.expense_categories ADD COLUMN description text;

INSERT INTO public.permissions (code, module, action, description)
VALUES ('expenses.categories.manage', 'expenses', 'categories.manage', 'Manage expense categories');
INSERT INTO public.role_permissions (role_code, permission_code)
VALUES ('SUPER_ADMIN', 'expenses.categories.manage'), ('MANAGER', 'expenses.categories.manage');

-- Toutes les portes (RPC, import, PostgREST) prennent le même verrou.
-- Un changement de statut seul conserve une catégorie devenue inactive.
CREATE FUNCTION public.guard_expense_category_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_active boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.category_id IS NOT DISTINCT FROM OLD.category_id THEN
    RETURN NEW;
  END IF;
  SELECT is_active INTO v_active FROM expense_categories WHERE id = NEW.category_id FOR SHARE;
  IF NOT FOUND OR NOT v_active THEN
    RAISE EXCEPTION 'expense_category_inactive' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_expense_category_assignment
BEFORE INSERT OR UPDATE OF category_id ON public.expenses
FOR EACH ROW EXECUTE FUNCTION public.guard_expense_category_assignment();

-- Défense au niveau table, y compris pour un écrivain SECURITY DEFINER.
CREATE FUNCTION public.guard_expense_category_definition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.code IS DISTINCT FROM OLD.code THEN
      RAISE EXCEPTION 'expense_category_code_immutable' USING ERRCODE = '22023';
    END IF;
    IF NEW.account_id IS DISTINCT FROM OLD.account_id AND
       EXISTS (SELECT 1 FROM expenses WHERE category_id = OLD.id) THEN
      RAISE EXCEPTION 'expense_category_account_in_use' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.account_id IS DISTINCT FROM OLD.account_id OR
     (NEW.is_active AND NOT OLD.is_active) THEN
    PERFORM 1 FROM accounts WHERE id = NEW.account_id AND account_class = 6
      AND is_active AND is_postable AND deleted_at IS NULL FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'expense_category_account_invalid' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_expense_category_definition
BEFORE INSERT OR UPDATE ON public.expense_categories
FOR EACH ROW EXECUTE FUNCTION public.guard_expense_category_definition();

CREATE FUNCTION public.get_expense_categories_admin_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_manage boolean;
BEGIN
  v_manage := coalesce(has_permission(auth.uid(), 'expenses.categories.manage'), false);
  IF auth.uid() IS NULL OR NOT (v_manage OR has_permission(auth.uid(), 'expenses.read')) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'categories', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'code', c.code, 'name', c.name, 'description', c.description,
      'account_id', c.account_id, 'account_code', a.code, 'account_name', a.name,
      'is_active', c.is_active, 'is_used', EXISTS (SELECT 1 FROM expenses e WHERE e.category_id = c.id)
    ) ORDER BY c.name, c.id), '[]'::jsonb) FROM expense_categories c JOIN accounts a ON a.id = c.account_id),
    'accounts', CASE WHEN v_manage THEN
      (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name', name) ORDER BY code), '[]'::jsonb)
       FROM accounts WHERE account_class = 6 AND is_active AND is_postable AND deleted_at IS NULL)
      ELSE '[]'::jsonb END);
END;
$$;

CREATE FUNCTION public.create_expense_category_v1(p_code text, p_name text, p_account_id uuid,
  p_description text DEFAULT NULL, p_is_active boolean DEFAULT true)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_actor uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'expenses.categories.manage') THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id = auth.uid() AND deleted_at IS NULL;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'profile_required' USING ERRCODE = '28000'; END IF;
  IF p_code IS NULL OR length(trim(p_code)) NOT BETWEEN 1 AND 64 OR
     p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 120 OR
     length(coalesce(p_description, '')) > 2000 OR p_is_active IS NULL THEN
    RAISE EXCEPTION 'expense_category_invalid_fields' USING ERRCODE = '22023';
  END IF;
  INSERT INTO expense_categories(code, name, account_id, description, is_active)
  VALUES (trim(p_code), trim(p_name), p_account_id, nullif(trim(p_description), ''), p_is_active)
  RETURNING id INTO v_id;
  INSERT INTO audit_logs(actor_id, action, entity_type, entity_id, metadata, payload)
  VALUES (v_actor, 'expense_category.created', 'expense_category', v_id, '{}'::jsonb,
    jsonb_build_object('after', (SELECT to_jsonb(c) FROM expense_categories c WHERE id = v_id)));
  RETURN v_id;
END;
$$;

CREATE FUNCTION public.update_expense_category_v1(p_category_id uuid, p_name text,
  p_account_id uuid, p_description text, p_is_active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_before expense_categories%ROWTYPE; v_actor uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'expenses.categories.manage') THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id = auth.uid() AND deleted_at IS NULL;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'profile_required' USING ERRCODE = '28000'; END IF;
  IF p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 120 OR
     length(coalesce(p_description, '')) > 2000 OR p_is_active IS NULL THEN
    RAISE EXCEPTION 'expense_category_invalid_fields' USING ERRCODE = '22023';
  END IF;
  -- FOR UPDATE conflit avec FOR SHARE de l'affectation, même si compte non-clé.
  SELECT * INTO v_before FROM expense_categories WHERE id = p_category_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'expense_category_not_found' USING ERRCODE = 'P0002'; END IF;
  UPDATE expense_categories SET name = trim(p_name), account_id = p_account_id,
    description = nullif(trim(p_description), ''), is_active = p_is_active WHERE id = p_category_id;
  INSERT INTO audit_logs(actor_id, action, entity_type, entity_id, metadata, payload)
  VALUES (v_actor, 'expense_category.updated', 'expense_category', p_category_id, '{}'::jsonb,
    jsonb_build_object('before', to_jsonb(v_before),
      'after', (SELECT to_jsonb(c) FROM expense_categories c WHERE id = p_category_id)));
END;
$$;

REVOKE ALL ON FUNCTION public.guard_expense_category_assignment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_expense_category_definition() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_expense_categories_admin_v1() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_expense_category_v1(text,text,uuid,text,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_expense_category_v1(uuid,text,uuid,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_expense_categories_admin_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_expense_category_v1(text,text,uuid,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_expense_category_v1(uuid,text,uuid,text,boolean) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
