# Design — Unifier les recettes sur l'onglet Recipe de la fiche produit

**Date :** 2026-06-21
**Branche :** `feat/unify-recipe-editor-into-product-tab` (base `master`)
**Statut :** design approuvé, en attente de plan

## Problème

Il existe aujourd'hui **plusieurs surfaces « recette »** dans le backoffice, ce qui porte à
confusion :

1. **Éditeur standalone** — menu *Stock → Recipes* (`/backoffice/inventory/recipes`).
   Composant `RecipeEditor` (`features/inventory-production/components/RecipeEditor.tsx`).
   Éditeur **riche** : sélecteur de produit, picker d'ingrédient autocomplete, drag-to-reorder,
   mode pourcentage boulanger, aperçu de coût live (coût + marge), dupliquer la recette,
   sous-onglets Edit / History.
2. **Onglet Recipe dans la fiche produit** — *Products → (produit) → onglet Recipe*
   (`/backoffice/products/:id?tab=recipe`). Composant `RecipeBuilder`
   (`features/recipes/components/RecipeBuilder.tsx`). Éditeur **plus simple** : `<select>`
   d'ingrédient brut, ajout/suppression seulement, unités codées en dur, présentation soignée
   (encart doré « Calculation base », cartes).
3. **Onglet Costing** dans la fiche produit — vue coût/marge + breakdown BOM lecture seule.
4. Vue lecture seule `/backoffice/inventory/recipes/:productId` (`RecipeDetailPage`, drill-down
   depuis les rapports) + rapports *Recipe Cost* (overview + timeline).

Deux **éditeurs** distincts (#1 et #2) font le même travail avec des capacités et un look
différents → confusion pour l'utilisateur.

## Objectif

Une **seule** page d'édition de recette : l'onglet **Recipe** de `/backoffice/products/:id`.
On supprime l'éditeur standalone. **100 % front** — aucune migration, aucun changement
DB / RPC / regen types (toutes les RPC nécessaires existent déjà :
`list_recipes_v1`, `upsert_recipe_v1`, `deactivate_recipe_v1`, `reorder_recipe_rows_v1`,
`search_ingredients_v1`, `convert_baker_recipe_to_absolute_v1`, le toggle baker mode,
`list_units_v1`).

## Décisions de cadrage (validées avec l'owner)

- **Q1 — Fonctions riches :** *tout migrer* vers l'onglet. Aucune perte fonctionnelle
  (reorder, % boulanger, coût live, dupliquer, picker autocomplete, history).
- **Q2 — Ancien menu :** *supprimer l'entrée sidebar + rediriger la route*
  `/backoffice/inventory/recipes` → liste Products (ne pas casser les liens/favoris existants).
- **Q3 — Onglet Costing :** *garder séparé*. Recipe = édition + coût live de la recette ;
  Costing = vue financière globale (WAC, marge, correction de prix). Rôles distincts.
- **Q4 — Présentation :** *garder le look de l'onglet actuel et y greffer les fonctions*
  (encart doré + cartes conservés), plutôt que d'embarquer l'éditeur standalone tel quel.

## Ce qui change

### 1. L'onglet Recipe devient l'éditeur complet (`RecipeBuilder` enrichi)

On conserve la présentation actuelle de `RecipeBuilder` (encart doré « Calculation base »,
cartes) et on y greffe les fonctions de l'éditeur riche, **en réutilisant les sous-composants
et hooks qui existent déjà** :

- **Picker d'ingrédient autocomplete** : `IngredientPicker` (`@breakery/ui`) +
  `search_ingredients_v1` → remplace le `<select>` brut `materialOptions`. Gère matières
  premières / semi-finis / sous-recettes, avec aperçu de coût (`costGraph`).
- **Dropdown d'unité piloté par le registre d'unités** : `useUnits` + `eligibleRecipeUnits`
  → remplace la liste codée en dur `UNIT_OPTIONS = ['g','kg','mg','ml','l','pcs']`, filtrée par
  la dimension du matériau sélectionné.
- **Drag-to-reorder** des lignes : `RecipeRowSortable` + `useReorderRecipeRows`
  (`@dnd-kit`). La rangée sortable doit reprendre le style « pilule » des lignes actuelles de
  `RecipeBuilder` (détail à régler au plan : adapter `RecipeRowSortable` ou créer une variante).
- **Aperçu de coût live** : `RecipeCostPreviewCard` (coût + marge + badge recompute) en haut
  de l'onglet. La ligne « Material cost / unit » redondante du `tfoot` actuel est retirée
  (le total quantité + nombre d'ingrédients reste).
- **Mode pourcentage boulanger** : `BoulangerModeToggle` + champ farine cible +
  `BakerPreviewPanel` (`useBakerRecipeMode`, `useToggleBakerMode`,
  `useConvertBakerToAbsolute`).
- **Dupliquer la recette** : `RecipeDuplicateModal` → au succès, navigation vers
  `/backoffice/products/<nouveau produit>?tab=recipe` (via react-router `useNavigate`,
  au lieu du callback `onProductChange` du standalone).
- **Historique des versions** : sous-onglets *Edit / History* à l'intérieur de l'onglet Recipe
  (`RecipeVersionHistory`), comme le standalone.

`RecipeBuilder` reçoit déjà `productId` / `productName` / `productUnit` depuis la fiche produit
— **pas de sélecteur de produit** dans l'onglet (on est déjà dans le contexte d'un produit).

### 2. Suppression de l'éditeur standalone

- **Supprimés :**
  - `apps/backoffice/src/pages/inventory/RecipeEditorPage.tsx`
  - `apps/backoffice/src/features/inventory-production/components/RecipeEditor.tsx`
  - Les sous-composants et hooks qu'utilisait `RecipeEditor` **restent** (réutilisés par
    l'onglet) : `RecipeCostPreviewCard`, `RecipeDuplicateModal`, `RecipeRowSortable`,
    `BoulangerModeToggle`, `BakerPreviewPanel`, `RecipeVersionHistory`, et les hooks
    `useReorderRecipeRows`, `useBakerRecipeMode`, `useUnits`, `useFinishedProducts`, etc.
- **Route :** `/backoffice/inventory/recipes` → `<Navigate to="/backoffice/products" replace />`.
- **Sidebar :** entrée *Stock → Recipes* (`Sidebar.tsx`) retirée.

### 3. Inchangé (hors scope, confirmé)

- Onglet **Costing** de la fiche produit (séparé).
- Vue lecture seule `/backoffice/inventory/recipes/:productId` (`RecipeDetailPage`) — toujours
  atteinte par les drill-down rapports.
- Rapports *Recipe Cost* (overview + timeline).

## Découpage / responsabilités

`RecipeBuilder` (`features/recipes/`) reste le **seul** composant éditeur de recette. Il importe
les briques de `features/inventory-production/` (picker integration, sortable row, baker
toggle/preview, cost-preview card, duplicate modal, version history) et les hooks associés.
Aucune logique DB nouvelle ; toutes les mutations passent par les hooks RPC existants.

Frontières :
- **Entrée :** `productId`, `productName`, `productUnit`, `readOnly?` (props, depuis la fiche
  produit).
- **Sorties :** mutations RPC (upsert / deactivate / reorder / toggle baker / duplicate).
- **Dépendances :** `@breakery/ui` (IngredientPicker, Tabs, Card…), `@breakery/domain`
  (`bomCost`, types), hooks `features/inventory-production`.

## Alternative écartée

Embarquer `RecipeEditor` tel quel dans l'onglet (déplacer le composant riche complet, juste
masquer son sélecteur de produit). Plus rapide, zéro perte de fonction, mais remplace la
présentation actuelle de l'onglet (perte de l'encart doré et des cartes). **Rejeté à la Q4.**

## Tests (front-only)

- Supprimer les tests de `RecipeEditor` / `RecipeEditorPage`.
- Étendre les smokes de `RecipeBuilder` : picker autocomplete, reorder, mode baker, duplicate
  (navigation au succès), sous-onglet history, dropdown d'unité piloté par le registre.
- Smoke de la **redirection** `/backoffice/inventory/recipes` → liste Products.
- Ajuster le test sidebar (entrée *Recipes* retirée — décompte / présence).
- `pnpm --filter @breakery/app-backoffice typecheck` + sweep BO vert.

## Hors scope / suite éventuelle

- Fusion de l'onglet Costing dans Recipe (volontairement séparés).
- Refonte de la vue lecture seule `RecipeDetailPage`.
- Tout changement DB / RPC.
