-- 20260815000001_adr020_d6_read_gates_adjust_v2_export_v1.sql
-- ADR-020 décision 6 (lot e) — traçabilité et lecture.
--
-- 1. Les policies SELECT de loyalty_transactions et customer_product_prices
--    s'alignent sur customers.read. Jusqu'ici : simple is_authenticated(),
--    quand customers et le ledger d'avoir exigeaient déjà la permission.
-- 2. adjust_loyalty_points (non versionnée, session 12) → adjust_loyalty_points_v2 :
--    contrat identique, plus une ligne audit_logs (metadata = contexte,
--    payload = diff avant/après). Corps repris du live (pg_get_functiondef,
--    relevé 2026-08-15). L'ancienne est droppée dans la même migration.
-- 3. export_customers_v1 : l'export de masse du fichier clients (PII + plafonds
--    B2B) passe par une RPC gatée customers.read qui écrit une ligne
--    audit_logs. Le BO lisait la table en direct : aucune trace possible.

-- ── 1. Read gates ──────────────────────────────────────────────────────────

DROP POLICY "auth_read_own_view" ON public.loyalty_transactions;
CREATE POLICY "perm_read" ON public.loyalty_transactions
  FOR SELECT TO authenticated
  USING (has_permission(auth.uid(), 'customers.read'));

DROP POLICY "auth_read" ON public.customer_product_prices;
CREATE POLICY "perm_read" ON public.customer_product_prices
  FOR SELECT TO authenticated
  USING (has_permission(auth.uid(), 'customers.read'));

-- ── 2. adjust_loyalty_points → v2 avec audit ───────────────────────────────

DROP FUNCTION public.adjust_loyalty_points(uuid, integer, text);

CREATE FUNCTION public.adjust_loyalty_points_v2(
  p_customer_id uuid,
  p_delta integer,
  p_reason text
)
RETURNS TABLE(txn_id uuid, new_balance integer, new_lifetime integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid              UUID := auth.uid();
  v_profile_id       UUID;
  v_current_balance  INT;
  v_current_lifetime INT;
  v_new_balance      INT;
  v_new_lifetime     INT;
  v_txn_id           UUID;
  v_trimmed_reason   TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF NOT has_permission(v_uid, 'loyalty.adjust') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_customer_id IS NULL OR p_delta IS NULL OR p_delta = 0 OR p_reason IS NULL THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;

  IF abs(p_delta) > 1000000 THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;

  v_trimmed_reason := trim(p_reason);
  IF length(v_trimmed_reason) < 5 OR length(v_trimmed_reason) > 500 THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;

  SELECT id INTO v_profile_id
    FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT loyalty_points, lifetime_points
    INTO v_current_balance, v_current_lifetime
    FROM customers
    WHERE id = p_customer_id AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer_deleted';
  END IF;

  v_new_balance  := v_current_balance + p_delta;
  v_new_lifetime := v_current_lifetime + GREATEST(p_delta, 0);
  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'insufficient_balance';
  END IF;

  INSERT INTO loyalty_transactions (
    customer_id, order_id, transaction_type, points,
    points_balance_after, description, created_by
  ) VALUES (
    p_customer_id, NULL, 'adjust', p_delta,
    v_new_balance, v_trimmed_reason, v_profile_id
  ) RETURNING id INTO v_txn_id;

  UPDATE customers
     SET loyalty_points  = v_new_balance,
         lifetime_points = v_new_lifetime
   WHERE id = p_customer_id;

  -- ADR-020 déc. 6 — les points se convertissent en avoir monétaire : le geste
  -- laisse une trace d'audit, pas seulement une ligne de ledger.
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata, payload)
  VALUES (
    v_profile_id, 'loyalty.adjust', 'customers', p_customer_id,
    jsonb_build_object('reason', v_trimmed_reason, 'loyalty_txn_id', v_txn_id),
    jsonb_build_object(
      'delta',           p_delta,
      'balance_before',  v_current_balance,
      'balance_after',   v_new_balance,
      'lifetime_before', v_current_lifetime,
      'lifetime_after',  v_new_lifetime
    )
  );

  txn_id       := v_txn_id;
  new_balance  := v_new_balance;
  new_lifetime := v_new_lifetime;
  RETURN NEXT;
END $function$;

REVOKE EXECUTE ON FUNCTION public.adjust_loyalty_points_v2(uuid, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.adjust_loyalty_points_v2(uuid, integer, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.adjust_loyalty_points_v2(uuid, integer, text) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.adjust_loyalty_points_v2(uuid, integer, text) IS
  'ADR-020 déc. 6 — ajustement manuel de points, gate loyalty.adjust, ligne de ledger + ligne audit_logs (v2 : ajoute l''audit à la v1 de session 12).';

-- ── 3. export_customers_v1 ─────────────────────────────────────────────────

CREATE FUNCTION public.export_customers_v1()
RETURNS TABLE(
  name text,
  phone text,
  email text,
  customer_type text,
  category text,
  birth_date date,
  marketing_consent boolean,
  b2b_company_name text,
  b2b_tax_id text,
  b2b_payment_terms_days integer,
  b2b_credit_limit numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid        UUID := auth.uid();
  v_profile_id UUID;
  v_count      INT;
BEGIN
  IF v_uid IS NULL OR NOT has_permission(v_uid, 'customers.read') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT id INTO v_profile_id
    FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT count(*) INTO v_count FROM customers c WHERE c.deleted_at IS NULL;

  -- ADR-020 déc. 6 — un dump nominatif (téléphone, e-mail, identifiant fiscal,
  -- plafonds B2B) laisse une trace, quel que soit son volume.
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_profile_id, 'customer.export', 'customers', NULL,
          jsonb_build_object('row_count', v_count));

  RETURN QUERY
    SELECT c.name, c.phone, c.email, c.customer_type::text, cc.name,
           c.birth_date, c.marketing_consent, c.b2b_company_name, c.b2b_tax_id,
           c.b2b_payment_terms_days, c.b2b_credit_limit
    FROM customers c
    LEFT JOIN customer_categories cc ON cc.id = c.category_id
    WHERE c.deleted_at IS NULL
    ORDER BY c.name;
END $function$;

REVOKE EXECUTE ON FUNCTION public.export_customers_v1() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.export_customers_v1() FROM anon;
GRANT EXECUTE ON FUNCTION public.export_customers_v1() TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.export_customers_v1() IS
  'ADR-020 déc. 6 — export de masse du fichier clients, gate customers.read, une ligne audit_logs par export (action customer.export, row_count en metadata).';
