-- 20260717000181_adr009_d1_d2_drop_direct_update_paths_orders.sql
-- ADR-009 déc. 1 & 2 — fermeture des deux chemins d'écriture directe hors RPC
-- sur orders / order_items (audit Orders 2026-07-17).
--
-- D1 🔴 : la policy kds_update_kitchen_status (20260505000003) autorisait tout
--   utilisateur authentifié à UPDATE n'importe quelle colonne (unit_price,
--   quantity, name_snapshot…) de toute ligne is_locked=true — y compris sur
--   commande payée. Le KDS n'émet aucun UPDATE direct : toutes les transitions
--   (bump/undo/recall/serve/prep-timer) passent par des RPCs SECURITY DEFINER
--   gatées kds.operate. Fix = DROP policy + REVOKE UPDATE table (défense en
--   profondeur : vérifié live 2026-07-17, les 31 RPCs écrivaines du domaine
--   sont toutes prosecdef=true, aucune n'a besoin du privilège invoker).
--
-- D2 🔴 : la policy perm_update (20260503000007) permettait à tout porteur de
--   pos.sale.update (MANAGER+) de modifier status/total/discount de n'importe
--   quelle commande via PostgREST — hors RPC, sans PIN, sans audit_logs.
--   Aucun code ne l'utilise. Fix = DROP policy (aucune policy UPDATE ne
--   subsiste sur orders ; RLS bloque désormais tout UPDATE client).
--
-- Périmètre strict ADR-009 : les grants INSERT/DELETE/TRUNCATE d'authenticated
-- sur ces tables (inertes sous RLS sans policy) ne sont PAS touchés ici.

-- ── D1 : order_items ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "kds_update_kitchen_status" ON public.order_items;
REVOKE UPDATE ON public.order_items FROM authenticated;

-- ── D2 : orders ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "perm_update" ON public.orders;

COMMENT ON TABLE public.order_items IS
  'Lignes de commande. Écriture exclusivement via RPCs SECURITY DEFINER (ADR-009 déc. 1 : policy KDS UPDATE supprimée + REVOKE UPDATE authenticated).';
COMMENT ON TABLE public.orders IS
  'Commandes. Écriture exclusivement via RPCs SECURITY DEFINER (ADR-009 déc. 2 : policy perm_update supprimée).';
