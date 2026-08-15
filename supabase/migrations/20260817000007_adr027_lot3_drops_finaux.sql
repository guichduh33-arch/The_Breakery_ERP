-- 20260817000007_adr027_lot3_drops_finaux.sql
--
-- ADR-027 lot 3/3 (4/4) — drops finaux, une fois tous les lecteurs re-câblés.
--
-- * section_stock : cache dérivé recalculable (documenté tel quel à sa création),
--   plus aucun lecteur ni écrivain après 20260817000001..000006.
-- * internal_transfers / transfer_items : arbitrage propriétaire 2 de l'ADR-027 —
--   perte de l'historique de transfert ASSUMÉE. Les mouvements transfer_in/out
--   du ledger restent (append-only), leurs reference_id deviennent des
--   références mortes.
-- * stock_locations : inutilisée par les RPCs vivantes. stock_lots.location_id
--   (infra dormante ADR-004) perd sa FK — la colonne et ses valeurs historiques
--   restent, sans contrainte référentielle.
-- * stock_reservations.section_id : nullable, sans gate — colonne droppée.
-- * sections hors production : soft-delete. Le hard delete est impossible (le
--   ledger historique les référence, FK RESTRICT) et n'est pas souhaité — la
--   table survit comme registre des stations de production.

DROP VIEW IF EXISTS public.view_section_stock_details;

DROP TABLE IF EXISTS public.section_stock;

ALTER TABLE public.stock_lots DROP CONSTRAINT IF EXISTS stock_lots_location_id_fkey;
DROP TABLE IF EXISTS public.stock_locations;

DROP TABLE IF EXISTS public.transfer_items;
DROP TABLE IF EXISTS public.internal_transfers;

ALTER TABLE public.stock_reservations DROP COLUMN IF EXISTS section_id;

UPDATE public.sections
   SET deleted_at = now(), is_active = false
 WHERE kind <> 'production'
   AND deleted_at IS NULL;
