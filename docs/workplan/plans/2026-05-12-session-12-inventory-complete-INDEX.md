# Session 12 — Inventory **Complete** — Implementation Plan INDEX

> **Trace historique** : ce fichier documente une session de travail datée. Le fond reste l'enregistrement de cette date. Seules les références de chemin ont été alignées sur la nouvelle structure (voir [`../../README.md`](../../README.md)).
> **Last refreshed** : 2026-05-13

> **Module concerné** : ce plan-INDEX correspond au module [Inventory & Stock](../../reference/04-modules/06-inventory-stock.md). Pour la spec consolidée actuelle (Partie I fonctionnel + Partie II technique + Partie III backlog + Partie IV design), aller à la référence canonique.

> **Date** : 2026-05-12
> **Statut** : INDEX multi-phases — chaque phase a son propre fichier `2026-05-12-session-12-inv-XX-<phase>.md` à créer en exécution
> **Spec source** : [`../specs/2026-05-12-session-12-inventory-complete-spec.md`](../specs/2026-05-12-session-12-inventory-complete-spec.md)
> **Remplace** : [`./2026-05-11-session-12-inventory-mvp.md`](./2026-05-11-session-12-inventory-mvp.md) (MVP — couverture ~15%)
> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (recommended) ou `superpowers:executing-plans`. Chaque phase est isolée et peut être déléguée à un subagent dédié.

---

## Goal global

Livrer le module **Inventory complete** tel que décrit dans la [référence Inventory](../../reference/04-modules/06-inventory-stock.md) (Partie I §1-20 vue fonctionnelle) :

- 7 onglets fonctionnels (Stock, Incoming, Transfers, Wastage, Production, Opname, Movements)
- Dashboard analytique par produit
- Panneau d'alertes (low-stock, reorder, production suggestions)
- Modèle physique sections + locations
- Couplage comptable automatique (waste, adjustment, opname, production)
- Conversion d'unités native (kg ↔ g, L ↔ mL, etc.)
- ≥270 nouveaux tests passants

## Architecture

8 phases séquencées avec dépendances explicites :

```
Phase 1 (foundations) ──┬── Phase 2 (RPCs core)
                         │
                         ├── Phase 3 (Transfers)
                         │
                         ├── Phase 4 (Production + Recipes)
                         │
                         ├── Phase 5 (Opname)
                         │
                         ├── Phase 6 (Movements ledger view)
                         │
                         ├── Phase 7 (Alerts + Dashboard)
                         │
                         └── Phase 8 (Accounting triggers)
```

Phases 3-8 peuvent partiellement se paralléliser entre subagents une fois Phase 1 terminée (foundations stables).

## Tech Stack

PostgreSQL + Supabase RLS, React + Vite + Vitest, TanStack Query, Tailwind, react-router-dom, supabase-js, lucide-react, Recharts (charts dashboard), Zod.

## Conventions

- Migrations : datées `20260516xxxxxx` (après session 11 `20260515000004`)
- Sous-plans nommés : `docs/workplan/plans/2026-05-12-session-12-inv-{NN}-{slug}.md`
- Tests SQL : `supabase/tests/inventory.test.sql` (pgTAP) + `supabase/tests/functions/inventory-*.test.ts` (Vitest live)
- Tests domain/UI co-localisés `__tests__/`
- Commits conventional : `feat(db|domain|ui|backoffice): session 12 — phase X — <topic>`. Co-author Claude.

## À la fin

- ≥30 migrations appliquées propres
- 12 nouvelles permissions seedées + `has_permission` v8
- ≥30 RPCs SECURITY DEFINER versionnés `_v1`
- 9 pages backoffice + ≥80 composants UI + ≥50 hooks TanStack Query
- Package `packages/domain/src/inventory/` complet (14 fichiers + 80+ tests unitaires)
- Couplage comptable auto via 1 trigger central
- Suite tests ≥920 passing
- 0 typecheck errors / 0 lint warnings / build POS+BO succès

---

## Phase 1 — Foundations (sections + enum + units + extension stock_movements)

**Sub-plan:** `2026-05-12-session-12-inv-01-foundations.md`

**Goal:** Poser le socle DB : tables `sections`, `stock_locations`, `unit_conversions` ; étendre l'enum `movement_type` avec 11 nouvelles valeurs ; ALTER `stock_movements` (sections, unit, supplier_id, idempotency_key, reason, unit_cost, metadata) ; lockdown RLS ; seed 12 permissions + has_permission v8.

**Migrations:** 20260516000001-08 (8 migrations)
**Files:** 0 modifiés UI, 1 modifié (`packages/supabase/src/rls/permissions.ts` + `types.generated.ts` régénéré)
**Tests:** pgTAP T1-T15 (≥15 tests sections + extensions + RLS + perms)
**Acceptance:**
- 5 sections seedées visibles via `SELECT * FROM sections`
- `stock_movements` direct INSERT par `authenticated` → RLS denied
- `has_permission(MANAGER, 'inventory.read')` → true
- `has_permission(MANAGER, 'inventory.adjust')` → false
- `has_permission(ADMIN, 'inventory.adjust')` → true

**Estimated effort:** ~600 lignes SQL, ~3-4h

---

## Phase 2 — RPCs admin core (Stock + Incoming + Wastage)

**Sub-plan:** `2026-05-12-session-12-inv-02-rpcs-core.md`

**Goal:** Livrer les RPCs admin de base + page Stock complète : `record_stock_movement_v1` (interne), `adjust_stock_v1` (ADMIN+), `receive_stock_v1` (déprécation MVP — wrapper de transition), `record_incoming_stock_v1` (MANAGER+), `waste_stock_v1` (MANAGER+), `get_stock_levels_v1` (paginé+filtré). Page `/backoffice/inventory` (Stock onglet) opérationnelle.

**Migrations:** 20260516000009-14 (6 migrations)
**Files:** ~12 nouveaux composants `apps/backoffice/src/features/inventory/`, ~6 hooks, 2 pages (`StockListPage`, `IncomingStockPage`)
**Tests:** pgTAP T16-T28 + 3 fichiers Vitest live (`inventory-stock`, `inventory-incoming`, `inventory-wastage`) + tests UI modaux
**Acceptance:**
- MANAGER login → `/backoffice/inventory` → list visible + low-stock badge OK
- Receive 20 unités → row update + `stock_movements.purchase` créé avec supplier_id
- Adjust caché pour MANAGER, visible pour ADMIN → set qty 50, reason "Recompte" → row update
- Waste 3 → row update + `stock_movements.waste` créé
- IncomingStockPage : saisie sans supplier OK, avec supplier optionnel OK

**Estimated effort:** ~1200 lignes SQL + ~1500 lignes TS/TSX, ~8-10h

---

## Phase 3 — Transfers (inter-sections)

**Sub-plan:** `2026-05-12-session-12-inv-03-transfers.md`

**Goal:** Livrer le cycle transferts complet : tables `internal_transfers` + `transfer_items`, RPCs `create_internal_transfer_v1`, `receive_internal_transfer_v1`, `cancel_internal_transfer_v1`. Pages `/backoffice/inventory/transfers/*` (list + form + detail). Cycle draft → pending → in_transit → received (ou cancelled). Mode `Send directly` qui réceptionne immédiatement.

**Migrations:** 20260516000015-17 (3 migrations)
**Files:** ~10 composants `features/inventory-transfers/`, ~5 hooks, 3 pages (`TransfersListPage`, `TransferFormPage`, `TransferDetailPage`)
**Tests:** pgTAP T29-T40 + Vitest live `inventory-transfers.test.ts` (full cycle + send_directly + concurrent receive lock) + tests UI form/receive
**Acceptance:**
- TransferFormPage : créer transfer 3 items WAREHOUSE→KITCHEN → status pending
- TransferDetailPage : timeline status visible, bouton Réception ouvre modal
- Réception : pour chaque item qty_received → submit → 2 mouvements émis (transfer_out négatif sur from, transfer_in positif sur to) + status received
- Send directly : créer + auto-receive en 1 mutation
- Cancel uniquement avant in_transit (test refus depuis received)

**Estimated effort:** ~800 lignes SQL + ~1800 lignes TS/TSX, ~8-10h

---

## Phase 4 — Production + Recipes

**Sub-plan:** `2026-05-12-session-12-inv-04-production.md`

**Goal:** Livrer le cœur métier boulangerie : tables `recipes` (flat product↔material) + `production_records`, RPCs `upsert_recipe_v1`, `record_production_v1` (atomique : production_in + N production_out via recipe + JE COGS), `revert_production_v1` (ADMIN+), `get_production_suggestions_v1`. Pages `/backoffice/inventory/production` + éditeur recettes. Conversion d'unité automatique via `convert_quantity()`.

**Migrations:** 20260516000018-23 (6 migrations)
**Files:** ~8 composants `features/inventory-production/`, ~6 hooks, 2 pages (`ProductionPage`, `RecipeEditorPage`)
**Tests:** pgTAP T41-T55 + Vitest live `inventory-production.test.ts` + tests UI form/recipe
**Acceptance:**
- RecipeEditor : ajouter ingrédients (250g flour + 5g salt + 5g yeast + 150g water pour baguette) → save → recette active
- ProductionForm : produire 50 baguettes → submit → 1 production_in (+50 baguettes) + 4 production_out (-12.5kg flour, -250g salt, -250g yeast, -7.5L water) + JE COGS posté
- Si stock ingrédient insuffisant → erreur explicite avec liste des manquants
- Revert (ADMIN+) sur production → réverse mouvements + JE contre-passation
- ProductionSuggestionsPanel : suggestions calculées via avg_daily_sold

**Estimated effort:** ~1500 lignes SQL + ~2000 lignes TS/TSX, ~12-14h

---

## Phase 5 — Opname (inventaire physique)

**Sub-plan:** `2026-05-12-session-12-inv-05-opname.md`

**Goal:** Livrer les sessions d'inventaire physique : tables `inventory_counts` + `inventory_count_items`, RPCs `create_opname_v1`, `add_opname_item_v1`, `set_opname_count_v1`, `finalize_opname_v1` (émet adjustments + JE), `validate_opname_v1` (ADMIN+ verrouille), `cancel_opname_v1`. Pages `/backoffice/inventory/opname` + détail. Cycle draft → in_progress → finalized → validated.

**Migrations:** 20260516000024-25 (2 migrations)
**Files:** ~7 composants `features/inventory-opname/`, ~7 hooks, 2 pages (`OpnameListPage`, `OpnameDetailPage`)
**Tests:** pgTAP T56-T68 + Vitest live `inventory-opname.test.ts` + tests UI count/finalize
**Acceptance:**
- Créer opname KITCHEN section → status draft
- Ajouter 3 produits → expected_quantity snapshot + status in_progress
- Saisir counts (1 surplus, 1 perte, 1 OK) → variance calculée live
- Finalize → 2 adjustments émis (1 in, 1 out) + 2 JE balanced
- Validate (ADMIN+) → status validated, plus aucune modification possible
- Cancel uniquement avant validate

**Estimated effort:** ~600 lignes SQL + ~1500 lignes TS/TSX, ~8-10h

---

## Phase 6 — Movements ledger view + aggregates

**Sub-plan:** `2026-05-12-session-12-inv-06-movements.md`

**Goal:** Livrer la vue ledger filtrable globale : RPCs `get_stock_movements_v1` (paginé + filtres product/types[]/section/supplier/user/dates) + `get_movements_aggregates_v1` (stats par type/période/section/utilisateur). Page `/backoffice/inventory/movements` avec table filtrable + drill-down vers la référence d'origine (PO, opname, transfer, production, sale).

**Migrations:** 20260516000026-27 (2 migrations)
**Files:** ~4 composants `features/inventory-movements/`, ~2 hooks, 1 page (`StockMovementsPage`)
**Tests:** pgTAP T69-T75 + tests UI filter/drilldown
**Acceptance:**
- Page list 100 mouvements derniers 7 jours
- Filtres : product, types multi-select (sale + purchase + waste), section, supplier, user, date range
- Drill-down sur référence : ouvre PO / opname / transfer / production / sale (selon `reference_type`)
- Stats agrégées affichées en haut : volume in/out, top types

**Estimated effort:** ~400 lignes SQL + ~1000 lignes TS/TSX, ~5-6h

---

## Phase 7 — Alertes + Dashboard produit

**Sub-plan:** `2026-05-12-session-12-inv-07-alerts-dashboard.md`

**Goal:** Livrer la couche pilotage : RPCs `get_low_stock_v1`, `get_reorder_suggestions_v1` (avg_daily + days_until_stockout + suggested_qty + last_supplier), `get_product_dashboard_v1` (1 appel = tout pour le dashboard analytique). Pages `/backoffice/inventory/alerts` (3 onglets) + `/backoffice/inventory/products/:id/dashboard` (charts Recharts). StockAlertsBadge dans topbar.

**Migrations:** 20260516000028-30 (3 migrations)
**Files:** ~10 composants `features/inventory-alerts/` + `features/inventory-dashboard/`, ~8 hooks, 2 pages (`AlertsPage`, `ProductDashboardPage`)
**Tests:** pgTAP T76-T82 + Vitest live `inventory-alerts.test.ts` + `inventory-dashboard.test.ts` + tests UI charts
**Acceptance:**
- Topbar : StockAlertsBadge avec compteur critical
- AlertsPage : 3 onglets (Low Stock / Reorder / Production) avec listes triées par sévérité
- Bouton "Créer PO" sur Reorder → ouvre `/backoffice/purchasing/purchase-orders/new` pré-rempli (handoff Purchasing)
- Bouton "Lancer production" sur Production → ouvre ProductionForm pré-rempli
- ProductDashboard : KPIs (current/value/rotation) + StockTimelineChart + MovementBreakdownChart + RecipeUsageTable + PurchasePriceTrendChart + WeeklyConsumptionChart

**Estimated effort:** ~700 lignes SQL + ~2200 lignes TS/TSX (charts gourmands), ~10-12h

---

## Phase 8 — Accounting triggers

**Sub-plan:** `2026-05-12-session-12-inv-08-accounting.md`

**Goal:** Livrer le couplage comptable automatique : trigger central `tr_stock_movement_je` après INSERT `stock_movements` qui émet JE pour `waste`/`adjustment_*`/`opname_*`/`production_*` (regroupé par `reference_id` pour production). Garde `check_fiscal_period_open`. Idempotency via UNIQUE `(reference_type, reference_id)` sur `journal_entries`. Comptes COGS Production / COGS Waste / Stock Adjustment Income/Expense / Inventory General seedés.

**Migrations:** 20260516000031-32 (2 migrations)
**Files:** 0 UI (purement backend)
**Tests:** pgTAP T83-T92 (10 tests JE)
**Acceptance:**
- `waste_stock_v1` → trigger émet JE Dr COGS Waste / Cr Inventory du `qty × cost_price`
- `adjust_stock_v1` (positif) → JE Cr Stock Adjustment Income / Dr Inventory
- `adjust_stock_v1` (négatif) → JE Dr Stock Adjustment Expense / Cr Inventory
- `opname` finalize → 1 JE par variance (mêmes types qu'adjustment)
- `record_production_v1` → 1 JE Dr COGS Production / Cr Inventory du `Σ ingredient_cost`
- `transfer_in/out` → AUCUN JE émis
- Fiscal period closed → raise `period_locked` + RPC échoue cleanly
- Double appel idempotent → 1 seul JE

**Estimated effort:** ~600 lignes SQL, ~5-6h

---

## File Structure (récap)

| Action | Path | Phase |
|---|---|---|
| CREATE 32 migrations | `supabase/migrations/20260516000001-32_*.sql` | 1-8 |
| MODIFY | `packages/supabase/src/types.generated.ts` (regen via `pnpm db:types`) | 1+ |
| MODIFY | `packages/supabase/src/rls/permissions.ts` (12 perms ajoutées) | 1 |
| CREATE | `packages/domain/src/inventory/` (14 fichiers + tests) | 2-7 (incrémental) |
| CREATE | `packages/utils/src/units/` (3 helpers) | 1 |
| CREATE | `apps/backoffice/src/features/inventory/` (12 composants + 6 hooks) | 2 |
| CREATE | `apps/backoffice/src/features/inventory-transfers/` | 3 |
| CREATE | `apps/backoffice/src/features/inventory-production/` | 4 |
| CREATE | `apps/backoffice/src/features/inventory-opname/` | 5 |
| CREATE | `apps/backoffice/src/features/inventory-movements/` | 6 |
| CREATE | `apps/backoffice/src/features/inventory-alerts/` | 7 |
| CREATE | `apps/backoffice/src/features/inventory-dashboard/` | 7 |
| CREATE | `apps/backoffice/src/pages/inventory/*.tsx` (14 pages) | 2-7 |
| MODIFY | `apps/backoffice/src/routes/index.tsx` (15 nouvelles routes) | 2-7 (incrémental) |
| MODIFY | `apps/backoffice/src/layouts/BackofficeLayout.tsx` (groupe Inventory + 9 entrées) | 2 |
| CREATE | `supabase/tests/inventory.test.sql` (≥100 pgTAP) | 1-8 (incrémental) |
| CREATE | `supabase/tests/functions/inventory-*.test.ts` (8 fichiers) | 2-7 |
| CREATE | `apps/backoffice/src/**/__tests__/` (smoke + unit BO) | 2-7 |

---

## Verification commands (one-shot)

```bash
# Apply migrations from scratch + regen types
pnpm db:reset && pnpm db:types

# Full quality gate
pnpm typecheck && pnpm lint && pnpm test --concurrency=1 && pnpm build

# pgTAP only
pnpm test:pgtap

# Targeted RPC tests
pnpm --filter @breakery/supabase test inventory

# BO smoke
pnpm --filter @breakery/backoffice test inventory.smoke
```

Expected at the end :
- 32 migrations applied
- `types.generated.ts` updated and committed
- 0 typecheck errors, 0 lint warnings
- ≥270 new tests passing, total suite ≥ 920
- POS + BO builds successful
- All acceptance criteria in spec §6 ticked

---

## Out of scope (déféré sessions futures)

| Feature | Session prévue |
|---|---|
| Reports module (stock valuation, slow movers, top wasters, exports XLSX/PDF) | 13 |
| Multi-branch (table branches, transfer inter-branch) | 14 |
| Stock reservations B2B (`stock_reservations`, `get_available_stock_v1`) | 15 |
| Recipes récursifs (semi-finis cascade) | 16 |
| Batch / lot / expiration tracking (FEFO) | 17 |
| Prévision de demande ML (ARIMA / lissage exponentiel) | 18 |
| Mobile inventory app (Capacitor scanner barcode + opname terrain) | 19 |
| Email alerts low-stock (Edge Function SMTP/Resend) | 14 |
| POS low-stock badge sur ProductCard | Polish optionnel — peut être inclus en Phase 7 si temps reste |

---

**Fin de l'INDEX.** Pour exécuter une phase :

```
/skill superpowers:subagent-driven-development
# puis pointer le subagent vers le sous-plan de la phase visée
```

Chaque sous-plan doit être créé en exécution avec :
- File structure détaillée
- Tasks step-by-step (checkbox `- [ ]`)
- SQL inline ou pseudo-code TS
- Tests à écrire
- Commits attendus
- Acceptance phase-locale
