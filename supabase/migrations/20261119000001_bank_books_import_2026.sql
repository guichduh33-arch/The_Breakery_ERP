-- Reprise de la comptabilité tenue hors ERP (relevés Bank Mandiri) pour 2026.
--
-- Décision de Mamat du 2026-11-19 : l'ERP porte toute l'année fiscale 2026.
-- Un bilan d'ouverture au 1er janvier 2026 (résultat d'octobre à décembre 2025
-- en report à nouveau) puis un résumé par mois, de janvier à septembre, tirés
-- du classeur tenu sur les relevés bancaires. Octobre et novembre 2026 ne sont
-- pas repris par ce chemin : l'ERP en porte déjà les ventes et les achats.
--
-- La fonction ne connaît aucun chiffre. Les écritures arrivent en argument, au
-- moment de l'appel : les montants de la société ne vivent pas dans le dépôt.
-- Elle les vérifie TOUTES avant d'en écrire une : date entre le 1er janvier et
-- le 30 septembre 2026 et dans une période ouverte, au moins deux lignes,
-- montants JSON numériques à deux décimales au plus et tenant dans les colonnes
-- du journal (DECIMAL(12,2)), débit XOR crédit positif, compte actif et
-- imputable, écriture équilibrée. Un seul passage réel : la garde lit le `kind`
-- des écritures déjà posées (aucune référence, l'index d'idempotence ne couvre
-- pas ces écritures). Le mode simulation, par défaut, n'écrit rien ; un
-- `p_dry_run` NULL est refusé plutôt que lu comme un passage réel, et le
-- passage réel exige l'acteur (un `user_profiles.id`) pour l'audit.
--
-- Réservée au service_role, comme la famille `post_stock_chain_catchup` dont
-- elle reprend la forme.

CREATE FUNCTION public.post_bank_books_import_v1(
  p_entries jsonb,
  p_dry_run boolean DEFAULT true,
  p_actor   uuid    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c_kind       CONSTANT text := 'bank_books_import_2026';
  v_entry      jsonb;
  v_line       jsonb;
  v_date       date;
  v_desc       text;
  v_acc        RECORD;
  v_dr         numeric;
  v_cr         numeric;
  v_sum_dr     numeric(14,2);
  v_sum_cr     numeric(14,2);
  v_all_dr     numeric(14,2) := 0;
  v_index      int := 0;
  v_je_id      uuid;
  v_entry_no   text;
  v_posted     jsonb := '[]'::jsonb;
  v_summary    jsonb := '[]'::jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('bank-books-import-2026', 0));

  IF p_dry_run IS NULL THEN
    RAISE EXCEPTION 'dry_run_flag_required' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM journal_entries
              WHERE reference_type = 'manual'
                AND metadata->>'kind' = c_kind
                AND status IN ('posted','locked')) THEN
    IF p_dry_run THEN
      RETURN jsonb_build_object('already_posted', true);
    END IF;
    RAISE EXCEPTION 'bank_books_import_already_posted' USING ERRCODE = 'P0003';
  END IF;

  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' OR jsonb_array_length(p_entries) = 0 THEN
    RAISE EXCEPTION 'entries_array_required' USING ERRCODE = 'P0001';
  END IF;

  IF NOT p_dry_run AND p_actor IS NULL THEN
    RAISE EXCEPTION 'actor_required_for_real_run' USING ERRCODE = 'P0001';
  END IF;
  IF p_actor IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM user_profiles WHERE id = p_actor AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'actor_profile_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- 1. Tout vérifier avant d'écrire.
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries) LOOP
    v_index := v_index + 1;
    v_date := (v_entry->>'date')::date;
    v_desc := v_entry->>'description';
    IF v_date IS NULL THEN
      RAISE EXCEPTION 'entry_%_date_required', v_index USING ERRCODE = 'P0001';
    END IF;
    IF v_date < DATE '2026-01-01' OR v_date > DATE '2026-09-30' THEN
      RAISE EXCEPTION 'entry_%_date_outside_import_window: %', v_index, v_date USING ERRCODE = 'P0001';
    END IF;
    IF v_desc IS NULL OR length(trim(v_desc)) < 3 THEN
      RAISE EXCEPTION 'entry_%_description_required', v_index USING ERRCODE = 'P0001';
    END IF;
    -- jsonb_typeof(NULL) est NULL : sans IS DISTINCT FROM, une écriture sans
    -- `lines` passerait la garde et serait postée vide.
    IF jsonb_typeof(v_entry->'lines') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_entry->'lines') < 2 THEN
      RAISE EXCEPTION 'entry_%_minimum_2_lines', v_index USING ERRCODE = 'P0001';
    END IF;
    PERFORM check_fiscal_period_open(v_date);

    v_sum_dr := 0; v_sum_cr := 0;
    FOR v_line IN SELECT * FROM jsonb_array_elements(v_entry->'lines') LOOP
      -- Un nombre JSON (jamais une chaîne, donc ni 'NaN' ni texte), deux
      -- décimales au plus (aucun arrondi silencieux), sous la borne des colonnes.
      IF jsonb_typeof(v_line->'debit') NOT IN ('number','null')
         OR jsonb_typeof(v_line->'credit') NOT IN ('number','null') THEN
        RAISE EXCEPTION 'entry_%_amount_must_be_a_number', v_index USING ERRCODE = 'P0001';
      END IF;
      v_dr := COALESCE((v_line->>'debit')::numeric, 0);
      v_cr := COALESCE((v_line->>'credit')::numeric, 0);
      IF v_dr <> round(v_dr, 2) OR v_cr <> round(v_cr, 2)
         OR v_dr >= 10000000000 OR v_cr >= 10000000000 THEN
        RAISE EXCEPTION 'entry_%_amount_out_of_range', v_index USING ERRCODE = 'P0001';
      END IF;
      IF v_dr < 0 OR v_cr < 0 OR (v_dr > 0) = (v_cr > 0) THEN
        RAISE EXCEPTION 'entry_%_line_must_be_debit_xor_credit', v_index USING ERRCODE = 'P0001';
      END IF;
      SELECT id, is_active, is_postable INTO v_acc FROM accounts WHERE code = v_line->>'account';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'entry_%_account_not_found: %', v_index, v_line->>'account' USING ERRCODE = 'P0002';
      END IF;
      IF NOT v_acc.is_active OR NOT v_acc.is_postable THEN
        RAISE EXCEPTION 'entry_%_account_not_postable: %', v_index, v_line->>'account' USING ERRCODE = 'P0003';
      END IF;
      v_sum_dr := v_sum_dr + v_dr;
      v_sum_cr := v_sum_cr + v_cr;
    END LOOP;

    IF v_sum_dr <> v_sum_cr THEN
      RAISE EXCEPTION 'entry_%_unbalanced: % vs %', v_index, v_sum_dr, v_sum_cr USING ERRCODE = 'P0001';
    END IF;
    IF v_sum_dr >= 10000000000 THEN
      RAISE EXCEPTION 'entry_%_amount_out_of_range', v_index USING ERRCODE = 'P0001';
    END IF;
    v_all_dr := v_all_dr + v_sum_dr;
    v_summary := v_summary || jsonb_build_object(
      'date', v_date, 'description', v_desc,
      'lines', jsonb_array_length(v_entry->'lines'), 'total', v_sum_dr);
  END LOOP;

  IF p_dry_run THEN
    RETURN jsonb_build_object('dry_run', true, 'posted', false,
                              'entries', v_summary, 'total_debit', v_all_dr);
  END IF;

  -- 2. Écrire, dans l'ordre reçu.
  v_index := 0;
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries) LOOP
    v_index := v_index + 1;
    v_date := (v_entry->>'date')::date;
    v_entry_no := next_journal_entry_number(v_date);
    SELECT COALESCE(SUM(COALESCE((l->>'debit')::numeric(14,2), 0)), 0)
      INTO v_sum_dr FROM jsonb_array_elements(v_entry->'lines') l;

    INSERT INTO journal_entries (
      entry_number, entry_date, description, reference_type, reference_id,
      status, total_debit, total_credit, created_by, metadata
    ) VALUES (
      v_entry_no, v_date, v_entry->>'description', 'manual', NULL,
      'posted', v_sum_dr, v_sum_dr, p_actor,
      jsonb_build_object('kind', c_kind, 'sequence', v_index,
                         'source', COALESCE(v_entry->>'source', 'bank-based books'))
    ) RETURNING id INTO v_je_id;

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    SELECT v_je_id, a.id,
           COALESCE((l->>'debit')::numeric(14,2), 0),
           COALESCE((l->>'credit')::numeric(14,2), 0),
           COALESCE(l->>'description', v_entry->>'description')
      FROM jsonb_array_elements(v_entry->'lines') l
      JOIN accounts a ON a.code = l->>'account';

    v_posted := v_posted || jsonb_build_object('entry_number', v_entry_no, 'date', v_date, 'total', v_sum_dr);
  END LOOP;

  INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)
  VALUES ('accounting.bank_books_import.posted', 'journal_entries', v_je_id,
          jsonb_build_object('kind', c_kind, 'entries', v_posted, 'total_debit', v_all_dr),
          p_actor);

  RETURN jsonb_build_object('dry_run', false, 'posted', true,
                            'entries', v_posted, 'total_debit', v_all_dr);
END;
$function$;

REVOKE ALL ON FUNCTION public.post_bank_books_import_v1(jsonb, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_bank_books_import_v1(jsonb, boolean, uuid) TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.post_bank_books_import_v1(jsonb, boolean, uuid) IS
  'One-shot import of the 2026 bank-based books (opening balance + monthly summaries). service_role only; dry run by default.';
