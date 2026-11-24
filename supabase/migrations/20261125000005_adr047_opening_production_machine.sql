-- ADR-047 décision 7 — Reprise de la machine de production déjà au bilan.
--
-- Relevé en production le 2026-11-25 : 28 791 300 IDR au 1610 depuis le bilan
-- d'ouverture du 2026-01-01, 7 197 825 IDR d'amortissements cumulés au 1690 au
-- 2026-09-30 (trois mois dans l'ouverture, neuf dotations mensuelles importées).
-- Mise en service en octobre 2025, groupe 1 (48 mois). La dotation automatique
-- la reprend à octobre 2026 ; les comptes déjà passés ne changent pas.
--
-- Choix techniques :
-- * Gardée par les faits : la fiche n'est créée que si les soldes 1610 et 1690
--   valent exactement ces montants, qu'aucun amortissement n'est passé au 1690
--   après le 2026-09-30 et que le registre ne connaît encore aucune fiche
--   d'ouverture. Sinon la migration ne fait rien et le dit (NOTICE) : après
--   publication, vérifier que le registre porte la machine. Aucun identifiant
--   généré n'est écrit en dur.
-- * Aucune écriture comptable : l'achat et les dotations passées sont déjà
--   dans les comptes. La fiche porte le cumul à sa date (origin 'opening').
-- * Pas d'acteur : la migration n'a pas d'utilisateur. Une trace d'audit
--   fixed_asset.opening_reprise suit fixed_asset.created et nomme sa source.

DO $reprise$
DECLARE
  v_machine numeric;
  v_accum   numeric;
  v_later   numeric;
  v_id      uuid;
BEGIN
  -- Mêmes statuts que les états financiers : posted et locked.
  SELECT COALESCE(sum(l.debit - l.credit), 0) INTO v_machine
    FROM journal_entry_lines l
    JOIN journal_entries j ON j.id = l.journal_entry_id
    JOIN accounts a ON a.id = l.account_id
   WHERE a.code = '1610' AND j.status IN ('posted', 'locked');
  SELECT COALESCE(sum(l.credit - l.debit) FILTER (WHERE j.entry_date <= DATE '2026-09-30'), 0),
         COALESCE(sum(l.credit - l.debit) FILTER (WHERE j.entry_date >  DATE '2026-09-30'), 0)
    INTO v_accum, v_later
    FROM journal_entry_lines l
    JOIN journal_entries j ON j.id = l.journal_entry_id
    JOIN accounts a ON a.id = l.account_id
   WHERE a.code = '1690' AND j.status IN ('posted', 'locked');

  -- Une dotation déjà passée après septembre (par exemple un import bancaire
  -- d'octobre) serait doublée par le passage automatique : pas de reprise.
  IF v_machine <> 28791300 OR v_accum <> 7197825 OR v_later <> 0
     OR EXISTS (SELECT 1 FROM fixed_assets WHERE origin = 'opening') THEN
    RAISE NOTICE 'ADR-047 reprise skipped: 1610 = %, 1690 at 2026-09-30 = %, 1690 after = %, opening assets = %',
      v_machine, v_accum, v_later, (SELECT count(*) FROM fixed_assets WHERE origin = 'opening');
    RETURN;
  END IF;

  v_id := _insert_fixed_asset_v1(
    'Production machine (opening balance)', 'production_machine', 'group_1',
    DATE '2025-10-01', 28791300, 'opening', NULL, NULL, 7197825, DATE '2026-09-30',
    NULL, NULL);

  -- audit_logs est append-only : la source s'ajoute par une ligne de plus.
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (NULL, 'fixed_asset.opening_reprise', 'fixed_asset', v_id, jsonb_build_object(
    'source', 'migration 20261125000005 (ADR-047 decision 7)',
    'balance_1610', v_machine, 'accumulated_1690_at_2026_09_30', v_accum));

  RAISE NOTICE 'ADR-047 reprise: production machine registered (%).', v_id;
END
$reprise$;
