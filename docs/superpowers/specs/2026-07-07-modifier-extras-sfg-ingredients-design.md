# Modifier extras — semi-finished products in the ingredient picker

**Date:** 2026-07-07 · **Scope:** Backoffice UI only (zéro migration, money-path intouchée)

## Contexte / besoin

Le propriétaire veut des « extras » payants par produit (ex. Chicken Baguette Sandwich →
Extra : Mozzarella +20 000, Chicken +30 000), proposés automatiquement au POS quand le
produit est sélectionné.

**Constat d'audit :** la feature existe déjà intégralement via `product_modifiers` :

- BO fiche produit → panneau *Modifiers* : groupe « Extra » `multi_select` non requis,
  options avec `price_adjustment`, attaché au produit ou à la catégorie.
- POS : `ProductTapHandler` ouvre automatiquement le `ModifierModal` dès qu'un produit a
  des groupes ; multi-select supporté ; suppléments refacturés serveur
  (`_resolve_line_price_v1`, money-path v17).
- Déduction stock par option : `product_modifiers.ingredients_to_deduct` (JSONB), résolu
  et déduit par `_resolve_modifier_ingredients_v1` dans la money-path — **sans filtre de
  type produit** (display-aware, track_inventory-aware).

**Le seul gap** (remonté par le propriétaire) : dans l'éditeur BO, le picker
`OptionIngredientPicker` ne propose **pas les produits semi-finis (SFG)** comme
ingrédients à déduire. Cause : il réutilise `useAllProductsForPO`, restreint depuis S46 à
`categories.category_type = 'raw_material'` (sémantique achats/PO, étrangère aux
modifiers). Un extra « mozzarella préparée » (SFG produit en interne, stock via
production, coût = WAC) est donc inconfigurable alors que le serveur le déduirait
correctement.

## Décision (approuvée par le propriétaire, 2026-07-07)

**Approche A — fix UI pur.**

1. **Nouveau hook** `useDeductibleIngredientProducts`
   (`apps/backoffice/src/features/products/hooks/`) : produits actifs non supprimés qui
   sont **raw material** (`categories.category_type='raw_material'`) **OU semi-finis**
   (`products.is_semi_finished = true`), avec `id, sku, name, unit, cost_price,
   unitOptions` (base ∪ `product_unit_alternatives`) + flag `is_semi_finished`.
   Implémentation : deux requêtes en parallèle (le OR mixte produit/catégorie n'est pas
   exprimable en un seul filtre PostgREST), merge dédupliqué par id, tri par nom. La
   shape reste structurellement un `ModifierCostMaterial` (cost du picker inchangé —
   le WAC des SFG alimente le coût matière affiché).
2. **`OptionIngredientPicker`** bascule sur ce hook ; le `<select>` groupe les produits
   en deux `<optgroup>` « Raw materials » / « Semi-finished ».
3. **`useAllProductsForPO` inchangé** — le PO editor doit rester raw-only.
4. **Tests** : smoke test du picker mis à jour (mock du nouveau hook, un SFG apparaît et
   est sélectionnable, coût matière toujours correct).

Approches écartées : réutiliser l'autocomplete `search_ingredients_v1` (fetch
supplémentaire pour les unités alternatives, plus lourd pour le même résultat) ; élargir
`useAllProductsForPO` (polluerait le PO editor avec des SFG non achetables).

## Comportement d'exploitation à connaître

Un SFG tracké à stock 0 bloque la vente de l'extra (`insufficient stock`, P0002) comme
tout ingrédient, sauf `allow_negative_stock`. C'est voulu : l'extra ne se vend que si le
semi-fini est produit/en stock.

## Hors scope

- Aucun changement DB / RPC / money-path.
- Produits finis comme ingrédients d'extra (non demandé).
- Upsell au-delà du modal existant.
