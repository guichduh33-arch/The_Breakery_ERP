-- 20260807000002_customers_categorie_obligatoire.sql
--
-- Une fiche client vivante porte toujours une catégorie — garanti par le schéma,
-- plus seulement affirmé par un test.
--
-- L'ADR-020 a fait passer la création par `create_customer_v3`, qui assigne la
-- catégorie par défaut, et a posé l'assertion C10 : « aucune fiche active sans
-- catégorie ». Cette assertion échoue en continu sur dev, et le relevé du
-- 2026-08-07 explique pourquoi — l'invariant n'existait nulle part ailleurs que
-- dans le test.
--
-- DEUX producteurs d'orphelins ont été identifiés.
--
-- (A) `import_customers_v1`. Sa validation rejette une catégorie RENSEIGNÉE mais
--     introuvable (`unknown_category`, gardée par `c.category IS NOT NULL`), et
--     la moindre erreur bloque tout l'import. En revanche une catégorie
--     ABSENTE — colonne optionnelle, cas le plus courant d'un fichier nom/téléphone
--     — laissait `v_cat_id` à NULL et importait une fiche orpheline, sans erreur
--     ni avertissement. La v2 bascule ce cas sur la catégorie par défaut, ce qui
--     est EXACTEMENT ce que fait `create_customer_v3` au comptoir : une fiche
--     créée avec juste un nom reçoit le défaut, qu'elle vienne de la caisse ou
--     d'un CSV. Le cas « catégorie inconnue » reste rejeté — on défaute
--     l'intention non exprimée, jamais l'erreur de saisie.
--
-- (A bis) En portant la v1, un TROISIÈME défaut est tombé : sa ligne d'audit
--     écrivait `auth.uid()` dans `audit_logs.actor_id`, colonne qui référence
--     `user_profiles(id)`. L'import réel (non dry-run) échouait donc sur la clé
--     étrangère pour tout appelant dont le profil n'a pas `id = auth_user_id` —
--     23 des 29 profils de dev. Corrigé dans la v2.
--
-- (B) Deux suites de tests live-RPC (`loyalty-rls`, `loyalty-adjust`) inséraient
--     des fiches sans catégorie et ne nettoyaient rien. Corrigé hors migration,
--     dans les fichiers de test : c'est la source, et aucune contrainte ne
--     remplace un test qui range derrière lui.
--
-- LA CONTRAINTE EST UN CHECK, PAS UN `NOT NULL`. Au 2026-08-07 la table porte 73
-- fiches sans catégorie, dont 69 SUPPRIMÉES. Un `NOT NULL` obligerait à leur
-- inventer une catégorie qu'elles n'ont jamais eue, pour satisfaire une règle qui
-- ne les concerne pas. Le CHECK énonce l'invariant réel — celui de C10 — et ne
-- touche que le vivant : backfill de 4 lignes au lieu de 73.

-- ---------------------------------------------------------------------------
-- 1. L'import défaute la catégorie absente.
--    Corps repris du live (`pg_get_functiondef`) ; seule la résolution de
--    `v_cat_id` change, le reste est à l'identique.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_customers_v2(
  p_payload JSONB,
  p_dry_run BOOLEAN DEFAULT true,
  p_idempotency_key UUID DEFAULT NULL::uuid)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller    UUID := auth.uid();
  v_existing  JSONB;
  v_errors    JSONB;
  v_summary   JSONB;
  v_report    JSONB;
  v_err_count INT;
  r           RECORD;
  v_cat_id    UUID;
  v_default   UUID;
  v_actor     UUID;
BEGIN
  IF v_caller IS NULL OR NOT has_permission(v_caller, 'customers.create') THEN
    RAISE EXCEPTION 'permission denied: customers.create required' USING ERRCODE = '42501';
  END IF;

  -- `audit_logs.actor_id` référence `user_profiles(id)`, PAS `auth.uid()`. La v1
  -- y écrivait `auth.uid()` directement : sur les 29 profils de dev, 6 seulement
  -- ont `id = auth_user_id`, si bien qu'un import réel échouait sur la clé
  -- étrangère pour tous les autres — après avoir inséré les fiches, donc annulé
  -- en bloc avec un message que personne ne pouvait relier à la cause. Corrigé
  -- ici parce qu'on ne republie pas un corps dont on sait qu'il casse.
  SELECT up.id INTO v_actor FROM user_profiles up
   WHERE up.auth_user_id = v_caller AND up.deleted_at IS NULL LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'user profile not found' USING ERRCODE = 'P0001';
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
  INSERT INTO t_err SELECT 'Customers', MIN(row_num), phone, 'duplicate_in_file',
         format('phone "%s" appears %s times in the file', phone, COUNT(*))
    FROM t_cust WHERE phone IS NOT NULL GROUP BY phone HAVING COUNT(*) > 1;
  INSERT INTO t_err SELECT 'Customers', MIN(row_num), email, 'duplicate_in_file',
         format('email "%s" appears %s times in the file', email, COUNT(*))
    FROM t_cust WHERE email IS NOT NULL GROUP BY email HAVING COUNT(*) > 1;
  INSERT INTO t_err SELECT 'Customers', c.row_num, c.phone, 'duplicate_exists',
         format('a customer with phone "%s" already exists', c.phone)
    FROM t_cust c WHERE c.phone IS NOT NULL
     AND EXISTS (SELECT 1 FROM customers x WHERE x.deleted_at IS NULL AND x.phone = c.phone);
  INSERT INTO t_err SELECT 'Customers', c.row_num, c.email, 'duplicate_exists',
         format('a customer with email "%s" already exists', c.email)
    FROM t_cust c WHERE c.email IS NOT NULL
     AND EXISTS (SELECT 1 FROM customers x WHERE x.deleted_at IS NULL AND x.email = c.email);

  FOR r IN SELECT row_num, birth_date FROM t_cust
            WHERE birth_date IS NOT NULL AND birth_date ~ '^\d{4}-\d{2}-\d{2}$' LOOP
    BEGIN
      PERFORM r.birth_date::date;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO t_err VALUES ('Customers', r.row_num, NULL, 'invalid_birth_date',
        format('birth_date "%s" is not a valid calendar date', r.birth_date));
    END;
  END LOOP;

  -- Sans catégorie par défaut, l'import ne peut plus produire de fiche conforme :
  -- on le dit AVANT d'écrire, plutôt que de laisser le CHECK trancher ligne à
  -- ligne avec un message que l'utilisateur ne saurait pas lire.
  SELECT cc.id INTO v_default FROM customer_categories cc
   WHERE cc.is_default = true AND cc.deleted_at IS NULL LIMIT 1;
  IF v_default IS NULL THEN
    INSERT INTO t_err VALUES ('Customers', NULL, NULL, 'no_default_category',
      'no default customer category is configured — set one before importing');
  END IF;

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

  FOR r IN SELECT * FROM t_cust ORDER BY row_num LOOP
    -- Catégorie ABSENTE -> défaut (parité avec create_customer_v3).
    -- Catégorie RENSEIGNÉE mais introuvable -> déjà rejetée plus haut, on ne
    -- passe jamais ici avec un nom non résolu.
    v_cat_id := v_default;
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
  VALUES (v_actor, 'customers.imported', 'customer', NULL, v_summary);

  BEGIN
    INSERT INTO import_master_data_idempotency_keys (key, entity, report, created_by)
    VALUES (p_idempotency_key, 'customers', v_report, v_caller);
  EXCEPTION WHEN unique_violation THEN
    SELECT report INTO v_existing FROM import_master_data_idempotency_keys WHERE key = p_idempotency_key;
    RETURN v_existing || jsonb_build_object('idempotent_replay', true);
  END;

  RETURN v_report;
END;
$function$;

COMMENT ON FUNCTION public.import_customers_v2(JSONB, BOOLEAN, UUID) IS
  'Import CSV de fiches clients. Identique a la v1, sauf la categorie ABSENTE qui '
  'bascule sur la categorie par defaut (parite avec create_customer_v3) au lieu '
  'de produire une fiche orpheline. Une categorie renseignee mais introuvable '
  'reste rejetee. Gatee sur customers.create.';

REVOKE ALL ON FUNCTION public.import_customers_v2(JSONB, BOOLEAN, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.import_customers_v2(JSONB, BOOLEAN, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.import_customers_v2(JSONB, BOOLEAN, UUID) TO authenticated;

DROP FUNCTION IF EXISTS public.import_customers_v1(JSONB, BOOLEAN, UUID);

-- ---------------------------------------------------------------------------
-- 2. Backfill des fiches VIVANTES orphelines, puis la contrainte.
--    L'ordre est impératif : la contrainte refuserait la table telle quelle.
-- ---------------------------------------------------------------------------
UPDATE customers c
   SET category_id = (SELECT cc.id FROM customer_categories cc
                       WHERE cc.is_default = true AND cc.deleted_at IS NULL LIMIT 1),
       updated_at  = now()
 WHERE c.category_id IS NULL
   AND c.deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Le trigger REMPLIT, la contrainte GARANTIT.
--
-- Un CHECK seul aurait été un piège : vingt suites pgTAP (`b2b_*`,
-- `store_credit_*`, `loyalty_*`, `retail_tab_*`, `marketing`, `adr013_*`…)
-- insèrent des fiches en direct, sans catégorie, et se seraient toutes mises à
-- échouer d'un coup. Mesuré, pas supposé : le CHECK posé seul a fait passer la
-- suite pgTAP de 1 à 20 fichiers rouges.
--
-- Exiger de chaque écrivain qu'il pense au défaut, c'est reporter la règle sur
-- vingt appelants qui ne la connaissent pas. Le trigger la pose une fois pour
-- toutes, à l'endroit où la donnée entre — et la fiche SUPPRIMÉE garde le droit
-- de n'avoir aucune catégorie, parce qu'elle est antérieure à la règle.
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER, et ce n'est pas une precaution de style : `customer_categories`
-- porte une RLS (`auth_read`). Sans cela, le trigger resout le defaut avec les
-- droits de l'appelant — il a fonctionne sous une connexion superutilisateur, qui
-- contourne la RLS, et a echoue en CI sous un role ordinaire, en laissant passer
-- un NULL que le CHECK a refuse. Le defaut doit se resoudre quel que soit ce que
-- l'appelant a le droit de lire.
CREATE OR REPLACE FUNCTION public.fn_customers_categorie_par_defaut()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.category_id IS NULL AND NEW.deleted_at IS NULL THEN
    SELECT cc.id INTO NEW.category_id FROM customer_categories cc
     WHERE cc.is_default = true AND cc.deleted_at IS NULL LIMIT 1;
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_customers_categorie_par_defaut() IS
  'Remplit category_id avec la categorie par defaut quand une fiche VIVANTE est '
  'creee ou mise a jour sans categorie. SECURITY DEFINER : customer_categories '
  'porte une RLS, et le defaut doit se resoudre quel que soit ce que l appelant '
  'a le droit de lire. chk_customers_categorie_si_vivante reste le garde-fou.';

-- INSERT **OR UPDATE** : vider la categorie d'une fiche vivante la ramene au
-- defaut, au lieu d'echouer. Un changement de categorie EXPLICITE n'est jamais
-- ecrase — le trigger ne se declenche que sur NULL — et une fiche supprimee
-- garde le droit de n'en avoir aucune.
DROP TRIGGER IF EXISTS trg_customers_categorie_par_defaut ON customers;
CREATE TRIGGER trg_customers_categorie_par_defaut
  BEFORE INSERT OR UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION public.fn_customers_categorie_par_defaut();

-- ENABLE ALWAYS, et c'est la clé de voûte du dispositif. Plusieurs suites de
-- test posent `SET LOCAL session_replication_role = replica` pour neutraliser
-- les triggers metier (JE de vente, etc.) et fabriquer des fixtures isolees. Ce
-- mode desactive TOUS les triggers ordinaires — mais PAS les contraintes CHECK.
-- Sans ENABLE ALWAYS, le trigger ne remplit donc rien pendant que le CHECK, lui,
-- continue de refuser : la garantie s'evapore exactement la ou la contrainte
-- mord. Ce trigger porte un invariant de donnee, pas une regle metier
-- replicable ; il doit tourner dans tous les modes.
ALTER TABLE customers ENABLE ALWAYS TRIGGER trg_customers_categorie_par_defaut;

-- Le CHECK dit l'invariant de C10, mot pour mot : une fiche VIVANTE porte une
-- categorie. Il ne remplace pas le trigger, il le surveille — si la categorie
-- par defaut venait a disparaitre, le trigger ne remplirait plus rien et c'est
-- ici que l'ecriture serait refusee, plutot que de produire un orphelin.
ALTER TABLE customers
  ADD CONSTRAINT chk_customers_categorie_si_vivante
  CHECK (deleted_at IS NOT NULL OR category_id IS NOT NULL);

COMMENT ON CONSTRAINT chk_customers_categorie_si_vivante ON customers IS
  'ADR-020 / C10 : aucune fiche active sans categorie. Ne contraint pas les '
  'fiches supprimees, qui sont anterieures a la regle.';
