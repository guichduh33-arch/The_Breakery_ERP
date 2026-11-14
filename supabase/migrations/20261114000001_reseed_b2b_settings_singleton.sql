-- S1-04 — Réinsérer l'enregistrement unique de réglages B2B.
--
-- `b2b_settings` est une table à enregistrement unique (`CHECK (id = 1)`),
-- semée par `20260623000010_create_b2b_settings_table.sql`. La famille
-- `get_b2b_settings` lève `P0002` quand la ligne manque : la page de réglages
-- B2B du back-office tombe alors en erreur à chaque ouverture.
--
-- Relevé du 2026-11-14, lecture seule : la production porte 0 ligne, le dev 1.
-- L'autre table à enregistrement unique du schéma, `business_config`, porte
-- bien sa ligne sur les deux bases.
--
-- Geste : réinsérer la ligne avec les valeurs par défaut des colonnes, celles
-- du dépôt. Sans effet là où la ligne existe déjà (dev) : aucun réglage saisi
-- n'est écrasé.
INSERT INTO public.b2b_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- Garde : la migration ne se termine pas sur une table encore vide.
DO $guard$
BEGIN
  IF (SELECT count(*) FROM public.b2b_settings WHERE id = 1) <> 1 THEN
    RAISE EXCEPTION 'b2b_settings_singleton_missing: reseed did not produce the row';
  END IF;
END $guard$;
