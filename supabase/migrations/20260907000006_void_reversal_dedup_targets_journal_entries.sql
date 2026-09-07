-- Audit lot 2, P0-4 — toute contre-passation de void était exclue des états
-- financiers ; le CA et la PB1 d'une vente annulée n'étaient jamais repris.
--
-- LE DÉFAUT. ONZE occurrences, dans six fonctions, du même prédicat. Le relevé
-- d'audit en annonçait dix ; l'assertion de cette migration a refusé de passer et
-- le recomptage donne 4 (`get_general_ledger`) + 2 (`get_balance_sheet`) +
-- 2 (`close_fiscal_year`) + 1 + 1 + 1 = 11 :
--     AND NOT (je.reference_type = 'sale_void'
--              AND EXISTS (SELECT 1 FROM refunds rf WHERE rf.order_id = je.reference_id))
-- Il croit supprimer un DOUBLON. Il supprime en réalité TOUJOURS l'unique
-- contre-passation. Chaîne prouvée maillon par maillon sur les corps live :
--   1. `void_order_rpc_v11` insère TOUJOURS une ligne `refunds(is_full_void = true)`
--      pour chaque void — la valeur est en dur dans son INSERT ;
--   2. `fn_create_je_for_refund` sort immédiatement sur
--      `IF NEW.is_full_void THEN RETURN NEW` (ADR-013 déc. 2) : ce miroir
--      n'émet donc AUCUNE écriture `sale_refund` ;
--   3. `create_sale_journal_entry` émet la seule contre-passation, en `sale_void` ;
--   4. `void_order_rpc_v11` interdit le void après un refund partiel (ADR-013 déc. 1).
-- Donc `EXISTS (refunds …)` est TOUJOURS vrai face à un `sale_void`, et jamais
-- pour la raison qu'il croit.
--
-- CONSÉQUENCE. Une vente annulée reste dans le P&L, le bilan, la balance, le
-- grand livre et la clôture annuelle : CA surévalué, **PB1 surdéclarée au
-- Bapenda** (on paie l'impôt sur une vente annulée), caisse surévaluée, et
-- `close_fiscal_year` reporte ce résultat gonflé en 3200. Le bilan reste
-- `balanced = true` — l'écriture exclue est équilibrée en elle-même — donc la
-- panne est SILENCIEUSE.
--
-- LE CORRECTIF (arbitrage Mamat, 2026-09-07). On ne supprime pas le prédicat :
-- on le vise sur ce qui le concerne vraiment. Le doublon à éviter, ce sont deux
-- ÉCRITURES pour la même annulation, pas l'existence d'une ligne `refunds`. Le
-- prédicat cherche donc désormais une écriture `sale_refund` rattachée à la même
-- commande (via `refunds.id`, cible réelle de son `reference_id`). Correct
-- aujourd'hui, ET toujours correct si l'ADR-013 déc. 2 change un jour.
--
-- Effet de bord évité : le prédicat d'origine faisait dépendre un P&L HISTORIQUE
-- de l'état PRÉSENT d'une table métier — supprimer une ligne `refunds` réécrivait
-- rétroactivement les états financiers.
--
-- AUCUNE reprise d'historique : la base porte 0 écriture `sale_void`, 0 ligne
-- `refunds` et 0 clôture annuelle. Le défaut est prouvé par le code, pas par un
-- écart mesurable.
--
-- LE TEST QUI COUVRAIT ÇA EST VERT SUR UN MONDE MORT :
-- `supabase/tests/pb1_dedup_void_refund.test.sql` T2 fabrique à la main un état
-- (`sale` + `sale_void` + `sale_refund` + `refunds(is_full_void=true)` sur la
-- même commande) qu'aucun émetteur live ne peut produire depuis ADR-013 déc. 2.
--
-- Versioning monotone : sept bumps, anciennes DROPées ici même. `get_pb1_report`
-- ne porte pas le prédicat mais appelle `calculate_pb1_payable` : il suit.

DO $mig$
DECLARE
  v_pairs   TEXT[][] := ARRAY[
    ['calculate_pb1_payable_v2', 'calculate_pb1_payable_v3'],
    ['close_fiscal_year_v1',     'close_fiscal_year_v2'],
    ['get_balance_sheet_v2',     'get_balance_sheet_v3'],
    ['get_general_ledger_v2',    'get_general_ledger_v3'],
    ['get_profit_loss_v2',       'get_profit_loss_v3'],
    ['get_trial_balance_v3',     'get_trial_balance_v4'],
    ['get_pb1_report_v2',        'get_pb1_report_v3']
  ];
  v_old_pred TEXT := 'AND EXISTS (SELECT 1 FROM refunds rf WHERE rf.order_id = je.reference_id)';
  v_new_pred TEXT := 'AND EXISTS (SELECT 1 FROM journal_entries jr JOIN refunds rf ON rf.id = jr.reference_id WHERE jr.reference_type = ''sale_refund'' AND rf.order_id = je.reference_id)';
  v_src      TEXT;
  v_i        INT;
  v_j        INT;
  v_n        INT;
  v_total    INT := 0;
BEGIN
  FOR v_i IN 1 .. array_length(v_pairs, 1) LOOP
    v_src := pg_get_functiondef(('public.' || v_pairs[v_i][1])::regproc);

    -- Substitution COMPTEE du predicat (indentation-agnostique : seul le coeur
    -- invariant est cible, les six fonctions l'indentent differemment).
    v_n := (length(v_src) - length(replace(v_src, v_old_pred, ''))) / length(v_old_pred);
    v_total := v_total + v_n;
    v_src := replace(v_src, v_old_pred, v_new_pred);

    -- Renommage de TOUTES les cibles dans CHAQUE corps : c'est ce qui recable
    -- get_pb1_report -> calculate_pb1_payable sans edition manuelle.
    FOR v_j IN 1 .. array_length(v_pairs, 1) LOOP
      v_src := replace(v_src, v_pairs[v_j][1], v_pairs[v_j][2]);
    END LOOP;

    EXECUTE v_src;
  END LOOP;

  -- Onze occurrences recomptees sur les corps live (le releve d'audit disait dix).
  -- Si le compte change,
  -- c'est que le corps live a bouge depuis : on refuse plutot que de deviner.
  IF v_total <> 11 THEN
    RAISE EXCEPTION 'predicat sale_void remplace % fois (attendu 11) — corps live different du releve', v_total;
  END IF;
END $mig$;

-- Posture de grants : une fonction neuve nait ouverte a `authenticated` via les
-- DEFAULT PRIVILEGES du projet. On repose explicitement le refus de PUBLIC/anon.
DO $grants$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('calculate_pb1_payable_v3','close_fiscal_year_v2','get_balance_sheet_v3',
                        'get_general_ledger_v3','get_profit_loss_v3','get_trial_balance_v4',
                        'get_pb1_report_v3')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon',   r.sig);
  END LOOP;
END $grants$;

-- DROP des anciennes. Les signatures sont RELEVEES sur pg_proc, jamais devinees :
-- un DROP a signature fausse est un no-op SILENCIEUX (cf. get_stock_movements_v1,
-- qui a survecu a son propre DROP en juin et sert encore le back-office).
DO $drops$
DECLARE r RECORD; v_n INT := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('calculate_pb1_payable_v2','close_fiscal_year_v1','get_balance_sheet_v2',
                        'get_general_ledger_v2','get_profit_loss_v2','get_trial_balance_v3',
                        'get_pb1_report_v2')
  LOOP
    EXECUTE format('DROP FUNCTION %s', r.sig);
    v_n := v_n + 1;
  END LOOP;
  IF v_n <> 7 THEN
    RAISE EXCEPTION 'DROP : % anciennes supprimees (attendu 7)', v_n;
  END IF;
END $drops$;

COMMENT ON FUNCTION public.get_profit_loss_v3 IS
  'P&L. v3 : la dedup sale_void cible desormais une ECRITURE sale_refund de la meme commande, plus l''existence d''une ligne refunds — qui excluait TOUJOURS la contre-passation (audit lot 2 P0-4).';
