---
name: products-catalog
description: >-
  Catalogue Breakery : produits, variantes liées, catégories, unités, stations, modificateurs, SKU et vitrine. Pour modifier ou auditer le catalogue BO/POS. Mouvements de stock et recettes : stock-management.
---

# Products Catalog — The Breakery ERP

Vérifier l’allowlist et les champs ignorés dans la RPC réellement appelée. Préserver XOR des variantes, anti-imbrication et unicité SKU ; les stocks et coûts ont leurs chemins dédiés.

## Lecture proportionnée

Les règles d’AGENTS.md restent applicables. Les liens ci-dessous sont conditionnels : ne pas charger tout le dossier ni tous les skills voisins. Réutiliser les lectures déjà faites dans la session ; rouvrir si le code ou le périmètre a changé.

| Quand lire | Ressource |
|---|---|
| Pour le contrat, le parcours ou la surface concernée ; avant toute modification de sa logique. | [modèle, contrats et repères](references/model.md) |
| Avant une modification et avant de conclure : sélectionner les contrôles du parcours, puis exécuter les tests requis par AGENTS.md. | [contrôles et sources](references/verification.md) |

## Mental model — variants (architecture "Linked-Products")

```
products table
─────────────────────────────────────────────────────────
STANDALONE     parent_product_id = NULL, variant_label = NULL, variant_axis = NULL
               → normal product, vendu directement

PARENT         parent_product_id = NULL, variant_label = NULL, variant_axis = NULL
               → groupement logique, NEVER sold directly, ne se vend pas
               → POS affiche modal variant picker au tap
               → SKU = "{original_sku}-PARENT"

VARIANT        parent_product_id IS NOT NULL, variant_label IS NOT NULL, variant_axis IS NOT NULL
               → enfant du parent, propre SKU/prix/stock, 1 niveau max
               → sort_order géré par la famille reorder_variants (paliers 10/20/30…)
```

### Colonnes variant (ajoutées migration `20260524002210`, +1 depuis init)

| Colonne | Type | Nullable | Contrainte |
|---|---|---|---|
| `parent_product_id` | UUID REFERENCES products(id) | YES | XOR |
| `variant_label` | TEXT | YES | XOR, UNIQUE (parent_id, label) partial |
| `variant_axis` | `variant_axis_type` | YES | XOR |
| `variant_sort_order` | INTEGER NOT NULL DEFAULT 0 | NO | — |

**ENUM `variant_axis_type`** (migration `20260524002129`): `'flavor' | 'size' | 'format'`

### Invariants critiques (vérifiés sur V3 dev `ikcyvlovptebroadgtvd`)

1. **XOR CHECK `products_variant_xor`** — les 3 cols `(parent_product_id, variant_label, variant_axis)` sont soit ALL NULL (standalone/parent) soit ALL NOT NULL (variant). Un soft-delete doit NULL-er les 3, pas juste `parent_product_id` (bug corrigé corrective `20260524012658`).
2. **Anti-self CHECK `products_variant_no_self`** — `parent_product_id != id`.
3. **Trigger `tr_products_variant_no_nesting`** (fonction `enforce_variant_no_nesting`, `BEFORE INSERT OR UPDATE OF parent_product_id`) — 1 niveau max : (a) le parent ne doit pas être lui-même un variant ; (b) un produit avec des enfants ne peut pas devenir un variant. Errcode `P0004`.
4. **`products.sku` UNIQUE GLOBAL** (pas partial) — le parent créé par la famille `convert_product_to_parent` suffix son SKU en `"-PARENT"`. La dissolution (famille `convert_parent_to_standalone`) hard-delete le parent pour libérer le SKU orphelin.

---

## Pièges connus

| Piège | Détail | Correctif |
|---|---|---|
| XOR partial-NULL sur soft-delete | La famille `delete_variant`, ou du code custom, qui NULL-e seulement `parent_product_id` → violation CHECK 23514 | NULL-er les 3 cols + reset `variant_sort_order=0` (pattern corrective `20260524012658`) |
| SKU collision sur "-PARENT" | Si un produit "Croissant-PARENT" existe déjà, `convert_product_to_parent` lève 23505 | Pre-check côté client (hook BO) + correctif `20260524005402` ; `create_variant` a le sien depuis `20260601183121` |
| `cost_price` ignoré dans update | `update_product` ne patch pas `cost_price` — silencieusement ignoré (dans `ignored_fields`). Passer par `update_cost_price` | Lire `ignored_fields` dans la réponse RPC |
| Champ mort écrit sans erreur | Un champ hors allowlist (`tax_inclusive`, `unit`, `product_type`, `is_test`… dans un patch d'update) **ne lève rien** : il ressort en `ignored_fields` et le formulaire paraît avoir enregistré | Toujours assert sur `ignored_fields` dans les tests de hook, et recouper l'allowlist dans la migration vivante avant d'ajouter un champ au formulaire |
| `reorder_categories` ambiguous id | Correctif `20260520102709` — sans lui, la query `WHERE id = ANY(...)` lève 42702 | Migration déjà appliquée, ne pas rééditer la fonction sans bump vN+1 |
| Gate catégorie supposé | Il n'y a pas de `categories.write` : create / update+reorder / delete ont **trois** codes distincts | Lire le `has_permission(...)` de la migration vivante avant de câbler un `PermissionGate` |

---

## Qualité de restitution

Répondre d’abord au problème demandé. Distinguer fait observé, intention métier et hypothèse ; ancrer les constats dans le code lu ou le résultat mesuré. Un ancien relevé n’est pas une preuve actuelle. Donner impact, correction ou décision attendue, vérification effectuée et limite éventuelle ; ne pas remplir des rubriques sans résultat utile. Une consigne de skill n’élargit pas l’autorisation donnée par Mamat.
