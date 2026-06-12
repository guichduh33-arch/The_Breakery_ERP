-- 20260626000016_revoke_extra_privileges_stock_tables.sql
-- Audit 2026-06-12 m1 : authenticated détenait TRUNCATE/TRIGGER/REFERENCES sur
-- stock_movements. TRUNCATE n'est pas filtré par RLS. Non exploitable via
-- PostgREST, mais contraire à la doctrine REVOKE-all S20 — defense in depth.
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.stock_movements   FROM authenticated, anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.stock_lots        FROM authenticated, anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.section_stock     FROM authenticated, anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.display_stock     FROM authenticated, anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.display_movements FROM authenticated, anon;
