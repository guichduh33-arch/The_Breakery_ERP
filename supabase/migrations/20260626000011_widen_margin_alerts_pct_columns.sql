-- 20260626000011_widen_margin_alerts_pct_columns.sql
-- Audit 2026-06-12 C3 : recompute-recipe-margins-daily échoue chaque jour
-- (numeric overflow 5,2) depuis ~2026-05-17 — Margin Watch figé. La fonction
-- calcule en DECIMAL(7,2) : on aligne les colonnes. delta_pct (6,2) est
-- élargi aussi (même UPDATE, même formule expected − target → l'overflow se
-- déplacerait juste de colonne sinon).
ALTER TABLE public.margin_alerts
  ALTER COLUMN expected_margin_pct TYPE NUMERIC(7,2),
  ALTER COLUMN target_margin_pct   TYPE NUMERIC(7,2),
  ALTER COLUMN delta_pct           TYPE NUMERIC(7,2);
