-- ADR-020 décisions 2 et 3 — toute écriture de fiche client passe par une RPC
-- gatée et auditée, et l'écriture directe sur les catégories est fermée.
--
-- DÉCISION 2. Le BackOffice créait et modifiait les fiches par INSERT et UPDATE
-- directs sur `customers` : aucune de ces mutations n'écrivait dans `audit_logs`.
-- Côté caisse, `create_customer_v2` est SECURITY DEFINER **sans aucun gate de
-- permission** et accepte un type de client en paramètre — vérifié en base le
-- 2026-08-03 : le rôle CASHIER ne détient AUCUNE permission `customers.*`, et
-- peut pourtant créer un compte B2B. La policy permissive `auth_insert_retail`
-- ouvrait par ailleurs l'INSERT direct de tout client retail à n'importe quel
-- authentifié, indépendamment de `customers.create`.
--
-- Ce que cette migration pose :
--   * `create_customer_v3` — gate explicite. Un compte B2B exige
--     `customers.create` (MANAGER+) ; un client retail accepte aussi la nouvelle
--     permission de création express en caisse. Écrit `audit_logs`.
--   * `update_customer_v1` — seul chemin de modification d'une fiche, gaté sur
--     `customers.update`, avec diff avant/après au journal d'audit. Les champs
--     FINANCIERS n'y entrent pas : ils relèvent de
--     `update_customer_credit_terms_v1` (décision 1), et cette RPC les refuse
--     explicitement plutôt que de les ignorer en silence.
--   * la permission `customers.pos.create`, accordée au seul rôle CASHIER et
--     bornée au type retail par la RPC. La tablette serveur ne crée pas de
--     client (seul `apps/pos/src/pages/Pos.tsx` le fait) : elle ne la reçoit pas.
--   * le retrait des GRANT colonne INSERT/UPDATE de `authenticated` sur
--     `customers` et la suppression de `auth_insert_retail`.
--
-- DÉCISION 3. `authenticated` disposait d'INSERT et d'UPDATE sur TOUTES les
-- colonnes de `customer_categories`, dont `discount_percentage`,
-- `points_multiplier`, `price_modifier_type` et `is_default` — un levier de prix
-- modifiable sans trace. Les trois RPC CRUD gatées existent et sont le seul
-- chemin emprunté par le BackOffice : la surface directe est un résidu, elle est
-- fermée ici.
--
-- ⚠ ÉCRITURE DE DONNÉES. Le rattachement des clients sans catégorie à la
-- catégorie par défaut (109 fiches actives sur 279 au 2026-08-03) est demandé
-- par les conséquences de l'ADR-020. Il ne change AUCUN prix — le repli
-- implicite les traitait déjà en retail — mais rétablit la justesse des filtres
-- et des statistiques du fichier clients.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) La permission de création express en caisse
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO permissions (code, module, action, description)
VALUES ('customers.pos.create', 'customers', 'pos_create',
        'Créer une fiche client retail depuis la caisse (création express, type retail uniquement — ADR-020 déc. 2)')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO role_permissions (role_code, permission_code, is_granted)
VALUES ('CASHIER', 'customers.pos.create', true)
ON CONFLICT (role_code, permission_code) DO UPDATE SET is_granted = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) create_customer_v2 -> v3 : gate de permission + audit
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_customer_v3(
  p_name          text,
  p_phone         text DEFAULT NULL::text,
  p_email         text DEFAULT NULL::text,
  p_customer_type customer_type DEFAULT 'retail'::customer_type
)
 RETURNS TABLE(id uuid, name text, phone text, email text, customer_type customer_type,
               loyalty_points integer, lifetime_points integer, total_spent numeric,
               total_visits integer, last_visit_at timestamp with time zone,
               category_id uuid, category jsonb, created_at timestamp with time zone,
               updated_at timestamp with time zone, deleted_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid              UUID := auth.uid();
  v_profile_id       UUID;
  v_id               UUID;
  v_default_category UUID;
  v_type             customer_type := COALESCE(p_customer_type, 'retail');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT up.id INTO v_profile_id FROM user_profiles up
    WHERE up.auth_user_id = v_uid AND up.deleted_at IS NULL;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'User profile not found' USING ERRCODE = 'P0001';
  END IF;

  -- ADR-020 dec. 2 : le droit de creer un compte B2B reste MANAGER+ ; la caisse
  -- ne peut creer que du retail, par sa permission dediee. v2 n'avait AUCUN gate.
  IF v_type = 'b2b' THEN
    IF NOT has_permission(v_uid, 'customers.create') THEN
      RAISE EXCEPTION 'Permission denied: customers.create' USING ERRCODE = 'P0003';
    END IF;
  ELSE
    IF NOT (has_permission(v_uid, 'customers.create')
            OR has_permission(v_uid, 'customers.pos.create')) THEN
      RAISE EXCEPTION 'Permission denied: customers.create' USING ERRCODE = 'P0003';
    END IF;
  END IF;

  IF length(btrim(coalesce(p_name, ''))) < 1 THEN
    RAISE EXCEPTION 'Customer name required' USING ERRCODE = 'check_violation';
  END IF;

  -- Categorie par defaut (parite avec l'ex-resolveDefaultCategoryId du front).
  SELECT cc.id INTO v_default_category
    FROM customer_categories cc
   WHERE cc.is_default = true AND cc.deleted_at IS NULL
   LIMIT 1;

  INSERT INTO customers (name, phone, email, customer_type, category_id)
  VALUES (btrim(p_name), NULLIF(btrim(coalesce(p_phone,'')), ''),
          NULLIF(btrim(coalesce(p_email,'')), ''), v_type,
          v_default_category)
  RETURNING customers.id INTO v_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_profile_id, 'customer.create', 'customers', v_id,
    jsonb_build_object(
      'customer_name', btrim(p_name),
      'customer_type', v_type::text,
      'category_id',   v_default_category,
      'via_pos',       NOT has_permission(v_uid, 'customers.create')
    ));

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
END $function$;

-- Versionnage monotone : vN+1 creee, vN droppee dans la meme migration.
DROP FUNCTION IF EXISTS public.create_customer_v2(text, text, text, customer_type);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) update_customer_v1 : seul chemin de modification, gaté et audité
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_customer_v1(p_customer_id uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid        UUID := auth.uid();
  v_profile_id UUID;
  v_key        TEXT;
  v_before     RECORD;
  v_after      RECORD;
  v_name       TEXT;
  v_phone      TEXT;
  v_email      TEXT;
  v_company    TEXT;
  v_birth      DATE;
  v_marketing  BOOLEAN;
  v_category   UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT up.id INTO v_profile_id FROM user_profiles up
    WHERE up.auth_user_id = v_uid AND up.deleted_at IS NULL;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'User profile not found' USING ERRCODE = 'P0001';
  END IF;

  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'empty_patch' USING ERRCODE = 'P0001';
  END IF;

  -- Les champs FINANCIERS ne passent pas par ici : ils ont leur propre gate
  -- (customers.b2b.update) dans update_customer_credit_terms_v1. On refuse
  -- explicitement plutot que d'ignorer en silence — un patch partiellement
  -- applique est pire qu'un patch refuse.
  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_key IN ('retail_credit_limit', 'b2b_credit_limit', 'b2b_payment_terms_days',
                 'b2b_tax_id', 'customer_type') THEN
      RAISE EXCEPTION 'financial_field_use_credit_terms_rpc: %', v_key USING ERRCODE = 'P0001';
    ELSIF v_key NOT IN ('name', 'phone', 'email', 'b2b_company_name',
                        'birth_date', 'marketing_consent', 'category_id') THEN
      RAISE EXCEPTION 'invalid_field: %', v_key USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  IF NOT has_permission(v_uid, 'customers.update') THEN
    RAISE EXCEPTION 'Permission denied: customers.update' USING ERRCODE = 'P0003';
  END IF;

  SELECT id, name, phone, email, b2b_company_name, birth_date, marketing_consent,
         category_id, deleted_at
    INTO v_before
    FROM customers WHERE id = p_customer_id FOR UPDATE;
  IF NOT FOUND OR v_before.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'customer_not_found_or_inactive' USING ERRCODE = 'P0002';
  END IF;

  v_name      := CASE WHEN p_patch ? 'name'  THEN btrim(p_patch->>'name') ELSE v_before.name END;
  v_phone     := CASE WHEN p_patch ? 'phone' THEN NULLIF(btrim(coalesce(p_patch->>'phone','')), '') ELSE v_before.phone END;
  v_email     := CASE WHEN p_patch ? 'email' THEN NULLIF(btrim(coalesce(p_patch->>'email','')), '') ELSE v_before.email END;
  v_company   := CASE WHEN p_patch ? 'b2b_company_name'
                        THEN NULLIF(btrim(coalesce(p_patch->>'b2b_company_name','')), '')
                        ELSE v_before.b2b_company_name END;
  v_birth     := CASE WHEN p_patch ? 'birth_date'
                        THEN NULLIF(p_patch->>'birth_date', '')::date ELSE v_before.birth_date END;
  v_marketing := CASE WHEN p_patch ? 'marketing_consent'
                        THEN (p_patch->>'marketing_consent')::boolean ELSE v_before.marketing_consent END;
  v_category  := CASE WHEN p_patch ? 'category_id'
                        THEN NULLIF(p_patch->>'category_id', '')::uuid ELSE v_before.category_id END;

  IF length(coalesce(v_name, '')) < 1 THEN
    RAISE EXCEPTION 'Customer name required' USING ERRCODE = 'check_violation';
  END IF;
  IF v_category IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM customer_categories WHERE id = v_category AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'category_not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE customers SET
    name              = v_name,
    phone             = v_phone,
    email             = v_email,
    b2b_company_name  = v_company,
    birth_date        = v_birth,
    marketing_consent = v_marketing,
    category_id       = v_category,
    updated_at        = now()
   WHERE id = p_customer_id
  RETURNING name, phone, email, b2b_company_name, birth_date, marketing_consent, category_id
    INTO v_after;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata, payload)
  VALUES (v_profile_id, 'customer.update', 'customers', p_customer_id,
    jsonb_build_object(
      'fields', (SELECT jsonb_agg(k ORDER BY k) FROM jsonb_object_keys(p_patch) AS k)
    ),
    jsonb_build_object(
      'before', jsonb_build_object(
        'name', v_before.name, 'phone', v_before.phone, 'email', v_before.email,
        'b2b_company_name', v_before.b2b_company_name, 'birth_date', v_before.birth_date,
        'marketing_consent', v_before.marketing_consent, 'category_id', v_before.category_id),
      'after', jsonb_build_object(
        'name', v_after.name, 'phone', v_after.phone, 'email', v_after.email,
        'b2b_company_name', v_after.b2b_company_name, 'birth_date', v_after.birth_date,
        'marketing_consent', v_after.marketing_consent, 'category_id', v_after.category_id)
    ));

  RETURN jsonb_build_object(
    'customer_id',       p_customer_id,
    'name',              v_after.name,
    'phone',             v_after.phone,
    'email',             v_after.email,
    'b2b_company_name',  v_after.b2b_company_name,
    'birth_date',        v_after.birth_date,
    'marketing_consent', v_after.marketing_consent,
    'category_id',       v_after.category_id
  );
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Fermeture des chemins d'écriture directs sur `customers`
-- ─────────────────────────────────────────────────────────────────────────────
-- La policy ouvrait l'INSERT de tout client retail a n'importe quel authentifie,
-- independamment de `customers.create`.
DROP POLICY IF EXISTS "auth_insert_retail" ON public.customers;

-- Un REVOKE de TABLE ne retire pas les privileges de COLONNE : on enumere
-- exactement les colonnes accordees (relevees le 2026-08-03).
REVOKE INSERT (category_id, customer_type, email, name, phone)
  ON public.customers FROM authenticated;
REVOKE UPDATE (b2b_company_name, birth_date, category_id, email, marketing_consent, name, phone)
  ON public.customers FROM authenticated;
REVOKE INSERT, UPDATE ON public.customers FROM authenticated;
REVOKE INSERT, UPDATE ON public.customers FROM anon;
REVOKE INSERT, UPDATE ON public.customers FROM PUBLIC;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Décision 3 — l'écriture directe sur les catégories est fermée
-- ─────────────────────────────────────────────────────────────────────────────
-- Les trois RPC CRUD gatees (create/update/delete_customer_category_v1) restent
-- le seul chemin d'ecriture. Ici le grant etait de TABLE, pas de colonne.
REVOKE INSERT, UPDATE ON public.customer_categories FROM authenticated;
REVOKE INSERT, UPDATE ON public.customer_categories FROM anon;
REVOKE INSERT, UPDATE ON public.customer_categories FROM PUBLIC;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Rattachement des fiches sans catégorie (écriture de données)
-- ─────────────────────────────────────────────────────────────────────────────
-- Sans catégorie par défaut en base, la mise à jour ne doit rien faire plutôt
-- que d'écrire NULL sur NULL.
UPDATE customers c
   SET category_id = (SELECT cc.id FROM customer_categories cc
                       WHERE cc.is_default = true AND cc.deleted_at IS NULL LIMIT 1),
       updated_at  = now()
 WHERE c.category_id IS NULL
   AND c.deleted_at IS NULL
   AND EXISTS (SELECT 1 FROM customer_categories cc
                WHERE cc.is_default = true AND cc.deleted_at IS NULL);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) Privilèges des nouvelles RPC
-- ─────────────────────────────────────────────────────────────────────────────
-- Deux mécanismes à neutraliser : `anon` hérite EXECUTE via PUBLIC, et Supabase
-- pose un ALTER DEFAULT PRIVILEGES qui ouvre toute fonction NEUVE à
-- `authenticated`. Ici l'ouverture à `authenticated` est voulue (POS et BO
-- appellent sous JWT utilisateur), le gate vit dans le corps.
REVOKE ALL ON FUNCTION public.create_customer_v3(text, text, text, customer_type) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_customer_v3(text, text, text, customer_type) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_customer_v3(text, text, text, customer_type) TO authenticated;

REVOKE ALL ON FUNCTION public.update_customer_v1(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_customer_v1(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_customer_v1(uuid, jsonb) TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.create_customer_v3(text, text, text, customer_type) IS
  'ADR-020 dec. 2 : seul chemin de creation d''une fiche client. Gate explicite — un compte B2B exige customers.create (MANAGER+), un client retail accepte aussi customers.pos.create (creation express en caisse). Ecrit audit_logs. Remplace create_customer_v2, qui n''avait aucun gate.';

COMMENT ON FUNCTION public.update_customer_v1(uuid, jsonb) IS
  'ADR-020 dec. 2 : seul chemin de modification d''une fiche client. Patch JSONB, presence de cle = intention, gate customers.update, diff avant/apres dans audit_logs. Les champs financiers sont REFUSES ici : ils relevent de update_customer_credit_terms_v1 (dec. 1).';
