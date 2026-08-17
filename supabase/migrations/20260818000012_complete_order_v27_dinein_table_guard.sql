-- 20260818000012_complete_order_v27_dinein_table_guard.sql
-- Fiche02-D2.5 — table OBLIGATOIRE en dine-in : le checkout direct
-- (EF process-payment → complete_order_with_payment) était la DERNIÈRE porte de
-- création sans filet serveur (fire_counter_order et create_tablet_order gardent
-- depuis _122/_144 du 2026-07-10). Relevé du 2026-08-18 sur dev : 20 commandes
-- dine_in sans table créées entre le 2026-08-11 et le 2026-08-17 par cette porte
-- (trafic de test vitest-live/E2E) — la fuite était active.
--
-- v27 = v26 (corps live pg_get_functiondef, transformé PAR LA BASE ci-dessous —
-- jamais de recopie manuelle d'un money-path de ~940 lignes) + garde P0011
-- 'table_required_for_dine_in', insérée APRÈS le court-circuit d'idempotence :
-- le replay d'une commande existante reste servi sans re-garde, même design que
-- fire_counter_order (_122). Substitutions COMPTÉES : la migration échoue si le
-- corps live ne présente pas exactement les ancres attendues.

DO $mig$
DECLARE
  v_def    text;
  v_guard  text;
  v_anchor text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO STRICT v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'complete_order_with_payment_v26';

  v_anchor := $a$
  -- Numérotation par origine : validé après le replay$a$;

  v_guard := $g$
  -- Fiche02-D2.5 (1) : table obligatoire à la CRÉATION d'une commande dine-in.
  -- L'UI POS garde en amont (useDineInTableGuard) ; ceci est le filet serveur,
  -- placé APRÈS le replay d'idempotence (un replay legacy sans table reste servi).
  IF p_order_type = 'dine_in' AND (p_table_number IS NULL OR btrim(p_table_number) = '') THEN
    RAISE EXCEPTION 'table_required_for_dine_in' USING ERRCODE = 'P0011';
  END IF;
$g$;

  -- Substitutions comptées — 1 occurrence exigée pour chaque ancre.
  IF (length(v_def) - length(replace(v_def, 'complete_order_with_payment_v26', '')))
       / length('complete_order_with_payment_v26') <> 1 THEN
    RAISE EXCEPTION 'v27 bump: nom v26 attendu 1 fois dans le corps live';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'v27 bump: ancre replay-idempotence attendue 1 fois';
  END IF;
  IF position('table_required_for_dine_in' in v_def) > 0 THEN
    RAISE EXCEPTION 'v27 bump: la garde existe déjà dans le corps live';
  END IF;

  v_def := replace(v_def, 'complete_order_with_payment_v26', 'complete_order_with_payment_v27');
  v_def := replace(v_def, v_anchor, v_guard || v_anchor);
  EXECUTE v_def;
END $mig$;

DROP FUNCTION public.complete_order_with_payment_v26(uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, uuid, text);

REVOKE ALL ON FUNCTION public.complete_order_with_payment_v27(uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_order_with_payment_v27(uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_order_with_payment_v27(uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, uuid, text) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.complete_order_with_payment_v27(uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, uuid, text) IS
  'v27 = v26 + garde table_required_for_dine_in (P0011) à la création dine-in, après le replay d''idempotence (Fiche02-D2.5 — dernière porte de création alignée sur fire_counter_order/create_tablet_order). Aucun autre changement de comportement.';
