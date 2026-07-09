# Session 15 — Bakery Production (F6 + F5 + Recipe pro features) — SPEC

**Date:** 2026-05-15
**Branch:** `swarm/session-15`
**INDEX:** [`../plans/2026-05-15-session-15-INDEX.md`](../../plans/archive/2026-05-15-session-15-INDEX.md)
**Module references:** [`docs/reference/04-modules/15-production-recipes.md`](../../../reference/04-modules/15-production-recipes.md), [`docs/reference/04-modules/05-products-categories.md`](../../../reference/04-modules/05-products-categories.md), [`docs/reference/04-modules/06-inventory-stock.md`](../../../reference/04-modules/06-inventory-stock.md)
**Source backlogs:** [`backlog-by-module/15-production-recipes.md`](../backlog-by-module/15-production-recipes.md), [`backlog-by-module/05-products-categories.md`](../backlog-by-module/05-products-categories.md)
**Migration block:** `20260519000001..210` (Session 15 reserved).

---

## 1. Goal

Closer le plus gros gap fonctionnel **bakery** identifié dans l'audit produit 2026-04-09 :

- **F6 — Sub-recipes (recettes composées récursives).** Pâte à croissant = sous-recette de pain au chocolat, croissant amande, etc. Cost cascade automatique, déduction stock récursive, anti-cycle.
- **F5 — Yield tracking.** Expected vs actual quantity per production batch, variance modal au-delà du seuil, report dédié, JE basé sur actual (pas expected).
- **Recipe pro features** : versioning, batch production multi-recette, scheduling fournées, recipe UX ergonomic (IngredientPicker autocomplete, DnD, duplicate, preview).
- **Optional P3** : margin alerts, boulanger's percentages, allergens structurés.

Session 14 a livré l'UX. Session 15 livre la **mécanique métier bakery**. F1 expiry est déjà clos en Session 13.

---

## 2. Scope (in)

### Wave 1 — F6 Sub-recipes (P0, XL)
- DB : trigger anti-cycle `validate_recipe_no_cycle()` (BEFORE INSERT/UPDATE on `recipes`).
- DB : RPC `calculate_recipe_cost_v1(p_product_id UUID, p_max_depth INT DEFAULT 5)` — récursif, retourne `{cost, breakdown jsonb[], depth_reached, has_cycle}`.
- DB : update `record_production_v1` pour déduire récursivement quand `material_id` pointe vers un produit lui-même recipe-built (au choix : déduction atomique des feuilles, ou auto-création de sous-`production_records` cascade).
- DB : nouvelle table `recipe_versions(id, product_id, version_number, snapshot_jsonb, created_at, created_by, change_note)` + trigger snapshot sur tout INSERT/UPDATE/DELETE de `recipes` actives.
- DB : `production_records.recipe_version_id` (FK) figé au moment de la production (anti-rétroactivité COGS).
- Domain : pure-TS `recipeCostCalculator.ts` qui réplique la logique DB pour preview UI sans round-trip.
- Tests : pgTAP couvrant (a) recipe simple, (b) recipe 2 niveaux, (c) recipe 5 niveaux, (d) cycle direct rejeté, (e) cycle indirect rejeté, (f) cost cascade correct.
- Tests : Vitest live RPC pour `calculate_recipe_cost_v1` + scenarios de déduction recursive.

### Wave 2 — F5 Yield tracking + Recipe versioning UI (P1, L)
- DB : ajouter `production_records.expected_yield_qty`, `actual_yield_qty`, `yield_variance_pct` (computed column), `yield_variance_reason TEXT` (rempli si variance > seuil).
- DB : trigger qui calcule `expected_yield_qty = recipe.output_qty × batch_size` à l'insert (utilisera la version snapshot).
- DB : update `tr_20_je_emit` / accountingEngine pour JE production utilise `actual_yield_qty` (pas `quantity_produced` historique).
- DB : config `business_config('production.yield_variance_threshold_pct', 15)` (modifiable).
- UI : `ProductionForm` affiche expected en grand, champ actual saisissable séparément. Modal "Confirm + reason" si variance > seuil.
- UI : page `/reports/production-yield` — trend par recipe + outliers, drill-down par variance batch.
- UI : `RecipeEditor` onglet "History" — timeline avec diffs `recipe_versions`.

### Wave 3 — Recipe UX ergonomic (P2, L)
- UI : composant `IngredientPicker.tsx` — autocomplete sur `products` (filtre raw + semi-finished) + onglet "Sub-recipe" (filtre produits avec `recipes.product_id` non vide). Live cost preview à droite.
- UI : `RecipeEditor` rows draggable via `@dnd-kit` (déjà installé).
- UI : bouton "Duplicate recipe" — clone toutes les rows actives vers un nouveau `product_id` cible.
- UI : preview card en haut de `RecipeEditor` — cost total + marge théorique + selling price + photo.
- UI : validation visuelle : si `Σ(qty × material.cost_price)` diverge de `recipe.cost_per_output` de > 5%, badge orange "Recompute".
- UI : intégration `IngredientPicker` dans `ProductionForm` aussi (filtre = recettes seulement).

### Wave 4 — Batch production + Production scheduling (P2, L)
- DB : table `production_batches(id, batch_number, scheduled_at, started_at, completed_at, staff_id, status, notes)` + FK `production_records.batch_id`.
- DB : RPC `record_batch_production_v1(p_batch jsonb, p_items jsonb[])` — atomique, valide stock agrégé pour TOUS les items avant déduction.
- DB : table `production_schedules(id, scheduled_date, slot, recipe_id, planned_qty, status, created_by, completed_record_id)`.
- DB : RPC `suggest_production_schedule_v1(p_target_date DATE)` — basé sur `view_product_sales` 4 dernières semaines même DOW.
- UI : page `/inventory/production/batch` — sélection multi-recipe avec qty, preview ingrédients agrégés ("5kg farine, 1kg beurre"), validation stock.
- UI : page `/inventory/production/schedule` — calendrier hebdo avec 4 slots/jour (5am/7am/11am/4pm), suggestions auto, drag-to-reschedule.

### Wave 5 — Margin alerts + Boulanger % + Allergens (P3, optional but in-scope)
- DB : `products.target_gross_margin_pct DECIMAL(5,2)` (default 60.00).
- DB : pg_cron job nightly qui recompute marge théorique et populate `margin_alerts` table (`product_id, expected_margin_pct, target_margin_pct, delta, computed_at, acknowledged_at`).
- UI : page `/inventory/production/margin-watch` — liste sous-seuil + delta vs précédent, action "Acknowledge".
- DB : `recipes.is_baker_percentage BOOLEAN DEFAULT FALSE` + `recipes.baker_percentage DECIMAL(5,2)` (utilisé si TRUE).
- UI : toggle "Boulanger's mode" dans `RecipeEditor` — switch saisie en %, champ "Target flour qty (g)", conversion auto.
- DB : enum `allergen_type` (gluten, crustaceans, eggs, fish, peanuts, soy, milk, nuts, celery, mustard, sesame, sulphites, lupin, molluscs — standard EU).
- DB : `products.allergens allergen_type[]`.
- DB : `view_product_allergens_resolved` — union récursive via `recipes` cascade.
- UI : badge allergens dans product card POS, customer display, receipt template.

### Wave 6 — Closeout (S)
- Types regen via MCP `generate_typescript_types` → `packages/supabase/src/types.generated.ts`.
- Full pnpm typecheck + test + build.
- PR draft "Session 15 — Bakery Production" → master.
- CLAUDE.md update : Active Workplan pointe sur Session 16 (next session).

---

## 3. Out of scope (Session 16+)

| Item | Pourquoi | Cible |
|---|---|---|
| Mode mobile production (TASK-15-009) | Dépend de Capacitor shell mobile | Session 16+ |
| IoT four (TASK-15-010) | Dépend de matériel + budget | Bloqué |
| Yield forecaster ML (TASK-15-012) | Dépend de TASK-15-002 stabilisé | Session 20+ |
| Multi-currency / multi-tenancy | Hors bakery production | Session 17+ |
| e-Faktur DJP | Bloqué PKP business | TBC |
| Ghost stock cleanup page (TASK-06-007) | Inventory follow-up, pas production | Session 16 |
| Waste tracking UX upgrade (TASK-06-009) | Inventory follow-up, pas production | Session 16 |
| Deviation packs S13 (Playwright CI, pg_net cron, Cash Flow Inv/Fin, mv_pl_monthly, staging-deploy secrets) | CI/CD + reports, pas production | Session 16 |

---

## 4. Decisions canoniques (D1..D18)

### D1 — Anti-cycle implementation
Trigger `validate_recipe_no_cycle()` BEFORE INSERT/UPDATE sur `recipes`. Walke récursivement via CTE jusqu'à max 5 niveaux. Si le walker rencontre `product_id` source dans la descendance → `RAISE EXCEPTION 'recipe_cycle_detected' USING ERRCODE='P0001'`. Si profondeur > 5 → `recipe_depth_exceeded`. **Aucune nouvelle colonne `child_recipe_id`** — le graphe est déjà exprimé via `recipes.product_id × recipes.material_id` (chaque matériau peut être lui-même un product avec ses propres recipes rows).

### D2 — Recipe cost calculation
RPC `calculate_recipe_cost_v1(p_product_id, p_max_depth = 5)` SECURITY DEFINER STABLE. Retourne `jsonb` :
```json
{
  "product_id": "...",
  "cost_per_unit": 12500.00,
  "breakdown": [
    {"material_id": "...", "material_name": "Flour", "is_recipe": false, "qty_per_unit": 0.250, "unit_cost": 8000, "subtotal": 2000},
    {"material_id": "...", "material_name": "Croissant dough", "is_recipe": true, "qty_per_unit": 0.100, "unit_cost": 50000, "subtotal": 5000, "sub_breakdown": [...]}
  ],
  "depth_reached": 2,
  "has_cycle": false
}
```
Pas de matérialized view pour cost — calcul on-demand (les recettes changent peu, et invalidation MV serait complexe). Cache côté client via TanStack Query staleTime 5 min.

### D3 — Recursive stock deduction
`record_production_v1` traite chaque `material_id` :
- Si le material a `recipes` rows actives → choix A1 = déduire directement les feuilles (récursion DB-side, single transaction). Choix A2 = créer un sous-`production_records` cascade (multi-level audit trail).
**Décision : A1 (déduction feuilles directe)**. Plus simple, transaction single-shot, performance OK pour profondeur ≤ 5. Audit trail capté via `production_records.materials_breakdown_jsonb` (nouveau col). Sub-`production_records` cascade reste un follow-up Wave 4 batch.

### D4 — Recipe versioning trigger
Trigger AFTER INSERT/UPDATE/DELETE sur `recipes` (FOR EACH ROW). À chaque modification, snapshot l'état complet de TOUTES les rows actives de `product_id` dans `recipe_versions` (one row per snapshot, jsonb agrège toutes les ingrédients lines). Évite la sur-fragmentation. `production_records.recipe_version_id` FK pointe sur le dernier snapshot au moment du `record_production_v1`.

### D5 — JE source-of-truth = actual_yield
`tr_20_je_emit` (et accountingEngine) lisent `actual_yield_qty` (pas `quantity_produced`) pour calculer Dr Inventory finished goods. Si `actual_yield_qty` IS NULL → fallback `quantity_produced` + flag `actual_pending=TRUE` dans audit_log.

### D6 — Yield variance threshold
Default 15.00% (configurable via `business_config('production.yield_variance_threshold_pct')`). UI modal "Confirm variance" obligatoire si `|variance_pct| > threshold`. Le manager peut override avec une `yield_variance_reason` libre (min 5 chars).

### D7 — Migration data legacy recipes
Les recettes existantes (créées Session 13 Phase 2.A) restent valides en flat-BoM. Pas de migration data forcée. Le trigger anti-cycle ne se déclenche qu'aux nouvelles modifications. Backfill `recipe_versions` : un snapshot initial créé pour chaque `product_id` ayant des `recipes.is_active = TRUE` au moment de l'application du trigger.

### D8 — IngredientPicker sub-recipe filter
Détection "produit est une recette" via `EXISTS (SELECT 1 FROM recipes WHERE product_id = p.id AND is_active = TRUE AND deleted_at IS NULL)`. Vue `view_recipe_products` matérialisée idempotemment, refresh sur changement `recipes`.

### D9 — Recipe duplicate
Bouton "Duplicate to product X" ouvre un modal Select product cible (filtre = produits SANS recettes actives). Clone toutes les rows actives via RPC `duplicate_recipe_v1(p_source_product_id, p_target_product_id)`. Audit log entry `recipe.duplicated`.

### D10 — Batch production atomicity
`record_batch_production_v1` calcule **d'abord** les ingrédients agrégés requis sur l'ensemble du batch, valide la disponibilité stock (avec FIFO lots), puis applique `record_production_v1` pour chaque item en séquence. Si une seule étape échoue → ROLLBACK complet. Idempotency via `p_idempotency_key UUID` sur le batch entier.

### D11 — Scheduling suggestions
RPC `suggest_production_schedule_v1(p_target_date DATE)` requête `view_product_sales` (filtre DOW = p_target_date DOW, 4 dernières semaines), agrège par recipe, applique facteur 1.10 (10% buffer), retourne suggestions ordonnées par margin × volume DESC. Fallback : si historique < 7 jours pour ce produit → suggestion 0 (manager saisit manuellement).

### D12 — Margin alerts cron
pg_cron job `recompute_recipe_margins` daily 02:00 UTC. Itère tous produits avec `recipes` actives, appelle `calculate_recipe_cost_v1`, compare à `target_gross_margin_pct`. INSERT `margin_alerts` row si delta négatif (la marge est passée sous le seuil). Email/in-app notification gated sur permission `notifications.production_alerts`.

### D13 — Boulanger's percentages
Mode opt-in sur la recette entière (pas par row). `recipes.is_baker_percentage = TRUE` → tous les ratios sont stockés en `baker_percentage DECIMAL(5,2)` au lieu de `quantity DECIMAL(10,3)`. Un row pivot référence par convention `material_id = <flour product>` avec `baker_percentage = 100.00`. Conversion absolue calculée à la volée pour `record_production_v1` via `target_flour_qty` passé en paramètre, ou recalculé depuis `production_records.batch_size × default_flour_qty_per_unit`.

### D14 — Allergens propagation
View `view_product_allergens_resolved` retourne `(product_id, allergens allergen_type[])` via CTE récursive sur le graphe `recipes`. Pas de colonne `products.allergens_resolved` stockée — toujours computed pour rester en phase. RLS `inventory.read`. Performance acceptable car cardinalité produits < 200 dans le contexte The Breakery.

### D15 — Permissions
Réutilise les permissions existantes :
- `inventory.recipes.update` (MANAGER+) → couvre Wave 1 + Wave 3 + Wave 5 (boulanger toggle).
- `inventory.production.create` (déjà gated par `record_production_v1`) → couvre Wave 2 + Wave 4 batch.
- `inventory.production.schedule` (NEW MANAGER+) → couvre Wave 4 schedule.
- `notifications.production_alerts` (NEW MANAGER+) → couvre Wave 5 margin alerts.

### D16 — Migration block
Session 15 réserve `20260519000001..210` :
- `000001..030` Wave 1 (anti-cycle, cost RPC, recipe_versions, record_production cascade).
- `000040..070` Wave 2 (yield cols, threshold config, JE update).
- `000080..099` Wave 3 (view_recipe_products, duplicate_recipe RPC).
- `000100..130` Wave 4 (production_batches, production_schedules + RPCs + pg_cron suggest).
- `000140..170` Wave 5 (target_margin col, margin_alerts table + cron, baker_percentage cols, allergen_type enum + products.allergens + view).
- `000180..210` réservé hotfix.

### D17 — Tests strategy
- **pgTAP** : DB-level invariants. Une `.test.sql` par feature : `f6_sub_recipes.test.sql`, `f5_yield_tracking.test.sql`, `recipe_versions.test.sql`, `batch_production.test.sql`, `production_schedule.test.sql`, `margin_alerts.test.sql`, `allergens.test.sql`.
- **Vitest live RPC** (`supabase/tests/functions/`) : un fichier par RPC nouvelle.
- **Domain** : `packages/domain/src/production/recipeCostCalculator.ts` + `__tests__/`. Pure-TS replication de la cost cascade pour preview UI.
- **BO smoke** : un `*.smoke.test.tsx` par nouveau component (IngredientPicker, MarginWatchPage, BatchProductionPage, ProductionSchedulePage, RecipeEditor history tab).

### D18 — POS / Customer Display surface impact
Aucune. Session 15 = backoffice + DB only. POS lit `view_product_allergens_resolved` en read-only Wave 5 si on a le temps de pousser le badge allergène dans `ProductCard`. Sinon report Session 16.

---

## 5. Contraintes techniques (rappel CLAUDE.md)

- DB target = **cloud V3 dev** `ikcyvlovptebroadgtvd` (Docker retiré). Tous les `apply_migration` via MCP.
- `stock_movements` reste append-only — déductions Wave 1 passent par `record_stock_movement_v1` (pas insert direct).
- RPCs versionnés monotones — `record_production_v1` modifié ne devient PAS `_v2` (signature stable). On ajoute un paramètre optionnel `p_recurse_subrecipes BOOLEAN DEFAULT TRUE` pour préserver compat appelants.
- Types regen **obligatoire** après chaque migration (sinon CI casse).
- `stock_movements.unit` NOT NULL — déduction Wave 1 doit passer `unit` (vient du `recipes.unit` ou converti via `convert_quantity`).

---

## 6. DoD global

- [ ] 14 phases livrées (Wave 0..6).
- [ ] 30+ migrations cloud apply OK (numérotation monotone `20260519000001..`).
- [ ] Types regen + commit `packages/supabase/src/types.generated.ts`.
- [ ] `pnpm typecheck && pnpm exec turbo run test --concurrency=1 && pnpm build` green sur swarm/session-15.
- [ ] pgTAP suite green (7 nouveaux fichiers).
- [ ] Vitest live RPC green sur recettes / yield / batch / schedule / margins / allergens.
- [ ] PR draft "Session 15 — Bakery Production" prêt à merge sur master.
- [ ] CLAUDE.md "Active Workplan" pointe vers Session 16.
- [ ] Deviation packs S15 (le cas échéant) documentés dans INDEX §closeout.

---

## 7. Effort budget

| Wave | Phases | Estim h | Parallélisable |
|---|---|---|---|
| 0 | Spec + INDEX + branch + workplan update | 2 | sequential |
| 1 | F6 sub-recipes (DB + domain + tests) | 12 | 3 streams (db / domain / tests) |
| 2 | F5 yield + recipe versioning UI | 8 | 2 streams (db+JE / UI) |
| 3 | Recipe UX (picker / dnd / duplicate) | 8 | 2 streams (picker / editor) |
| 4 | Batch production + scheduling | 12 | 2 streams (batch / schedule) |
| 5 | Margin alerts + boulanger % + allergens | 10 | 3 streams |
| 6 | Closeout (types + test + PR) | 3 | sequential |
| **TOTAL** | **14 phases** | **~55h** | **6 waves** |

Solo séquentiel : ~80h. Swarm 3 subagents par wave : ~55h.

---

## 8. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Cycle recipe non détecté → freeze DB | Catastrophique (CPU loop in cost RPC) | Trigger anti-cycle STRICT + max_depth 5 hard limit dans cost RPC + pgTAP test cycle direct + indirect. |
| Migration data legacy recettes incompatibles | Casse production runtime | `recipe_versions` initial snapshot rétroactif. Pas de schema breaking. |
| Performance cost cascade > 5 niveaux | Lent | Hard depth limit. Si rencontré → `RAISE EXCEPTION`. Pour bakery The Breakery, profondeur max observée = 2 (croissant dough → croissant). |
| JE comptable change (actual yield) | Rétroactivité COGS | Migration data : pour les `production_records` historiques, `actual_yield_qty = quantity_produced` (no-op). Pas de re-emission JE rétroactive. |
| `record_production_v1` signature break | Casse hooks/services existants | Param ajouté avec DEFAULT TRUE. Tests live RPC vérifient backward-compat. |
| Allergens enum drift entre EU et BPOM (Indonésie) | Conformité | Standard EU = baseline. Si BPOM différent → migration future ajoute valeurs. Pas de suppression rétroactive. |
| Scheduling suggestions naïves (peu d'historique) | Mauvaises suggestions | Fallback 0 + override manuel. Documenter dans UI. |

---

## 9. References

- Source backlogs : `docs/workplan/backlog-by-module/15-production-recipes.md` (TASK-15-001..012), `05-products-categories.md` (TASK-05-001).
- Audit produit : `docs/audit/07-product-backlog-audit.md` §Critical-1 (F1 done) + §Critical-3 (F6 todo).
- Audit comptable : `docs/audit/02-accounting-business-audit.md` §PRODUCTION_COGS.
- Session 13 (recipes flat) : `docs/workplan/plans/2026-05-13-session-13-INDEX.md` Phase 2.A.
- Session 14 (UX) : `docs/workplan/plans/2026-05-14-session-14-INDEX.md`.
- Schema actuel : migrations `20260517000060..066`.

---

*Spec écrite 2026-05-15 sur `swarm/session-15` (branch d7d60d5 + ci 9d98f61).*
