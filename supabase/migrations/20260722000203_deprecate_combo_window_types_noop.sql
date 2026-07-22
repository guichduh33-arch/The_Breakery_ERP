-- ADR-007 décision 3 — la fenêtre horaire des combos est supprimée.
--
-- Les colonnes combo_available_from/combo_available_to étaient écrites par le
-- formulaire combo mais jamais lues par aucun code (fonctionnalité fantôme).
-- Le besoin happy-hour est couvert par les promotions (ADR-006 déc. 10,
-- evaluate_promotions_v2). Les champs sont retirés du formulaire BO ; les
-- colonnes restent en place, dépréciées (pas de DROP : upsert_combo_v1 les
-- écrit encore — à retirer au prochain bump fonctionnel de cette RPC).
--
-- [types-noop] : commentaires uniquement, aucun changement de schéma.

COMMENT ON COLUMN public.products.combo_available_from IS
  'DEPRECATED (ADR-007 déc. 3, 2026-07-22) : fenêtre horaire combo jamais lue. Le mécanisme horaire est le système de promotions. Ne plus écrire ; DROP au prochain bump d''upsert_combo.';
COMMENT ON COLUMN public.products.combo_available_to IS
  'DEPRECATED (ADR-007 déc. 3, 2026-07-22) : fenêtre horaire combo jamais lue. Le mécanisme horaire est le système de promotions. Ne plus écrire ; DROP au prochain bump d''upsert_combo.';
