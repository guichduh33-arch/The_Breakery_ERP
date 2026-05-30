-- Audit corrective (post-S33, 2026-05-31) — stock-management skill audit finding C.2
--
-- refresh_mv_stock_variance() is SECURITY DEFINER and was EXECUTE-able by `authenticated`,
-- letting any signed-in user force a materialized-view refresh (cheap DoS / cost amplifier).
-- It has NO application caller (grep: only types.generated.ts) — it is driven solely by the
-- pg_cron job `refresh-mv-stock-variance` (*/15), which runs as `postgres` (function owner)
-- and is therefore unaffected by EXECUTE revocation.
--
-- Fix: REVOKE EXECUTE from authenticated + PUBLIC + anon (REVOKE FROM anon alone is
-- insufficient — anon inherits via PUBLIC; see CLAUDE.md "Anon GRANT defense-in-depth").

REVOKE EXECUTE ON FUNCTION public.refresh_mv_stock_variance() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_mv_stock_variance() FROM anon;
REVOKE EXECUTE ON FUNCTION public.refresh_mv_stock_variance() FROM PUBLIC;
