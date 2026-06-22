-- 20260706000016_soft_delete_duplicate_station_pastry.sql
--
-- Cleanup of a duplicate production "station". The seed in
-- 20260706000014_seed_production_stations.sql inserted STN_PASTRY ("Pastry"),
-- but an active legacy production section already covers Pastry under code
-- PASTRY (which carries real stock_movements + section_stock). That left two
-- "Pastry" rows in the Sections list — a duplicate.
--
-- Resolution: keep the legacy PASTRY (it owns the data) and retire the empty
-- STN_PASTRY. Soft-delete only (is_active=false + deleted_at) so any future FK
-- reference stays intact; the row simply stops appearing in pickers and the
-- Sections management list. Guarded so we never retire a station that has
-- actually accrued data.
--
-- Idempotent: re-applying is a no-op once the row is already retired.

UPDATE public.sections s
SET is_active  = false,
    deleted_at = COALESCE(s.deleted_at, now())
WHERE s.code = 'STN_PASTRY'
  AND s.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.stock_movements m WHERE m.from_section_id = s.id OR m.to_section_id = s.id)
  AND NOT EXISTS (SELECT 1 FROM public.section_stock ss WHERE ss.section_id = s.id)
  AND NOT EXISTS (SELECT 1 FROM public.product_sections ps WHERE ps.section_id = s.id);
