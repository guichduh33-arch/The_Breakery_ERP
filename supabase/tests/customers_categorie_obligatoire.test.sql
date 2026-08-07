-- supabase/tests/customers_categorie_obligatoire.test.sql
-- Migration 20260807000002 — une fiche client VIVANTE porte toujours une catégorie.
-- Run via MCP execute_sql (enveloppe BEGIN..ROLLBACK portée par ce fichier).
--
-- Ce fichier existe parce que l'invariant n'était affirmé que par l'assertion C10
-- de l'ADR-020, qui compte les orphelins sans dire d'où ils viennent. Un compteur
-- qui passe au rouge ne désigne pas le producteur : on teste ici les deux chemins
-- qui en fabriquaient, plus la contrainte elle-même.
BEGIN;

CREATE TEMP TABLE _r(name TEXT PRIMARY KEY, pass BOOLEAN) ON COMMIT DROP;

DO $$
DECLARE
  v_auth UUID; v_default UUID; v_id UUID; v_report JSONB; v_key UUID;
  v_refuse BOOLEAN := false;
BEGIN
  SELECT cc.id INTO v_default FROM customer_categories cc
   WHERE cc.is_default = true AND cc.deleted_at IS NULL LIMIT 1;

  -- T1 : la catégorie par défaut est une PRÉCONDITION, pas une commodité.
  --   `create_customer_v3` comme `import_customers_v2` s'appuient dessus ; sans
  --   elle, toute création deviendrait impossible sous la contrainte. On la
  --   surveille ici plutôt que d'ajouter une garde dans chaque RPC.
  INSERT INTO _r SELECT 'T1_une_seule_categorie_par_defaut',
    (SELECT COUNT(*) FROM customer_categories WHERE is_default AND deleted_at IS NULL) = 1;

  -- T2 : une fiche VIVANTE créée sans catégorie reçoit le défaut — le trigger
  --   remplit, il ne refuse pas. C'est ce qui permet aux vingt suites qui
  --   insèrent en direct (b2b_*, store_credit_*, loyalty_*…) de continuer à
  --   tourner sans connaître la règle.
  INSERT INTO customers (name, customer_type)
    VALUES ('CAT Orphelin Vivant', 'retail') RETURNING category_id INTO v_id;
  INSERT INTO _r SELECT 'T2_fiche_vivante_sans_categorie_recoit_le_defaut',
    v_id = v_default;

  -- T2b : le CHECK reste le garde-fou. On le prouve en neutralisant le trigger
  --   le temps d'une insertion : sans lui, l'orpheline est refusée.
  ALTER TABLE customers DISABLE TRIGGER trg_customers_categorie_par_defaut;
  BEGIN
    INSERT INTO customers (name, customer_type) VALUES ('CAT Sans Trigger', 'retail');
    v_refuse := false;
  EXCEPTION WHEN check_violation THEN v_refuse := true;
  END;
  -- ENABLE ALWAYS, pas ENABLE nu : `ENABLE TRIGGER` restaure le mode `origin`
  --   et rétrograderait donc le trigger que T2c teste juste après. Mesuré :
  --   ALWAYS -> DISABLE -> ENABLE = `origin`, et T2c échoue sur le CHECK.
  ALTER TABLE customers ENABLE ALWAYS TRIGGER trg_customers_categorie_par_defaut;
  INSERT INTO _r SELECT 'T2b_check_refuse_si_le_trigger_ne_remplit_pas', v_refuse;

  -- T2c : le trigger tient sous `session_replication_role = replica`. Plusieurs
  --   suites posent ce mode pour neutraliser les triggers metier ; il desactive
  --   les triggers ordinaires mais PAS les CHECK, si bien qu'un trigger non
  --   ENABLE ALWAYS laisserait la contrainte refuser seule. C'est exactement ce
  --   qui a fait tomber gross_margin_by_product le 2026-08-07.
  SET LOCAL session_replication_role = replica;
  INSERT INTO customers (name) VALUES ('CAT Mode Replica') RETURNING category_id INTO v_id;
  SET LOCAL session_replication_role = origin;
  INSERT INTO _r SELECT 'T2c_trigger_actif_en_mode_replica', v_id = v_default;

  -- T3 : et tolère une fiche SUPPRIMÉE sans catégorie — les 69 fiches mortes de
  --   dev sont antérieures à la règle, on ne leur invente pas une catégorie.
  BEGIN
    INSERT INTO customers (name, customer_type, deleted_at)
      VALUES ('CAT Orphelin Mort', 'retail', now()) RETURNING id INTO v_id;
    INSERT INTO _r SELECT 'T3_fiche_supprimee_sans_categorie_toleree', v_id IS NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r SELECT 'T3_fiche_supprimee_sans_categorie_toleree', false;
  END;

  -- ── Les deux chemins de l'import ────────────────────────────────────────
  SELECT up.auth_user_id INTO v_auth FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'customers.create') LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);

  -- T4 : catégorie ABSENTE -> la fiche reçoit le défaut, l'import aboutit.
  --   C'est le cas courant : un fichier nom/téléphone, sans colonne catégorie.
  v_key := gen_random_uuid();
  v_report := import_customers_v2(
    jsonb_build_array(jsonb_build_object('name', 'CAT Import Sans Cat', 'phone', '+62899000011')),
    false, v_key);
  INSERT INTO _r SELECT 'T4_import_sans_categorie_recoit_le_defaut',
    (v_report->>'valid')::boolean
    AND (SELECT category_id FROM customers WHERE phone = '+62899000011') = v_default;

  -- T5 : catégorie RENSEIGNÉE mais introuvable -> rejet, rien n'est écrit.
  --   On défaute l'intention non exprimée, jamais la faute de frappe.
  v_report := import_customers_v2(
    jsonb_build_array(jsonb_build_object('name', 'CAT Import Cat Fausse',
                                         'phone', '+62899000012', 'category', 'Categorie Inexistante')),
    false, gen_random_uuid());
  INSERT INTO _r SELECT 'T5_import_categorie_inconnue_rejetee',
    (v_report->>'valid')::boolean IS FALSE
    AND v_report->'errors'->0->>'code' = 'unknown_category'
    AND NOT EXISTS (SELECT 1 FROM customers WHERE phone = '+62899000012');

  -- T6 : l'idempotence de l'import survit au bump (rejoue le rapport initial).
  v_report := import_customers_v2(
    jsonb_build_array(jsonb_build_object('name', 'CAT Import Sans Cat', 'phone', '+62899000011')),
    false, v_key);
  INSERT INTO _r SELECT 'T6_import_rejeu_idempotent',
    (v_report->>'idempotent_replay')::boolean
    AND (SELECT COUNT(*) FROM customers WHERE phone = '+62899000011') = 1;

  -- T7 : la v1 a bien disparu, et anon n'atteint pas la v2.
  INSERT INTO _r SELECT 'T7_v1_droppee_et_anon_revoque',
    NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'import_customers_v1')
    AND NOT has_function_privilege('anon', 'public.import_customers_v2(jsonb,boolean,uuid)', 'EXECUTE');
END $$;

SELECT name, pass FROM _r ORDER BY name;
-- Attendu : 9 lignes, pass = true partout.
ROLLBACK;
