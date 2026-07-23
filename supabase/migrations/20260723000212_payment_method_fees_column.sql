-- 20260723000212_payment_method_fees_column.sql
-- ADR-006 déc. 9 (lot C) — frais par méthode de paiement, INFORMATIF seulement
-- (arbitrage Mamat 2026-07-23 : pas de JE automatique, net estimé en rapport).
-- Forme : objet { "<method>": <percent> } — pourcentage seul (arbitrage lot C),
-- clés ∈ enum payment_method, valeurs [0, 100]. Validation forte dans
-- set_setting_v7 (_213) ; le CHECK table garde uniquement le type object
-- (defense-in-depth contre un UPDATE direct hors RPC).

ALTER TABLE public.business_config
  ADD COLUMN payment_method_fees JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.business_config
  ADD CONSTRAINT business_config_payment_method_fees_is_object
  CHECK (jsonb_typeof(payment_method_fees) = 'object');

COMMENT ON COLUMN public.business_config.payment_method_fees IS
  'Informational processing-fee percentages per payment method, e.g. '
  '{"qris": 0.7, "gopay": 2}. Written via set_setting_v7 only. No automatic '
  'journal entry — used for net estimates in the Payments by Method report '
  '(ADR-006 dec. 9, lot C).';
