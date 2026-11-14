-- S1-04 — l'enregistrement unique de réglages B2B existe, et sa réinsertion
-- n'écrase rien. Transaction annulée.
BEGIN;
SELECT plan(5);

SELECT is((SELECT count(*)::int FROM public.b2b_settings), 1,
  'b2b_settings porte exactement une ligne');
SELECT is((SELECT id::int FROM public.b2b_settings), 1,
  'la ligne unique est id = 1');

-- Le geste de la migration est sans effet sur une ligne présente.
UPDATE public.b2b_settings SET critical_overdue_days = 45 WHERE id = 1;
INSERT INTO public.b2b_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
SELECT is((SELECT critical_overdue_days FROM public.b2b_settings WHERE id = 1), 45,
  'la réinsertion ne remet pas un réglage saisi à sa valeur par défaut');

-- Sur une table vide (l'état relevé en production), le geste rend les défauts.
DELETE FROM public.b2b_settings;
INSERT INTO public.b2b_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
SELECT is((SELECT default_payment_terms FROM public.b2b_settings WHERE id = 1), 'net_30',
  'table vide : la ligne revient avec le délai de paiement par défaut');
SELECT is((SELECT jsonb_array_length(aging_buckets) FROM public.b2b_settings WHERE id = 1), 3,
  'table vide : la ligne revient avec les trois tranches par défaut');

SELECT * FROM finish();
ROLLBACK;
