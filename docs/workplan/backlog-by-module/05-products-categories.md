# Travail — Products & Categories

> Last updated: 2026-05-03
> Référence : `docs/v2-reference/04-modules/05-products-categories.md` (à créer)
> Audits sources : `03-code-quality-schema-audit.md`, `05-uiux-design-audit.md`, `07-product-backlog-audit.md`

## Objectifs du module

1. **Sub-recipes** (F6) : croissant dough = sub-recipe utilisée dans pain au choco, almond croissant, etc. Critère : recipe cost cascade automatiquement.
2. **Pricing tiers UX claire** : retail / wholesale / discount % / category custom — un manager non-tech doit comprendre quel prix s'applique. Critère : badge visuel + tooltip dans product form.
3. **Modifiers UX** : groupement set radio (1 choix) vs multi-select (N choix) clair. Critère : preview en temps réel dans product edit.
4. **Bulk operations** : éditer 50 prix en 5 clics, archiver une catégorie complète. Critère : actions multi-selection sur les listes products.

---

## Tâches

### TASK-05-001 — F6 Sub-recipes (recettes composées) [P0] [TODO]
**Contexte** : Un bakery a des recettes composées (croissant dough → 5 produits finis). Sans support, recipe costing inexact et production planning manuel. Source : `docs/audit/07-product-backlog-audit.md§Critical-3`.
**Critère d'acceptation** :
- [ ] Schema : `recipes` peut référencer une autre `recipe` comme « ingredient » (auto-FK self).
- [ ] Récursion limitée à 5 niveaux (anti-cycle) + check `BEFORE INSERT/UPDATE`.
- [ ] Cost cascade : changement coût matière première propagé via recompute trigger ou matérialized view.
- [ ] UI recipe form : ajouter sub-recipe avec quantité, unité.
- [ ] Production records : déduire les ingredients récursivement.
- [ ] Tests : recipe A (50% B + 50% raw) + recipe B (100% raw) → cost A = cost B/2 + raw cost.
**Fichiers concernés** : nouvelle migration sub-recipes, `src/hooks/inventory/useProduction.ts`, `src/components/products/RecipeForm.tsx`, `src/services/products/recipeCostCalculator.ts` (à créer).
**Dépend de** : aucune
**Estimation** : `XL`
**Risques** : Cycle infini si validation insuffisante. Performance recompute si beaucoup de niveaux. Atomicité des updates.

### TASK-05-002 — Pricing tiers UI clarification [P2] [TODO]
**Contexte** : 4 sources de prix : `retail` (standard), `wholesale` (wholesale_price), `discount_percentage`, `custom` (product_category_prices). UX confuse pour saisir/comprendre. Source : `CLAUDE.md` Business Rules + revue UX.
**Critère d'acceptation** :
- [ ] Section dédiée « Pricing » dans product form avec tabs : Retail / Wholesale / Custom by Category.
- [ ] Affichage matriciel : « Pour customer category X, prix = Y, source = Z (retail / custom / discount %) ».
- [ ] Preview live : quel prix verra un customer avec catégorie « Bronze tier 5% » ?
- [ ] Validation : wholesale ≤ retail (warning, pas blocant).
- [ ] Tooltip explicatif sur chaque champ.
**Fichiers concernés** : `src/components/products/ProductForm.tsx`, `src/components/products/ProductPricingMatrix.tsx` (à créer), `src/services/products/pricingResolver.ts`.
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : Trop d'options visibles peut effrayer. Cacher derrière un toggle « Advanced pricing ».

### TASK-05-003 — Modifiers groupés (set radio vs multi-select clair) [P2] [TODO]
**Contexte** : `product_modifier_groups` a un `group_type` (radio / multi). UI actuelle semble peu indiquer la distinction au manager qui crée les groupes. Inferred from code review + `database.enums.ts` `ModifierGroupType`.
**Critère d'acceptation** :
- [ ] UI création modifier group : radio explicite « Single choice » vs « Multiple choice ».
- [ ] Preview visuel : « Cashier verra: ○ Vanilla ○ Chocolate (single) » vs « ☐ Extra cheese ☐ Bacon (multi) ».
- [ ] Min/max selection visible (1-1 pour single, 0-N pour multi).
- [ ] Validation : ajouter au moins 1 option avant save.
- [ ] Migration : audit des groupes existants pour cohérence type vs min/max.
**Fichiers concernés** : `src/components/products/ModifierGroupForm.tsx`, `src/components/pos/modals/ModifierModal.tsx` (preview).
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : Modifier les groupes existants peut casser commandes en cours. Modale informative.

### TASK-05-004 — Combo builder UX [P2] [TODO]
**Contexte** : Combos existent (`product_combos`, `product_combo_groups`, `product_combo_group_items`) mais l'UI de construction n'est pas évaluée dans les audits. Vraisemblablement complexe pour un bakery owner. Inferred from schema complexity.
**Critère d'acceptation** :
- [ ] Wizard 3 étapes : (1) info combo + prix, (2) groupes (ex : « Boisson », « Viennoiserie »), (3) items par groupe + quantités.
- [ ] Drag & drop pour réordonner groupes et items.
- [ ] Calcul auto saving vs prix individuel : « Combo 50k vs 60k individuel = -17 % ».
- [ ] Preview KDS dispatch : « Boisson partira à station Bar, Viennoiserie à Kitchen ».
- [ ] Tests : créer un combo end-to-end via UI.
**Fichiers concernés** : `src/components/products/ComboWizard.tsx` (à créer), `src/hooks/products/useCombo.ts`.
**Dépend de** : aucune
**Estimation** : `L`
**Risques** : Refactor d'une UI existante peut perdre données si mal géré. Backup combos avant migration.

### TASK-05-005 — Image management (uploads, optimisation) [P2] [TODO]
**Contexte** : Images produits servent dans POS grid, mobile, customer display. Pas d'upload UI documenté, pas d'optimisation WebP/srcset. T6 backlog. Source : `docs/audit/07-product-backlog-audit.md§Nice-to-have-11`.
**Critère d'acceptation** :
- [ ] Bucket Supabase Storage `product-images` avec RLS write authenticated.
- [ ] UI upload : drag & drop, crop ratio 4:3, preview avant save.
- [ ] Conversion WebP côté serveur (Edge Function ou Supabase image transformations si dispo).
- [ ] srcset multi-tailles (200w, 400w, 800w).
- [ ] Lazy loading déjà OK (cf. Sprint 1 S5).
- [ ] Cleanup : delete image si product hard-deleted.
**Fichiers concernés** : nouveau Edge Function `process-product-image`, `src/hooks/products/useProductForm.ts:images`, `src/components/products/ProductImageUploader.tsx` (à créer).
**Dépend de** : aucune
**Estimation** : `L`
**Risques** : Coût storage si pas de cleanup. Quota Supabase. Définir politique max-size (ex : 2 MB).

### TASK-05-006 — Category drag & drop reorder [P3] [TODO]
**Contexte** : Catégories ont un `display_order` (probable). Pas de UI DnD. Manager doit éditer les ordres manuellement. Inferred from code review.
**Critère d'acceptation** :
- [ ] Page `/categories` : liste DnD via @dnd-kit.
- [ ] Save automatique après drop (debounce 1s).
- [ ] Indicateur visuel pendant le save (spinner).
- [ ] Test : reorder 5 catégories, refresh → ordre conservé.
**Fichiers concernés** : `src/pages/products/CategoriesPage.tsx`, `src/hooks/products/useCategories.ts`.
**Dépend de** : aucune
**Estimation** : `S`
**Risques** : Aucun.

### TASK-05-007 — Bulk operations (price update, archive) [P2] [TODO]
**Contexte** : Pour un catalogue de centaines de produits, éditer 1 par 1 est inefficace. Pas de bulk UI. Inferred from product backlog.
**Critère d'acceptation** :
- [ ] Listes products : checkbox multi-select + bouton « Bulk actions ».
- [ ] Actions disponibles : update price (% ou absolute), archive, change category, change tax_rate.
- [ ] Preview avant apply : « Vous allez modifier 47 produits, prix moyen passe de 25k à 28k ».
- [ ] Audit log : enregistrer chaque bulk action avec user, count, type, timestamp.
- [ ] Permission `products.bulk_edit` requise.
**Fichiers concernés** : `src/pages/products/ProductsPage.tsx`, `src/components/products/BulkActionsModal.tsx` (à créer), nouvelle migration permission.
**Dépend de** : `TASK-01-005` (granularité permissions)
**Estimation** : `L`
**Risques** : Erreur catastrophique si mauvaise sélection (ex : %, archive 200 produits). Confirmation modale obligatoire avec preview.

### TASK-05-008 — Migration `database.enums.ts` `TItemStatus` ajout `cancelled` [P2] [TODO]
**Contexte** : Manual enum dans `src/types/database.enums.ts` manque `'cancelled'` que le DB enum a. Code peut mal typer. Source : `docs/audit/03-code-quality-schema-audit.md§A3`.
**Critère d'acceptation** :
- [ ] Lancer `/gen-types` pour rafraîchir `database.generated.ts`.
- [ ] Ajouter `'cancelled'` à `TItemStatus` dans `database.enums.ts` (ou supprimer le manual et utiliser `Enums<>`).
- [ ] Build + lint sans erreurs.
- [ ] Couvrir `'cancelled'` dans les switch existants (sale trigger, KDS, reports).
- [ ] Tests : commande avec item cancelled traité correctement.
**Fichiers concernés** : `src/types/database.enums.ts`, `src/types/database.generated.ts`.
**Dépend de** : aucune
**Estimation** : `S`
**Risques** : Switch exhaustif TS lèvera erreur sur les switch incomplets — c'est l'effet désiré, à fixer au cas par cas.

---

## Notes transverses

- **Pricing canonique** : `get_customer_product_price(product_id, category_slug) → DECIMAL` (cf. `CLAUDE.md`). Toujours passer par cette function pour résoudre un prix runtime.
- **F1 Expiry** dépend de la table products (ajouter `default_shelf_life_hours`) — cf. tâches inventory `TASK-06-001`.
- **F5 Yield** liée aux recipes (ratio expected vs actual) — cf. `TASK-06-XXX` à venir.
- **B2B pricing** : tables `b2b_price_lists` et `b2b_price_list_items` existent mais pas utilisées en UI (cf. `docs/audit/03-code-quality-schema-audit.md§A6`). Décision : implémenter ou supprimer ?
