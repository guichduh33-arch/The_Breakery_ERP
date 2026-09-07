-- 20260908000001_revoke_truncate_stock_domain_tables.sql
--
-- Finding F3 de docs/audits/2026-08-31-audit-stock-management.md (P1, dimension C).
--
-- Défaut corrigé : le correctif m1 de l'audit 2026-06-12
-- (20260626000016_revoke_extra_privileges_stock_tables.sql) a retiré
-- TRUNCATE / TRIGGER / REFERENCES à `authenticated` et `anon` sur les seules tables du
-- ledger. Les tables ADJACENTES du domaine stock ne l'ont jamais reçu. `authenticated`
-- conserve donc TRUNCATE sur seize d'entre elles.
--
-- Pourquoi TRUNCATE est le privilège à retirer en priorité : il n'est PAS filtré par la
-- RLS. Une table dont la seule policy est un SELECT reste videable par tout porteur du
-- rôle `authenticated`. `units` et `unit_conversions` sont la colonne vertébrale de
-- convert_quantity : les vider casse toute déduction de recette, silencieusement.
--
-- Exposition pratique aujourd'hui : PostgREST n'émet jamais de TRUNCATE, donc c'est de
-- la defense-in-depth. C'est exactement le raisonnement que m1 a déjà refusé une fois.
--
-- Second volet : les GRANT de DML qu'aucune policy ne légitime. Ils sont déjà inertes
-- (la RLS les bloque), mais ils décrivent une intention fausse et survivraient à l'ajout
-- d'une policy trop large. Relevé des policies vivantes le 2026-09-07 :
--   · units, unit_conversions ....... SELECT seul       → REVOKE INSERT, UPDATE, DELETE
--   · products ...................... INSERT/SELECT/UPDATE → REVOKE DELETE
--   · margin_alerts ................. SELECT/UPDATE      → REVOKE INSERT, DELETE
--   · suppliers ..................... INSERT/SELECT/UPDATE → REVOKE DELETE
--   · production_schedules .......... DELETE/INSERT/SELECT/UPDATE → DML conservée
--
-- Aucune RPC n'est affectée : elles sont SECURITY DEFINER et s'exécutent sous le
-- propriétaire, jamais sous `authenticated`.
--
-- Aucun changement de schéma : pas de régénération de types.

-- ---------------------------------------------------------------------------
-- Volet 1 — TRUNCATE / TRIGGER / REFERENCES : seize tables du domaine stock.
-- ---------------------------------------------------------------------------

REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE
  public.products,
  public.recipes,
  public.recipe_versions,
  public.production_records,
  public.production_batches,
  public.production_schedules,
  public.purchase_orders,
  public.purchase_order_items,
  public.goods_receipt_notes,
  public.stock_reservations,
  public.inventory_counts,
  public.inventory_count_items,
  public.margin_alerts,
  public.suppliers,
  public.units,
  public.unit_conversions
FROM authenticated, anon;

-- ---------------------------------------------------------------------------
-- Volet 2 — GRANT de DML sans policy correspondante.
-- ---------------------------------------------------------------------------

-- Référentiel d'unités : lecture seule pour l'application, écriture par RPC.
REVOKE INSERT, UPDATE, DELETE ON TABLE
  public.units,
  public.unit_conversions
FROM authenticated, anon;

-- Suppression de produit / fournisseur : aucune policy DELETE, le geste passe par RPC.
REVOKE DELETE ON TABLE
  public.products,
  public.suppliers
FROM authenticated, anon;

-- Alertes de marge : écrites par trigger, acquittées par UPDATE (policy existante).
REVOKE INSERT, DELETE ON TABLE
  public.margin_alerts
FROM authenticated, anon;

-- ---------------------------------------------------------------------------
-- Volet 3 — anon n'hérite plus par défaut sur les tables futures du schéma.
-- Miroir de la doctrine « REVOKE ... FROM PUBLIC » appliquée aux fonctions.
-- ---------------------------------------------------------------------------

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM authenticated, anon;

COMMENT ON TABLE public.units IS
  'Référentiel d''unités. Lecture seule pour authenticated (F3, 2026-09-07) : '
  'TRUNCATE n''est pas filtré par la RLS et vider cette table casse convert_quantity, '
  'donc toute déduction de recette. Écriture par RPC SECURITY DEFINER uniquement.';

COMMENT ON TABLE public.unit_conversions IS
  'Table de conversion d''unités. Lecture seule pour authenticated (F3, 2026-09-07) : '
  'même motif que public.units — la vider rend toute conversion de recette impossible.';
