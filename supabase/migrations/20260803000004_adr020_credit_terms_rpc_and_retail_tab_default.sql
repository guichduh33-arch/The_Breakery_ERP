-- ADR-020 décision 1 — les champs financiers d'une fiche client s'écrivent par
-- RPC gatée et auditée, jamais par UPDATE direct ; et une ardoise comptoir sans
-- plafond individuel retombe sur un plafond d'établissement au lieu d'être
-- illimitée.
--
-- ⚠️ RÉCONCILIATION (2026-08-03). Ces objets existent déjà sur le projet V3 dev :
-- ils y ont été appliqués le 2026-08-02 sous le nom `adr019_lot1_credit_terms_
-- rpc_and_tab_default`, sans que la migration correspondante soit versionnée.
-- Ce fichier reconstitue ce DDL depuis le corps live (`pg_get_functiondef`),
-- qui est la seule source existante. Deux écarts assumés avec l'entrée cloud :
--   - le nom cite ADR-020 et non ADR-019 : ADR-019 porte le fuseau horaire, la
--     décision appliquée ici est celle du domaine Clients ;
--   - le commentaire de fonction est corrigé dans le même sens.
-- Tout est idempotent : rejouer ce fichier sur la base dev ne change que ce
-- commentaire.

ALTER TABLE business_config
  ADD COLUMN IF NOT EXISTS retail_tab_credit_limit_default NUMERIC(14,2) NOT NULL DEFAULT 300000;

COMMENT ON COLUMN business_config.retail_tab_credit_limit_default IS
  'ADR-020 dec. 1 : plafond d''ardoise comptoir applique a un client retail sans plafond individuel. NOT NULL — une ardoise sans plafond du tout serait illimitee.';

CREATE OR REPLACE FUNCTION public.update_customer_credit_terms_v1(p_customer_id uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id        UUID;
  v_profile_id     UUID;
  v_key            TEXT;
  v_touches_b2b    BOOLEAN := FALSE;
  v_touches_retail BOOLEAN := FALSE;
  v_before         RECORD;
  v_after          RECORD;
  v_retail_limit   NUMERIC(14,2);
  v_b2b_limit      NUMERIC(14,2);
  v_terms_days     INTEGER;
  v_tax_id         TEXT;
  v_type           customer_type;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM user_profiles
    WHERE auth_user_id = v_user_id AND deleted_at IS NULL;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'User profile not found' USING ERRCODE = 'P0001';
  END IF;

  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'empty_patch' USING ERRCODE = 'P0001';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_key = 'retail_credit_limit' THEN
      v_touches_retail := TRUE;
    ELSIF v_key IN ('b2b_credit_limit', 'b2b_payment_terms_days', 'b2b_tax_id', 'customer_type') THEN
      v_touches_b2b := TRUE;
    ELSE
      RAISE EXCEPTION 'invalid_field: %', v_key USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  IF v_touches_b2b AND NOT has_permission(v_user_id, 'customers.b2b.update') THEN
    RAISE EXCEPTION 'Permission denied: customers.b2b.update' USING ERRCODE = 'P0003';
  END IF;
  IF v_touches_retail AND NOT has_permission(v_user_id, 'customers.update') THEN
    RAISE EXCEPTION 'Permission denied: customers.update' USING ERRCODE = 'P0003';
  END IF;

  SELECT id, customer_type, retail_credit_limit, b2b_credit_limit,
         b2b_payment_terms_days, b2b_tax_id, deleted_at
    INTO v_before
    FROM customers WHERE id = p_customer_id FOR UPDATE;
  IF NOT FOUND OR v_before.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'customer_not_found_or_inactive' USING ERRCODE = 'P0002';
  END IF;

  v_retail_limit := CASE WHEN p_patch ? 'retail_credit_limit'
                      THEN NULLIF(p_patch->>'retail_credit_limit', '')::NUMERIC
                      ELSE v_before.retail_credit_limit END;
  v_b2b_limit    := CASE WHEN p_patch ? 'b2b_credit_limit'
                      THEN NULLIF(p_patch->>'b2b_credit_limit', '')::NUMERIC
                      ELSE v_before.b2b_credit_limit END;
  v_terms_days   := CASE WHEN p_patch ? 'b2b_payment_terms_days'
                      THEN NULLIF(p_patch->>'b2b_payment_terms_days', '')::INTEGER
                      ELSE v_before.b2b_payment_terms_days END;
  v_tax_id       := CASE WHEN p_patch ? 'b2b_tax_id'
                      THEN NULLIF(p_patch->>'b2b_tax_id', '')
                      ELSE v_before.b2b_tax_id END;

  IF p_patch ? 'customer_type' THEN
    IF p_patch->>'customer_type' IS NULL OR p_patch->>'customer_type' NOT IN ('retail', 'b2b') THEN
      RAISE EXCEPTION 'invalid_customer_type' USING ERRCODE = 'P0001';
    END IF;
    v_type := (p_patch->>'customer_type')::customer_type;
  ELSE
    v_type := v_before.customer_type;
  END IF;

  IF v_retail_limit IS NOT NULL AND v_retail_limit < 0 THEN
    RAISE EXCEPTION 'invalid_credit_limit: retail_credit_limit' USING ERRCODE = 'P0001';
  END IF;
  IF v_b2b_limit IS NOT NULL AND v_b2b_limit < 0 THEN
    RAISE EXCEPTION 'invalid_credit_limit: b2b_credit_limit' USING ERRCODE = 'P0001';
  END IF;
  IF v_terms_days IS NOT NULL AND v_terms_days < 0 THEN
    RAISE EXCEPTION 'invalid_payment_terms' USING ERRCODE = 'P0001';
  END IF;

  UPDATE customers SET
    retail_credit_limit    = v_retail_limit,
    b2b_credit_limit       = v_b2b_limit,
    b2b_payment_terms_days = v_terms_days,
    b2b_tax_id             = v_tax_id,
    customer_type          = v_type,
    updated_at             = now()
   WHERE id = p_customer_id
  RETURNING customer_type, retail_credit_limit, b2b_credit_limit,
            b2b_payment_terms_days, b2b_tax_id
    INTO v_after;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata, payload)
    VALUES (v_profile_id, 'customer.update_credit_terms', 'customers', p_customer_id,
      jsonb_build_object(
        'fields',        (SELECT jsonb_agg(k ORDER BY k) FROM jsonb_object_keys(p_patch) AS k),
        'customer_type', v_after.customer_type::text
      ),
      jsonb_build_object(
        'before', jsonb_build_object(
          'customer_type',          v_before.customer_type::text,
          'retail_credit_limit',    v_before.retail_credit_limit,
          'b2b_credit_limit',       v_before.b2b_credit_limit,
          'b2b_payment_terms_days', v_before.b2b_payment_terms_days,
          'b2b_tax_id',             v_before.b2b_tax_id
        ),
        'after', jsonb_build_object(
          'customer_type',          v_after.customer_type::text,
          'retail_credit_limit',    v_after.retail_credit_limit,
          'b2b_credit_limit',       v_after.b2b_credit_limit,
          'b2b_payment_terms_days', v_after.b2b_payment_terms_days,
          'b2b_tax_id',             v_after.b2b_tax_id
        )
      ));

  RETURN jsonb_build_object(
    'customer_id',            p_customer_id,
    'customer_type',          v_after.customer_type::text,
    'retail_credit_limit',    v_after.retail_credit_limit,
    'b2b_credit_limit',       v_after.b2b_credit_limit,
    'b2b_payment_terms_days', v_after.b2b_payment_terms_days,
    'b2b_tax_id',             v_after.b2b_tax_id
  );
END $function$;

-- Defense-in-depth : `anon` herite EXECUTE via PUBLIC, un REVOKE FROM anon seul
-- ne suffirait pas (CLAUDE.md, pattern db-migrations).
REVOKE ALL ON FUNCTION public.update_customer_credit_terms_v1(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_customer_credit_terms_v1(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_customer_credit_terms_v1(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.update_customer_credit_terms_v1(uuid, jsonb) IS
  'ADR-020 dec. 1 : seul chemin d''ecriture des champs financiers d''une fiche client. Patch JSONB, presence de cle = intention. Gate customers.b2b.update sur les champs B2B et le type, customers.update sur le plafond retail. Ecrit audit_logs (metadata = champs touches, payload = diff avant/apres).';
