-- 20260710000121_shift_three_way_denominations_columns.sql
-- S67 (fiche 12 D2.2/D2.3) — colonnes support du comptage 3 volets et de la
-- grille de coupures :
--   business_config.shift_denomination_count_enabled : opt-in B2.5 (défaut OFF).
--   pos_sessions.counted_qris / counted_card : totaux relevés des terminaux à
--     la clôture (NULL = volet non compté — méthode désactivée S64).
--   pos_sessions.opening_denominations / closing_denominations : grille
--     {"100000": 3, ...} (clé = valeur faciale IDR, valeur = quantité).
-- Aucune JE nouvelle (décision propriétaire : écart non-cash = trace + gardes).

ALTER TABLE public.business_config
  ADD COLUMN IF NOT EXISTS shift_denomination_count_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.pos_sessions
  ADD COLUMN IF NOT EXISTS counted_qris NUMERIC,
  ADD COLUMN IF NOT EXISTS counted_card NUMERIC,
  ADD COLUMN IF NOT EXISTS opening_denominations JSONB,
  ADD COLUMN IF NOT EXISTS closing_denominations JSONB;

ALTER TABLE public.pos_sessions
  ADD CONSTRAINT pos_sessions_counted_qris_nonneg CHECK (counted_qris IS NULL OR counted_qris >= 0),
  ADD CONSTRAINT pos_sessions_counted_card_nonneg CHECK (counted_card IS NULL OR counted_card >= 0);

COMMENT ON COLUMN public.business_config.shift_denomination_count_enabled IS
  'S67 (12 D2.3/B2.5): when TRUE the POS requires the cash count (open & close) to go through the IDR denomination grid; close_shift_v5 enforces it (denominations_required).';
COMMENT ON COLUMN public.pos_sessions.counted_qris IS
  'S67 (12 D2.2): QRIS total read from the payment terminal at close. NULL = volet not counted.';
COMMENT ON COLUMN public.pos_sessions.counted_card IS
  'S67 (12 D2.2): card+EDC total read from the terminal at close (merged volet). NULL = volet not counted.';
COMMENT ON COLUMN public.pos_sessions.opening_denominations IS
  'S67 (12 D2.3): opening-cash denomination grid {"100000": 3, ...} (client-side only — no open RPC).';
COMMENT ON COLUMN public.pos_sessions.closing_denominations IS
  'S67 (12 D2.3): closing-cash denomination grid, validated by close_shift_v5 (sum must equal p_counted_cash).';
