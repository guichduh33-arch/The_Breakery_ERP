# Travail — Production & Recipes

> Last updated: 2026-05-17
> Référence : `docs/reference/04-modules/15-production-recipes.md` (à créer)
> Sources d'audit : `docs/audit/07-product-backlog-audit.md` (Production 75% : F5 yield + F6 sub-recipes manquants — gaps CRITIQUES bakery), `docs/audit/02-accounting-business-audit.md` (P1-1 PRODUCTION_COGS broken), `CURRENT_STATE.md` Backlog F5/F6

## Objectifs du module

1. **Sub-recipes (F6)** — couvrir le besoin réel bakery : pâte à croissant = sous-recette de pain au chocolat, croissant amande, etc. Coût composé en cascade.
2. **Yield tracking (F5)** — capter expected_qty vs actual_qty pour calculer la perte de cuisson (10-20% standard) et fiabiliser le COGS.
3. **Recipes UI ergonomique** — saisie fluide ingrédients (autocomplete, drag&drop), validation que la somme matches l'unité de sortie.
4. **Batch production** — produire plusieurs recettes en une opération (ex. fournée matinale = 50 baguettes + 30 croissants + 20 pains au chocolat).
5. **Recipe versioning** — historique des modifs de recettes (changement fournisseur farine = nouvelle version).
6. **Production scheduling** (gap audit produit non backloggé) — planifier "bake X at 5am for 7am opening".

## Tâches

### TASK-15-001 — Sub-recipes (F6) — composition récursive + cost cascade [P0] [DONE]
**Status note (2026-05-14)** : Deferred per INDEX Wave 7 "Out of scope" line 1213 — "Sub-recipes récursifs (F6 complet) | 14+". V3 `recipes` schema (migration `…000060`) is intentionally flat BoM (`product_id` + `material_id`, no `child_recipe_id` column, no anti-cycle trigger). Critical for composed-product COGS but parked until Session 14+ when sub-recipe RPC + UI selector can be co-delivered.
**Status note (2026-05-17)** : DONE — S15 livré : anti-cycle 5-niveaux via `validate_recipe_no_cycle` trigger (migration `20260519000001`) + `calculate_recipe_cost` RPC cascade (migration `…000002`) + `recipe_versions` snapshot (migrations `…000003..005`) + bump `record_production_v1` avec déduction récursive matières feuilles (migration `…000006`). S17 a complété la cascade : `recipe_bom_full_v1` (depth-5 WITH RECURSIVE, migration `20260521000020`) + `product_cost_at_version` full-cascade + trigger `tr_snapshot_recipe_version_cascade` (snapshots ancestres via WITH RECURSIVE walk lors d'UPDATE recettes ou cost_price). UI : IngredientPicker tabs Product/Sub-recipe, RecipeEditor avec preview cost en live.
**Contexte** : Audit John P0 — "core bakery requirement, without it every composed product BOM is flat and recipe costing is wrong". Backlog `CURRENT_STATE.md` F6.
**Critère d'acceptation** :
- [ ] Schema : `recipe_ingredients` accepte `child_recipe_id` (FK to `recipes`) en plus de `product_id` ; check XOR (l'un ou l'autre).
- [ ] Récursion limitée à 5 niveaux (anti-cycle) via fonction `validate_recipe_no_cycle()` trigger.
- [ ] RPC `calculate_recipe_cost(recipe_id)` calcule le coût en suivant la cascade des sub-recipes.
- [ ] UI RecipeForm : selector "Add ingredient" avec onglets "Product" / "Sub-recipe".
- [ ] Tests : recette pain au chocolat = sub-recette pâte croissant (qui contient farine + beurre) + chocolat. Cost calc doit cascade.
- [ ] `useProduction.create` (CLAUDE.md pitfall) déduit récursivement les ingrédients atomiques (products feuilles).
**Fichiers concernés** : migration `recipe_ingredients.child_recipe_id` + trigger anti-cycle, RPC cost, `src/services/production/recipeService.ts`, `src/components/products/RecipeForm.tsx`, `src/hooks/useProduction.ts`.
**Dépend de** : `TASK-10-007` (PRODUCTION_COGS account fixé).
**Estimation** : XL — décomposer en :
  1. Schema + RPC cost (M)
  2. UI form + selector (M)
  3. Production stock deduction recursive (M)
  4. Tests + migration data fix existing recipes (S)
**Risques** : cycles infinis si validation buggée → trigger strict obligatoire.
**Notes** : gros impact comptable — coordonner avec comptable pour validation cost calc.

### TASK-15-002 — Yield tracking (F5) — expected vs actual production [P1] [DONE]
**Status note (2026-05-14)** : Partially delivered Session 13 Phase 2.A. V3 `production_records` (migration `…000061`) ships `quantity_produced` + `quantity_waste` columns but NOT the spec's `expected_yield_qty` / `actual_yield_qty` / `yield_variance_pct` triplet; ProductionForm.tsx has no "variance > 15% → confirm modal" flow; no `/reports/production-yield` page. F5 yield-tracking remains a genuine gap — Session 14+ follow-up.
**Status note (2026-05-17)** : DONE — S15 livré : colonnes `expected_yield_qty` / `actual_yield_qty` / `yield_variance_pct` (migrations `20260519000040..044`) + seuil configurable via `business_config.production_yield_variance_threshold_pct` (informational : ratio scalaire vs key-value, UI auto-convertit) + ProductionForm + YieldVarianceModal "Confirm + reason" + RecipeVersionHistory + bump JE production pour utiliser `actual` (Dr Inventory) + page `/reports/production-yield` (ProductionYieldPage). Backfill historique inclus.
**Contexte** : Audit John P1 — "10-20% variance untracked, pricing may be wrong". Backlog F5.
**Critère d'acceptation** :
- [ ] `production_records.expected_yield_qty` (calculé recipe.output_qty × batch_size).
- [ ] `production_records.actual_yield_qty` saisi par le boulanger en fin de production.
- [ ] `production_records.yield_variance_pct` calculé (`(actual - expected) / expected`).
- [ ] UI `ProductionFormPage` affiche expected en grand, champ actual saisissable.
- [ ] Si variance > 15% (seuil configurable) → modal "Confirm + reason" obligatoire.
- [ ] Report `/reports/production-yield` : trend par recipe + alertes outliers.
- [ ] JE production utilise `actual` pour Dr Inventory (pas expected) — éviter sur-évaluation stock.
**Fichiers concernés** : migration colonnes, formulaire, hook `useProduction`, accountingEngine `postProductionJournalEntry` (utiliser actual), nouveau report.
**Dépend de** : `TASK-15-001` (sub-recipes pour calc expected fiable), `TASK-10-007`.
**Estimation** : L
**Risques** : si bouleur oublie de saisir actual → fallback expected avec flag `actual_pending`.
**Notes** : seuil 15% modifiable selon recipe (pâte à pizza vs croissant ont des yields différents).

### TASK-15-003 — Recipes UI CRUD ergonomique [P2] [DONE]
**Status note (2026-05-14)** : Partially delivered Session 13 Phase 2.A. V3 evidence: `apps/backoffice/src/features/inventory-production/components/RecipeEditor.tsx` + smoke test `RecipeEditor.smoke.test.tsx` provide basic CRUD; live `checkFeasibility()` preview from `@breakery/domain`. Still missing: dedicated `IngredientPicker` autocomplete component, @dnd-kit drag-reorder, sum-vs-cost validation badge, "Duplicate recipe" button, Playwright spec. Session 14+ follow-up.
**Status note (2026-05-17)** : DONE — S15 livré : `IngredientPicker` (`packages/ui` + hook `useIngredientSearch`) avec autocomplete tabs Product/Sub-recipe via RPC `search_ingredients_v1` (migration `20260519000081`) + `view_recipe_products` (migration `…000080`) ; DnD reorder via @dnd-kit dans RecipeEditor ; `duplicate_recipe_v1` RPC (migration `…000082`) + RecipeDuplicateModal ; `RecipeCostPreviewCard` avec live cost calc. Playwright deferred (pas critique, smoke tests Vitest livrés). S16 enrichi : `is_semi_finished` flag (migration `…000010..013`) + pg_trgm GIN indexes pour ranking trigramme dans le picker.
**Contexte** : Audit Sally `05-uiux-design-audit.md` souligne UX inégale en back-office. RecipeForm aujourd'hui = formulaire basique, saisie ingrédients pénible (pas d'autocomplete, pas de drag-reorder).
**Critère d'acceptation** :
- [ ] Composant `IngredientPicker` avec autocomplete sur `products` + `recipes` (sub-recipes), preview cost en live.
- [ ] Drag&drop reorder ingrédients (`@dnd-kit` déjà en dépendance).
- [ ] Validation : somme `ingredient_qty × ingredient_unit_cost` doit matcher (ou écart < 5%) `recipe.cost_per_output`.
- [ ] Bouton "Duplicate recipe" pour cloner et modifier.
- [ ] Preview cards : photo finale + temps prep + cost per unit + selling price + margin %.
- [ ] Tests Playwright sur le flow create recipe.
**Fichiers concernés** : `src/components/products/RecipeForm.tsx`, `src/components/products/IngredientPicker.tsx` (nouveau), service.
**Dépend de** : `TASK-15-001` (sub-recipes).
**Estimation** : L
**Risques** : esthétique uniquement n'apporte rien si calcul incorrect — doit accompagner TASK-15-002.
**Notes** : screenshot avant/après pour décrire l'écart UX.

### TASK-15-004 — Batch production (multi-recipe en 1 opération) [P2] [DONE]
**Status note (2026-05-14)** : Not delivered Session 13. No `production_batches` table in `supabase/migrations/20260517*.sql`, no `/production/batch` page. V3 `record_production_v1` handles single-recipe atomic insertion with idempotency key. Genuine gap — Session 14+ follow-up.
**Status note (2026-05-17)** : DONE — S15 livré : table `production_batches` + FK (`production_records.production_batch_id`) (migrations `20260519000100..101`) + RPC `record_batch_production_v1` (migration `…000103`, atomique tout-ou-rien) + page BO Batch (`BatchProductionPage` + BatchSelector) + `IngredientAggregatePreview` qui pré-aggrège les matières feuilles avant validation stock (S15 walks depth-1 puis S17 rewire vers `recipe_bom_full_v1` pour multi-niveaux). Fix temp-table collision même-tx via migration `…000103`.
**Contexte** : Boulanger fait une fournée = 5 recettes en parallèle. Aujourd'hui : 5 productions séparées à saisir = 5 fois plus de clics.
**Critère d'acceptation** :
- [ ] Page `/production/batch` : sélection multi-recipe + qty par recipe + date/time prévue.
- [ ] Soumission crée N `production_records` liés à un même `production_batch_id`.
- [ ] UI : preview totaux ingrédients agrégés (ex. "5 kg farine, 1 kg beurre, 200 oeufs").
- [ ] Validation stock : si insuffisant → bloquer avec liste des manques.
- [ ] Trigger atomique : tout ou rien (transaction).
**Fichiers concernés** : migration `production_batches` table, page batch, service.
**Dépend de** : `TASK-15-001`.
**Estimation** : L
**Risques** : transaction longue si plusieurs centaines d'unités — performance.
**Notes** : workflow type 5h-7h matin pour préparation ouverture 8h.

### TASK-15-005 — Recipe versioning (historique modifs) [P2] [DONE]
**Status note (2026-05-14)** : Not delivered Session 13. No `recipe_versions` table, no snapshot trigger, no `recipe_version_id` FK on `production_records`. V3 `recipes` table uses soft-delete (`deleted_at`) to preserve version history at the row level — partial substitute but not a structured version snapshot. Genuine gap — Session 14+ follow-up.
**Status note (2026-05-17)** : DONE (3-session cascade) — S15 a livré : table `recipe_versions` append-only (migration `20260519000003`), backfill (migration `…000004`), FK `production_records.recipe_version_id` (migration `…000005`), snapshot copie les noms (résiste à suppression product), UI `RecipeVersionHistory` timeline avec diffs. S16 a embarqué le coût per-version dans `snapshot.cost_price` (breaking shape change, migrations `20260520000020..022`) + CHECK constraint + refresh helper (legacy rows pré-S16 sans cost tolérés : `DEV-S16-2.B-02`). S18 a livré le Report cost trend complet (RPC `recipe_cost_history_v1` migration `20260522000010` dual-mode + 2 pages BO `RecipeCostOverviewPage` cross-recipe + `RecipeCostTimelinePage` single-recipe avec recharts LineChart) — voir TASK-14-021.
**Contexte** : Modifier une recette change rétroactivement le cost calculé pour les productions passées. Audit produit Gap "Recipe Cost Trends MISSING — cost_price is static, no history tracked".
**Critère d'acceptation** :
- [ ] `recipe_versions(recipe_id, version_number, definition_jsonb, created_at, created_by, change_note)`.
- [ ] Trigger snapshot à toute modif `recipes` ou `recipe_ingredients`.
- [ ] `production_records.recipe_version_id` figé (FK to `recipe_versions`).
- [ ] UI `RecipeDetailPage` onglet "History" : timeline avec diffs (ingrédient ajouté, qty modifiée).
- [ ] Report cost trend : evolution coût recette par version → identifie inflation matières.
**Fichiers concernés** : migration versions table + trigger, hook, UI tab.
**Dépend de** : `TASK-15-001`.
**Estimation** : M
**Risques** : volume historique → rétention 5 ans + archive.
**Notes** : le snapshot doit copier les noms produits (pas les FK) pour résister à la suppression d'un product.

### TASK-15-006 — Production scheduling (planning fournées) [P2] [DONE]
**Status note (2026-05-14)** : Partially delivered Session 13 Phase 2.A. V3 evidence: `supabase/migrations/20260517000065_create_production_suggestions_rpc.sql` + `apps/backoffice/src/features/inventory-production/{hooks/useProductionSuggestions.ts,components/ProductionSuggestions.tsx}` surface sales-based suggestions. Still missing: `/production/schedule` calendar UI, slot-based scheduling table, push notifications 30 min before slot. Session 14+ follow-up.
**Status note (2026-05-17)** : DONE — S15 livré : table `production_schedules` (migration `20260519000120`) + RPC `suggest_production_schedule_v1` (migration `…000121`, aggregate direct depuis `order_items` join `orders` car `view_product_sales` absent V3 — `DEV-S15-4.B-01` informational) + perm grant (migration `…000122`) + page BO `ProductionSchedulePage` avec calendrier hebdo (ProductionCalendarGrid + ScheduleSlotCell) + hook `useProductionSchedule`. Notifications push 30 min : deferred (faisable via pg_net cron — voir D-W6-6B-02 backlog 13).
**Contexte** : Audit produit Gap missing #13 "Production scheduling not on backlog — no forward planning". Boulanger arrive à 5h, doit savoir QUOI préparer (basé sur historique vente).
**Critère d'acceptation** :
- [ ] Page `/production/schedule` : calendrier hebdo avec slots (5am, 7am, 11am, 4pm) et recipes prévues par slot.
- [ ] Suggestions auto basées sur `view_product_sales` 4 dernières semaines (même jour de semaine).
- [ ] Boulanger valide/ajuste le matin → crée les `production_records` en `status='scheduled'`.
- [ ] Notification push/in-app au boulanger 30 min avant slot.
- [ ] Variance vs réalisé tracké pour ajustement IA futur.
**Fichiers concernés** : nouvelle table `production_schedules`, page, service de suggestion.
**Dépend de** : `TASK-15-002` (yield tracking pour ajustements).
**Estimation** : L
**Risques** : suggestions naïves si peu d'historique — fallback manuel toujours possible.
**Notes** : pose les bases pour ML demand forecasting plus tard.

---

## Backlog métier (objectif fonctionnel)

> Items issus de `docs/objectif travail/PRODUCTION.md` §16 — vision produit du module.
> Ajoutés 2026-05-13 lors de la cascade docs (session 13). Sous-recettes, versioning, scheduling sont déjà couverts par TASK-15-001/005/006.

### TASK-15-007 — Boulanger's percentages [P3] [DONE]
**Status note (2026-05-14)** : Not delivered Session 13. No "Boulanger's mode" toggle in `RecipeEditor.tsx`; recipes stored as flat absolute `quantity` only (migration `…000060`). Niche pro-baker feature — genuine gap, Session 14+ follow-up (low priority).
**Status note (2026-05-17)** : DONE — S15 livré : colonne `recipes.is_baker_percentage` (migration `20260519000150`) + bump `upsert_recipe_v1` (signature stable via trailing DEFAULTs — `DEV-S15-5.B-01` informational) + `BoulangerModeToggle` sur RecipeEditor + conversion auto `quantity = (percentage/100) × target_flour_qty` + `BakerPreviewPanel.tsx` (extrait de RecipeEditor pour rester sous 500 lignes, `DEV-S15-5.B-02` informational). Affichage absolu/% pour la même recette.
**Contexte** : les boulangers traditionnels raisonnent en pourcentages de farine (farine = 100 %, eau = 65 %, sel = 2 %…) plutôt qu'en quantités absolues. Le module n'accepte que les quantités absolues.
**Bénéfice attendu** : saisir une recette en % de farine, le système convertit automatiquement vers quantité absolue selon la quantité de farine cible.
**Critère d'acceptation** :
- [ ] Toggle "Boulanger's mode" sur `RecipeForm` du produit.
- [ ] Si activé : saisie en % (farine = 100, eau = 65, etc.) + champ "Quantité farine cible (g)".
- [ ] Conversion auto à la sauvegarde : `quantity = (percentage/100) × target_flour_qty`.
- [ ] Affichage des deux vues (absolu et %) sur la recette stockée.
**Dépend de** : aucune.
**Estimation** : M
**Risques** : confusion entre les deux modes — bien indiquer lequel est actif.
**Notes** : standard professionnel boulangerie ; valoriser l'expertise artisan.

### TASK-15-008 — Allergènes structurés [P3] [TODO]
**Status note (2026-05-14)** : Not delivered Session 13. No `allergens` enum table, no `products.allergens[]` column, no automatic allergen propagation on finished products. Regulatory/EU-compliance feature — genuine gap, Session 14+ follow-up.
**Status note (2026-05-17)** : PARTIAL — admin/back-office DONE, receipt + customer-display WONTFIX permanent. S15 livré : enum 14 allergènes standard EU (gluten, crustacés, œufs, poissons, arachides, soja, lait, fruits à coque, céleri, moutarde, sésame, sulfites, lupin, mollusques — migration `20260519000160`) + `products.allergens[]` colonne (migration `…000161`) + view récursive `view_product_allergens` qui agrège via la BoM (migration `…000162`) + composant `AllergensSelector` (BO Products page) + AllergenBadge dans ProductCard (POS + BO badges). **WONTFIX 2026-05-17 per user decision** (memory : `project_allergens_wontfix`) — l'intégration receipt template + customer display (`DEV-S15-5.C-01`) ne sera pas faite, pas de besoin métier identifié. Status reste `[TODO]` car le scope original incluait receipt/display ; le scope effectivement livré (admin only) est satisfaisant pour l'usage actuel.
**Contexte** : aujourd'hui les allergènes sont en notes libres sur le produit. Pas de propagation auto via les recettes.
**Bénéfice attendu** : tracer gluten, lactose, fruits à coque, œuf, soja, etc. sur chaque ingrédient → affichage automatique sur fiche produit fini + ticket caisse + display.
**Critère d'acceptation** :
- [ ] Table `allergens` (enum standard EU : gluten, crustacés, œufs, poissons, arachides, soja, lait, fruits à coque, céleri, moutarde, sésame, sulfites, lupin, mollusques).
- [ ] Champ `products.allergens` (array) sur les matières premières.
- [ ] Calcul auto sur produit fini : union des allergènes de tous les ingrédients de la recette.
- [ ] Affichage badge allergène sur fiche produit, ticket, customer display.
**Dépend de** : aucune.
**Estimation** : M
**Risques** : conformité réglementaire — valider la liste standard avec la réglementation indonésienne (BPOM).
**Notes** : différenciant fort pour clientèle internationale Bali.

### TASK-15-009 — Mode mobile de saisie [P3] [BLOCKED]
**Status note (2026-05-14)** : Deferred per INDEX Wave 7 "Out of scope" line 1208 — "Mobile shell Capacitor + push native | Session 16". Mobile-first production page depends on broader Capacitor shell; revisit Session 16.
**Contexte** : le boulanger est en cuisine, pas devant le PC. Saisir une production l'oblige à se déplacer.
**Bénéfice attendu** : interface mobile-first sur tablette / téléphone pour la saisie au four.
**Critère d'acceptation** :
- [ ] Page `/production/mobile` responsive (large touch targets).
- [ ] Sélection produit + quantité produite + waste en 3 taps.
- [ ] Voice input optionnel (TASK-04-016 vocabulary réutilisable).
- [ ] Synchro temps réel avec `StockProductionPage` desktop.
- [ ] Mode kiosque (un seul appareil dédié station four).
**Dépend de** : aucune.
**Estimation** : M
**Risques** : variance d'écran tablette — testing sur les 3 tailles principales.
**Notes** : sortir d'un PWA pour install facile sur tablette dédiée.

### TASK-15-010 — Intégration IoT four [P3] [BLOCKED]
**Status note (2026-05-14)** : Deferred — gated on hardware procurement + budget per the task's own "Dépend de : matériel IoT compatible + budget". No `iot-oven-callback` Edge Function exists. Experimental scope, revisit when oven sensor SKU is selected.
**Contexte** : aujourd'hui le boulanger saisit manuellement la production à la sortie du four. Une sonde IoT pourrait automatiser.
**Bénéfice attendu** : sonde connectée au four déclenche automatiquement la création d'une production_record à la fin du cycle de cuisson.
**Critère d'acceptation** :
- [ ] Spec hardware : sonde compatible MQTT / HTTP webhook.
- [ ] Edge Function `iot-oven-callback` qui reçoit l'événement et crée une production en `draft`.
- [ ] Le boulanger confirme (quantité réelle + waste) avant validation finale.
- [ ] Page `/settings/iot` : pairing four → recipe par défaut.
**Dépend de** : matériel IoT compatible + budget.
**Estimation** : XL
**Risques** : coût matériel + maintenance — viser le coût/bénéfice avant build.
**Notes** : V1 expérimental sur 1 four, généralisable si succès.

### TASK-15-011 — Coût-marge en temps réel par recette (alertes) [P3] [DONE]
**Status note (2026-05-14)** : Not delivered Session 13. V3 `calculate_recipe_cost` RPC (migration `…000062`) computes recipe cost on demand, but no per-product `target_gross_margin_pct` setting, no nightly recompute job, no `/production/margin-watch` page or alert workflow. Genuine gap — Session 14+ follow-up.
**Status note (2026-05-17)** : DONE — S15 livré : colonne `recipes.target_margin_pct` (migration `20260519000140`) + table `margin_alerts` (migration `…000141`) + RPC `recompute_recipe_margins_v1` qui appelle `_calculate_recipe_cost_walk` helper interne directement (pg_cron n'a pas d'`auth.uid()` — `DEV-S15-5.A-01` informational) + pg_cron quotidien (migration `…000142`) + page BO `MarginWatchPage` avec liste produits sous seuil + delta + hook `useMarginAlerts`.
**Contexte** : aujourd'hui le calcul de marge théorique est statique. Pas d'alerte quand le prix matière monte et dégrade la marge.
**Bénéfice attendu** : alerte automatique quand un changement de prix matière fait passer une recette sous le seuil de marge cible.
**Critère d'acceptation** :
- [ ] Setting `target_gross_margin_pct` par produit (par défaut 60%).
- [ ] Job quotidien recalcule la marge théorique de chaque produit avec recette active.
- [ ] Si marge < seuil : notification manager + dashboard alerte.
- [ ] Page `/production/margin-watch` : liste des produits sous seuil + delta vs précédent.
**Dépend de** : aucune.
**Estimation** : M
**Risques** : alertes trop fréquentes en cas de fluctuation marché — moyenne mobile 7 jours.
**Notes** : déclencheur d'arbitrage pricing automatique.

### TASK-15-012 — Yield calculator (forecast production) [P3] [BLOCKED]
**Status note (2026-05-14)** : Deferred per INDEX Wave 7 "Out of scope" line 1212 — "Forecasting ML | Session 20". Depends on TASK-15-002 (yield tracking, still TODO) to build reliable per-recipe ratios first. Session 20+ scope.
**Contexte** : aujourd'hui pas d'aide pour estimer "combien je produis pour servir N couverts demain ?". TASK-15-002 (yield tracking) mesure le réalisé, pas le prévisionnel.
**Bénéfice attendu** : recommandation prévisionnelle basée sur historique de consommation.
**Critère d'acceptation** :
- [ ] RPC `forecast_production_for_target(p_date, p_expected_covers)` : retourne pour chaque produit fini, qty à produire selon ratio historique.
- [ ] Page `/production/forecast` : saisir "80 couverts attendus demain" → tableau quantités recommandées par produit.
- [ ] Couplage avec TASK-15-006 (scheduling) pour pré-remplir le planning.
- [ ] Ajustement par jour de semaine (lundi ≠ samedi).
**Dépend de** : `TASK-15-002` (yield tracking pour ratios fiables).
**Estimation** : L
**Risques** : prévisions imprécises sur boutique récente — fallback "moyenne mobile 4 semaines" + override manuel.
**Notes** : socle pour ML demand forecast plus tard.

## Vue transversale

### Dépendances inter-tâches

```
TASK-10-007 (PRODUCTION_COGS account) ← prérequis comptable
    ↓
TASK-15-001 (sub-recipes F6) ← le plus critique
    ↓
TASK-15-002 (yield F5) → TASK-15-005 (versioning)
TASK-15-003 (UI ergonomie) → dépend TASK-15-001
TASK-15-004 (batch production) → dépend TASK-15-001
TASK-15-006 (scheduling) → dépend TASK-15-002
```

### Métriques de succès

| Métrique | Baseline 2026-04 | Cible Q3 2026 |
|---|---|---|
| Recettes avec sub-recipes | 0 (impossible) | 100% des produits composés (TASK-15-001) |
| Yield variance traqué | 0% | 100% productions (TASK-15-002) |
| Erreurs cost calc bakery | "10-20% imprécision" | < 5% (TASK-15-001 + 15-002) |
| Sessions production planifiées | 0% (réactif) | 70% (TASK-15-006) |

### Pitfalls connus

- `useProduction.create` (CLAUDE.md) déduit ingrédients ET incrémente stock fini — toute modification doit garder cette atomicité.
- `PRODUCTION_COGS` mapping → compte non-postable (Mary P1-1) → résolution NULL → JE perdu silencieusement. Fix TASK-10-007 prérequis.
- Sub-recipe cycle infini = freeze du moteur cost calc → trigger anti-cycle obligatoire (TASK-15-001).
- Snapshots `recipe_versions` doivent copier les noms (résister à suppression product), pas seulement les FK.

### Risques transversaux

- **Impact comptable** : TASK-15-001 + TASK-15-002 changent les COGS comptabilisés rétroactivement → coordonner avec comptable.
- **Migration data existante** : recettes existantes (flat) doivent rester valides après TASK-15-001 (option : marquer `is_legacy=true`, ne forcer la conversion qu'à l'édition).
- **Effort XL** : TASK-15-001 doit IMPÉRATIVEMENT être décomposé en 4 sous-tâches avant prise par un dev.

### Couverture audits

| Tâche | Source audit | Section |
|---|---|---|
| TASK-15-001 | 07-product-backlog-audit.md | F6 critique gap |
| TASK-15-002 | 07-product-backlog-audit.md | F5 important gap |
| TASK-15-003 | 05-uiux-design-audit.md | UX inégale back-office |
| TASK-15-004 | besoin métier matin fournée | — |
| TASK-15-005 | 04-reports-testing-audit.md | "Recipe Cost Trends MISSING" |
| TASK-15-006 | 07-product-backlog-audit.md | "Production scheduling not on backlog" |

## Session 15 → Session 16+ follow-ups

Deviations recorded during Session 15 execution (see `docs/workplan/plans/2026-05-15-session-15-INDEX.md` §13 for full context). Each line is a candidate Session 16+ backlog item, pending triage.

- **DEV-S15-2.A-01** — `business_config` flat columned vs key-value ; threshold stored as ratio in `production_yield_variance_threshold_pct`. UI auto-converts. (informational)
- **DEV-S15-2.B-01** — `RecipeVersionHistory` lacks per-version cost reconstruction (`recipe_versions.snapshot` has no `cost_price`). (low)
- **DEV-S15-3.A-01** — `search_ingredients_v1` `semi_finished` kind falls back to nesting depth ≥ 2 ; no `is_semi_finished` product flag exists. (low)
- **DEV-S15-3.A-02** — `pg_trgm` installed but no trigram indexes on `products.name` / `products.sku` ; picker ranking deferred. (low)
- **DEV-S15-3.B-01** — `audit_log` canonical schema uses `subject_table` / `subject_id` / `payload` ; `duplicate_recipe_v1` aligned. (informational)
- **DEV-S15-4.A-01** — `record_batch_production_v1` same-tx temp-table collision fixed via migration `20260519000103`. (informational)
- **DEV-S15-4.A-02** — `IngredientAggregatePreview` walks depth-1 only (multi-level preview deferred ; server-side cascade still full). (low)
- **DEV-S15-4.B-01** — `view_product_sales` not present on V3 ; `suggest_production_schedule_v1` aggregates directly from `order_items` join `orders`. (informational)
- **DEV-S15-4.B-02** — `production_schedules.recipe_id → products(id)` FK ambiguity resolved by client-side product-name post-fetch. (informational)
- **DEV-S15-5.A-01** — `recompute_recipe_margins_v1` calls `_calculate_recipe_cost_walk` internal helper directly (pg_cron has no `auth.uid()`). (informational)
- **DEV-S15-5.B-01** — `upsert_recipe_v1` body bumped (signature stable via trailing DEFAULTs) to accept baker percentage. (informational)
- **DEV-S15-5.B-02** — `BakerPreviewPanel.tsx` extracted from `RecipeEditor.tsx` to keep editor under 500 lines. (informational)
- **DEV-S15-5.C-01** — Receipt template + customer display allergen badge integration : **WONTFIX 2026-05-17 per user decision** (memory : `project_allergens_wontfix`). Aucun besoin métier identifié pour exposer les allergènes sur le ticket ou le display client — l'infra reste pour usage admin uniquement (BO badges + view récursive).
