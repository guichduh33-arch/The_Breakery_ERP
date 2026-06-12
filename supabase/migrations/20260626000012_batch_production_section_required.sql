-- 20260626000012_batch_production_section_required.sql
-- Audit 2026-06-12 C4 : sans section, record_batch_production_v1 et
-- record_production_v1 violaient chk_stock_movements_section_required
-- (23514 → 'Error: unknown' à l'écran). Gate explicite 'section_required'
-- (P0001), signatures inchangées — pattern corrective S38 : DO-block
-- pg_get_functiondef + replace, ACL conservées par CREATE OR REPLACE.

-- 1. record_batch_production_v1 : garde juste après le parse de section_id,
--    avant le replay idempotent (style existant : validation d'enveloppe d'abord).
DO $do$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_functiondef('public.record_batch_production_v1'::regproc) INTO v_def;
  IF position('section_required' in v_def) > 0 THEN
    RETURN;  -- déjà appliqué (idempotent)
  END IF;
  v_def := replace(v_def,
$anchor$  IF (p_batch->>'idempotency_key') IS NOT NULL AND length(p_batch->>'idempotency_key') > 0 THEN$anchor$,
$new$  IF v_section_id IS NULL THEN
    RAISE EXCEPTION 'section_required' USING ERRCODE = 'P0001',
      HINT = 'production movements require a section (chk_stock_movements_section_required)';
  END IF;

  IF (p_batch->>'idempotency_key') IS NOT NULL AND length(p_batch->>'idempotency_key') > 0 THEN$new$);
  EXECUTE v_def;
END $do$;

-- 2. record_production_v1 : même garde, juste après le gate permission.
DO $do$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_functiondef('public.record_production_v1'::regproc) INTO v_def;
  IF position('section_required' in v_def) > 0 THEN
    RETURN;  -- déjà appliqué (idempotent)
  END IF;
  v_def := replace(v_def,
$anchor$  IF p_quantity_produced IS NULL OR p_quantity_produced <= 0 THEN$anchor$,
$new$  IF p_section_id IS NULL THEN
    RAISE EXCEPTION 'section_required' USING ERRCODE = 'P0001',
      HINT = 'production movements require a section (chk_stock_movements_section_required)';
  END IF;

  IF p_quantity_produced IS NULL OR p_quantity_produced <= 0 THEN$new$);
  EXECUTE v_def;
END $do$;
