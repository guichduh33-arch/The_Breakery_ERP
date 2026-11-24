-- ADR-047 — Équipements : fonctions du registre, de l'approbation et de la
-- dotation automatique.
--
-- Choix techniques :
-- * _emit_expense_je est le seul émetteur de l'écriture d'une dépense
--   approuvée (appelé par approve_expense et par l'auto-approbation de
--   submit_expense). Son corps part du corps live (pg_get_functiondef du
--   2026-11-25) ; deux changements seulement : le compte débité d'une dépense
--   marquée équipement, et la création des fiches dans le même geste. La garde
--   guard_expense_category_definition (classe 6) n'est pas touchée : la
--   catégorie garde son compte de charge, c'est la marque qui détourne le débit.
-- * Le seuil de 2 000 000 IDR TTC par article est vérifié deux fois : quand la
--   dépense est marquée, puis à l'approbation (le montant fait foi à ce moment).
-- * Dotation : mois de mise en service entier, mois de sortie sans dotation,
--   coût ÷ durée arrondi au centime, dernier mois = coût − (durée − 1) ×
--   dotation, plafonnée à la valeur nette restante. Un mois refusé pour
--   période fermée n'est jamais reporté : le dernier mois ne l'absorbe pas.
-- * Le passage automatique tourne chaque jour et poste tous les mois TERMINÉS
--   non passés : un mois manqué se rattrape à sa propre date. Chaque mois est
--   un sous-bloc : une période fermée refuse ce mois sans bloquer les autres.
-- * L'écriture de dotation porte reference_type 'fixed_asset_depreciation',
--   reference_id = l'équipement, movement_type = 'YYYY-MM' : l'index
--   d'idempotence des écritures interdit lui aussi un doublon de mois.
-- * Sortie : PIN vérifié serveur avec verrouillage. Un PIN faux RENVOIE
--   ok=false au lieu de lever : une exception annulerait le compteur d'échecs
--   et le verrouillage ne se déclencherait jamais (même contrat que
--   create_manual_je et approve_expense).

-- ---------------------------------------------------------------------------
-- Helpers purs
-- ---------------------------------------------------------------------------
CREATE FUNCTION public._fixed_asset_life_months_v1(p_group public.fixed_asset_tax_group)
RETURNS smallint
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE p_group WHEN 'group_1' THEN 48 WHEN 'group_2' THEN 96 END::smallint;
$function$;

CREATE FUNCTION public._fixed_asset_account_key_v1(p_type public.fixed_asset_type)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE p_type WHEN 'equipment' THEN 'FIXED_ASSET_EQUIPMENT'
                     WHEN 'production_machine' THEN 'FIXED_ASSET_PRODUCTION_MACHINE' END;
$function$;

-- Rang du mois p_month dans le plan (1 = mois de mise en service).
CREATE FUNCTION public._fixed_asset_month_index_v1(p_in_service date, p_month date)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT ((extract(year FROM p_month)::int * 12 + extract(month FROM p_month)::int)
        - (extract(year FROM p_in_service)::int * 12 + extract(month FROM p_in_service)::int)) + 1;
$function$;

-- Dotation prévue au rang p_index : coût ÷ durée, le dernier mois absorbe
-- l'arrondi. Hors plan : 0.
CREATE FUNCTION public._fixed_asset_month_amount_v1(p_cost numeric, p_life integer, p_index integer)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_index < 1 OR p_index > p_life THEN 0::numeric
    WHEN p_index < p_life THEN round(p_cost / p_life, 2)
    ELSE GREATEST(p_cost - (p_life - 1) * round(p_cost / p_life, 2), 0)
  END;
$function$;

-- ---------------------------------------------------------------------------
-- Création d'une fiche (interne)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public._insert_fixed_asset_v1(
  p_name text, p_type public.fixed_asset_type, p_group public.fixed_asset_tax_group,
  p_in_service_date date, p_cost numeric, p_origin public.fixed_asset_origin,
  p_expense_id uuid, p_unit_index smallint, p_opening_accumulated numeric,
  p_opening_as_of date, p_actor uuid, p_idempotency_key uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_life    smallint := _fixed_asset_life_months_v1(p_group);
  v_account uuid := resolve_mapping_account(_fixed_asset_account_key_v1(p_type));
  v_start   date;
  v_number  text;
  v_id      uuid;
BEGIN
  v_start := CASE WHEN p_origin = 'opening'
                  THEN (date_trunc('month', p_opening_as_of) + interval '1 month')::date
                  ELSE date_trunc('month', p_in_service_date)::date END;
  v_number := 'FA-' || lpad(nextval('public.fixed_asset_number_seq')::text, 4, '0');

  INSERT INTO fixed_assets (
    asset_number, name, asset_type, tax_group, useful_life_months, asset_account_id,
    in_service_date, cost, monthly_depreciation, origin, expense_id, expense_unit_index,
    opening_accumulated, opening_accumulated_as_of, depreciation_start_month,
    idempotency_key, created_by
  ) VALUES (
    v_number, btrim(p_name), p_type, p_group, v_life, v_account,
    p_in_service_date, p_cost, round(p_cost / v_life, 2), p_origin, p_expense_id, p_unit_index,
    COALESCE(p_opening_accumulated, 0), p_opening_as_of, v_start,
    p_idempotency_key, p_actor
  ) RETURNING id INTO v_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (p_actor, 'fixed_asset.created', 'fixed_asset', v_id, jsonb_build_object(
    'asset_number', v_number, 'name', btrim(p_name), 'asset_type', p_type,
    'tax_group', p_group, 'useful_life_months', v_life, 'cost', p_cost,
    'in_service_date', p_in_service_date, 'origin', p_origin, 'expense_id', p_expense_id,
    'opening_accumulated', COALESCE(p_opening_accumulated, 0),
    'opening_accumulated_as_of', p_opening_as_of,
    'depreciation_start_month', v_start));
  RETURN v_id;
END $function$;

-- Fiches nées de l'approbation d'une dépense marquée équipement.
CREATE FUNCTION public._create_fixed_assets_from_expense_v1(p_expense_id uuid, p_actor uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_expense expenses%ROWTYPE;
  v_unit    numeric(15,2);
  v_cost    numeric(15,2);
  i         integer;
BEGIN
  SELECT * INTO v_expense FROM expenses WHERE id = p_expense_id;
  IF NOT FOUND OR v_expense.asset_type IS NULL THEN
    RETURN 0;
  END IF;
  IF v_expense.amount < 2000000 * v_expense.asset_quantity THEN
    RAISE EXCEPTION 'fixed_asset_below_threshold' USING ERRCODE = '22023';
  END IF;
  -- Coût par article tronqué au centime ; le dernier article prend le reste,
  -- donc la somme des fiches égale le montant de la dépense.
  v_unit := trunc(v_expense.amount / v_expense.asset_quantity, 2);
  FOR i IN 1..v_expense.asset_quantity LOOP
    v_cost := CASE WHEN i < v_expense.asset_quantity THEN v_unit
                   ELSE v_expense.amount - v_unit * (v_expense.asset_quantity - 1) END;
    PERFORM _insert_fixed_asset_v1(
      CASE WHEN v_expense.asset_quantity > 1
           THEN v_expense.asset_name || ' (' || i || '/' || v_expense.asset_quantity || ')'
           ELSE v_expense.asset_name END,
      v_expense.asset_type, v_expense.asset_tax_group, v_expense.expense_date, v_cost,
      'expense', v_expense.id, i::smallint, 0, NULL, p_actor, NULL);
  END LOOP;
  RETURN v_expense.asset_quantity;
END $function$;

-- ---------------------------------------------------------------------------
-- Émetteur de l'écriture d'une dépense approuvée (corps live + ADR-047)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._emit_expense_je(p_expense_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_uid     UUID := auth.uid();
  v_caller_profile UUID;
  v_expense        expenses%ROWTYPE;
  v_cat_account    UUID;
  v_credit_acc     UUID;
  v_credit_key     TEXT;
  v_je_id          UUID;
  v_entry_no       TEXT;
BEGIN
  -- Fix 2 (pré-existant): guard against NULL auth context (pg_cron / background caller)
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION '_emit_expense_je: no auth context' USING ERRCODE = '28000';
  END IF;

  -- journal_entries.created_by référence user_profiles(id), pas auth.users(id).
  SELECT id INTO v_caller_profile FROM user_profiles
    WHERE auth_user_id = v_caller_uid AND deleted_at IS NULL LIMIT 1;
  IF v_caller_profile IS NULL THEN
    RAISE EXCEPTION '_emit_expense_je: no user_profile for caller' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_expense FROM expenses WHERE id = p_expense_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '_emit_expense_je: expense % not found', p_expense_id USING ERRCODE = 'P0002';
  END IF;

  -- Resolve debit account: category-specific or fallback to EXPENSE_DEFAULT
  SELECT account_id INTO v_cat_account FROM expense_categories WHERE id = v_expense.category_id;
  IF v_cat_account IS NULL THEN
    v_cat_account := resolve_mapping_account('EXPENSE_DEFAULT');
  END IF;

  -- ADR-047 : une dépense marquée équipement débite le compte d'équipement de
  -- son type (1600 / 1610) au lieu du compte de sa catégorie.
  IF v_expense.asset_type IS NOT NULL THEN
    IF v_expense.amount < 2000000 * v_expense.asset_quantity THEN
      RAISE EXCEPTION 'fixed_asset_below_threshold' USING ERRCODE = '22023';
    END IF;
    v_cat_account := resolve_mapping_account(_fixed_asset_account_key_v1(v_expense.asset_type));
  END IF;

  -- Resolve credit account: AP (credit terms) or the settlement account of the METHOD.
  -- 2026-09-09 (audit finding n°4) : ce n'était plus EXPENSE_CASH_OUT en dur.
  IF v_expense.payment_method = 'credit' THEN
    v_credit_acc := resolve_mapping_account('EXPENSE_AP');
  ELSE
    v_credit_key := _expense_settlement_mapping_key(v_expense.payment_method);
    IF v_credit_key IS NULL THEN
      RAISE EXCEPTION '_emit_expense_je: unknown payment_method % for expense %',
        v_expense.payment_method, p_expense_id USING ERRCODE = '22023';
    END IF;
    v_credit_acc := resolve_mapping_account(v_credit_key);
  END IF;

  -- ADR-003 (NON-PKP) sanity check : vat_amount ne peut pas être négatif ni excéder le
  -- montant total (le montant est déjà TTC — vat_amount y est inclus, jamais ajouté).
  IF COALESCE(v_expense.vat_amount, 0) < 0 OR COALESCE(v_expense.vat_amount, 0) > v_expense.amount THEN
    RAISE EXCEPTION '_emit_expense_je: vat_amount % is invalid for amount %',
      v_expense.vat_amount, v_expense.amount USING ERRCODE = '22023';
  END IF;

  v_entry_no := next_journal_entry_number(v_expense.expense_date);

  INSERT INTO journal_entries (
    entry_number, entry_date, description, reference_type, reference_id,
    status, total_debit, total_credit, created_by
  ) VALUES (
    v_entry_no,
    v_expense.expense_date,
    'Expense ' || v_expense.expense_number || ' - ' || left(v_expense.description, 60),
    'expense',
    v_expense.id,
    'posted',
    v_expense.amount,
    v_expense.amount,
    v_caller_profile
  )
  RETURNING id INTO v_je_id;

  -- DR category : montant total (le PPN non récupérable est foldé dans la charge,
  -- ADR-003 NON-PKP — plus de ligne séparée vers EXPENSE_VAT_INPUT / compte 1151).
  -- ADR-047 : pour un équipement, le PPN entre de même dans le coût.
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_je_id, v_cat_account, v_expense.amount, 0,
          CASE WHEN v_expense.asset_type IS NOT NULL
               THEN 'Equipment purchase (incl. non-recoverable VAT)'
               ELSE 'Expense - category (incl. non-recoverable VAT)' END);

  -- CR credit account (full amount)
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_je_id, v_credit_acc, 0, v_expense.amount,
          CASE WHEN v_expense.payment_method = 'credit' THEN 'Expense - AP'
               ELSE 'Expense - settled by ' || lower(coalesce(v_expense.payment_method,'cash')) END);

  -- Stamp je_id on the expense row
  UPDATE expenses SET je_id = v_je_id WHERE id = p_expense_id;

  -- ADR-047 décision 3 : le même geste crée les fiches du registre.
  PERFORM _create_fixed_assets_from_expense_v1(p_expense_id, v_caller_profile);

  RETURN v_je_id;
END $function$;

-- ---------------------------------------------------------------------------
-- Droits : fermés, puis ouverts objet par objet
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public._fixed_asset_life_months_v1(public.fixed_asset_tax_group) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._fixed_asset_life_months_v1(public.fixed_asset_tax_group) FROM anon;
REVOKE EXECUTE ON FUNCTION public._fixed_asset_life_months_v1(public.fixed_asset_tax_group) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public._fixed_asset_account_key_v1(public.fixed_asset_type) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._fixed_asset_account_key_v1(public.fixed_asset_type) FROM anon;
REVOKE EXECUTE ON FUNCTION public._fixed_asset_account_key_v1(public.fixed_asset_type) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public._fixed_asset_month_index_v1(date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._fixed_asset_month_index_v1(date, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public._fixed_asset_month_index_v1(date, date) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public._fixed_asset_month_amount_v1(numeric, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._fixed_asset_month_amount_v1(numeric, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public._fixed_asset_month_amount_v1(numeric, integer, integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public._insert_fixed_asset_v1(text, public.fixed_asset_type, public.fixed_asset_tax_group, date, numeric, public.fixed_asset_origin, uuid, smallint, numeric, date, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._insert_fixed_asset_v1(text, public.fixed_asset_type, public.fixed_asset_tax_group, date, numeric, public.fixed_asset_origin, uuid, smallint, numeric, date, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public._insert_fixed_asset_v1(text, public.fixed_asset_type, public.fixed_asset_tax_group, date, numeric, public.fixed_asset_origin, uuid, smallint, numeric, date, uuid, uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public._create_fixed_assets_from_expense_v1(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._create_fixed_assets_from_expense_v1(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public._create_fixed_assets_from_expense_v1(uuid, uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public._emit_expense_je(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._emit_expense_je(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public._emit_expense_je(uuid) FROM authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
