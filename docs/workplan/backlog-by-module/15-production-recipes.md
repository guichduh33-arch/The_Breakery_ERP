# Travail — Production & Recipes

> Last updated: 2026-05-03
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

### TASK-15-001 — Sub-recipes (F6) — composition récursive + cost cascade [P0] [TODO]
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

### TASK-15-002 — Yield tracking (F5) — expected vs actual production [P1] [TODO]
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

### TASK-15-003 — Recipes UI CRUD ergonomique [P2] [TODO]
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

### TASK-15-004 — Batch production (multi-recipe en 1 opération) [P2] [TODO]
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

### TASK-15-005 — Recipe versioning (historique modifs) [P2] [TODO]
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

### TASK-15-006 — Production scheduling (planning fournées) [P2] [TODO]
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
