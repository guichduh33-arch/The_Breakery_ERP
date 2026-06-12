# Session 41 — Spec : Import / Export du catalogue (produits + recettes)

**Date** : 2026-06-12
**Statut** : validé par l'utilisateur (brainstorming 2026-06-12)
**Base** : `master` post-S40 (PR #73) + bump turbo `a997a86`

---

## 1. Contexte & objectif

L'utilisateur dispose de sa base réelle (ingrédients, produits, recettes, variantes) dans des fichiers Excel et veut la charger dans la base V3 dev pour tester l'ERP avec de vraies données. Aucun outillage d'import n'existe aujourd'hui (seul `supabase/seed.sql`, 8 produits de démo).

Livrable : un onglet **« Import / Export »** dans la page Products du backoffice, permettant de :
1. télécharger un **template Excel** (6 onglets) calé sur le schéma V3 ;
2. **exporter** le catalogue complet existant dans ce même format (round-trip : exporter → corriger dans Excel → ré-importer) ;
3. **importer** un classeur rempli, avec prévisualisation dry-run des erreurs puis import atomique.

## 2. Périmètre

**Inclus** : catégories, ingrédients/matières premières, produits finis et semi-finis, unités alternatives + contextes d'unités (conversion), variantes (parent/variant), recettes (BOM, y compris semi-finis imbriqués), photo par URL.

**Hors scope (S42+)** : allergènes, modifiers, sections, combos, promotions, clients, import d'images binaires (seulement `image_url`), import de stock initial / lots, import asynchrone gros volumes (EF), parsing CSV (xlsx uniquement).

## 3. Template Excel — 6 onglets

Références croisées par **SKU** et **nom de catégorie**, jamais d'UUID. Colonnes marquées `*` = requises. Le template vide est généré client-side (1 ligne d'exemple par onglet) depuis `templateDefinition.ts` — la même définition que le parseur et l'export (source de vérité unique).

### Onglet `Categories`
| Colonne | Type | Règles |
|---|---|---|
| `name`* | texte | unique dans le fichier ; upsert par nom (slug auto) |
| `dispatch_station` | kitchen \| barista \| bakery \| none | défaut `none` |
| `sort_order` | entier | défaut auto (MAX+10) |

### Onglet `Ingredients` (matières premières)
| Colonne | Type | Règles |
|---|---|---|
| `sku`* | texte | unique GLOBAL (table `products` partagée) |
| `name`* | texte | |
| `unit`* | texte | unité de base (kg, g, L, mL, pcs…) |
| `cost_price`* | nombre | prix d'achat par unité de base |
| `category` | texte | défaut : catégorie « Ingrédients » auto-créée |
| `min_stock_threshold` | nombre | optionnel |
| `shelf_life_hours` | entier | optionnel |
| `purchase_unit` / `recipe_unit` / `opname_unit` / `sales_unit` | texte | contextes ; doivent être l'unité de base ou un code de l'onglet Units ; vide = unité de base |

Importés comme rows `products` avec `visible_on_pos=false`, `available_for_sale=false`, `track_inventory=true`.

### Onglet `Products` (finis **et semi-finis**)
| Colonne | Type | Règles |
|---|---|---|
| `sku`* | texte | unique GLOBAL |
| `name`* | texte | |
| `category`* | texte | doit exister (fichier ou DB) |
| `unit` | texte | défaut `pcs` |
| `retail_price`* | nombre | |
| `wholesale_price` | nombre | optionnel |
| `description` | texte | optionnel |
| `image_url` | URL | optionnel |
| `visible_on_pos` | bool | défaut TRUE — **FALSE pour les semi-finis** |
| `is_favorite` | bool | défaut FALSE |
| `shelf_life_hours` | entier | optionnel |
| contextes d'unités ×4 | texte | comme Ingredients |

Pas de `cost_price` (calculé par la chaîne recettes/WAC). `is_semi_finished` maintenu par le trigger existant (S16).

### Onglet `Units` (unités alternatives)
| Colonne | Type | Règles |
|---|---|---|
| `product_sku`* | texte | doit exister (Ingredients, Products ou DB) |
| `code`* | texte | ex : g, sachet, boîte |
| `factor_to_base`* | nombre > 0 | 1 `code` = factor × unité de base |
| `tags` | liste CSV ⊆ {purchase, recipe, sales} | défaut : les 3 |

L'ordre des lignes par produit donne `display_order`. Sémantique REPLACE (comme `set_product_units_v1`) : au ré-import, les alternatives absentes du fichier sont soft-deletées.

### Onglet `Variants`
| Colonne | Type | Règles |
|---|---|---|
| `parent_sku`* | texte | doit exister dans Products (pas une variante — anti-nesting) |
| `variant_axis`* | flavor \| size \| format | même axe pour toutes les variantes d'un parent |
| `variant_label`* | texte | ex : « Amande », « Grand » |
| `sku`* | texte | unique GLOBAL |
| `retail_price` | nombre | défaut : hérite du parent |
| `image_url` | URL | défaut : hérite du parent |

L'ordre des lignes donne `variant_sort_order` (10/20/30…). Invariant XOR S27c respecté.

### Onglet `Recipes` (1 ligne par ingrédient de recette)
| Colonne | Type | Règles |
|---|---|---|
| `product_sku`* | texte | produit fini ou semi-fini |
| `material_sku`* | texte | ingrédient OU semi-fini (imbrication) |
| `quantity`* | nombre > 0 | |
| `unit` | texte | défaut : unité de base du matériau ; doit être convertible (base ou alternative déclarée) |
| `notes` | texte | optionnel |

Un produit présent dans Recipes voit sa BOM **remplacée intégralement** par les lignes du fichier. Le trigger `recipe_versions` snapshot automatiquement (historique conservé). Détection de cycle obligatoire (garde anti-cycle S15).

## 4. Contrat payload JSONB

Le front construit :

```jsonc
{
  "categories":  [{ "name": "...", "dispatch_station": "none", "sort_order": null }],
  "ingredients": [{ "sku": "...", "name": "...", "unit": "kg", "cost_price": 12000, ... }],
  "products":    [{ "sku": "...", "name": "...", "category": "...", "retail_price": 25000, ... }],
  "units":       [{ "product_sku": "...", "code": "g", "factor_to_base": 0.001, "tags": ["recipe"] }],
  "variants":    [{ "parent_sku": "...", "variant_axis": "flavor", "variant_label": "...", "sku": "...", ... }],
  "recipes":     [{ "product_sku": "...", "material_sku": "...", "quantity": 0.12, "unit": "kg", "notes": null }]
}
```

`export_catalog_v1()` renvoie **exactement ce shape** (symétrie import ⇄ export).

## 5. RPC `import_catalog_v1(p_payload JSONB, p_dry_run BOOLEAN, p_idempotency_key UUID)`

SECURITY DEFINER. Retour : `{ valid BOOLEAN, errors JSONB[], summary JSONB, idempotent_replay BOOLEAN }`.

- **Ordre de traitement** : categories → ingredients → products → units → variants → recipes.
- **Validation exhaustive d'abord** (jamais fail-fast), erreurs collectées en `{sheet, row, sku, code, message}` :
  - catégorie inconnue (ni fichier ni DB) ; `parent_sku` inexistant ou lui-même variante ;
  - conflit avec l'existant : SKU en DB déjà variante alors que le fichier le déclare standalone (et inversement) ;
  - matériau de recette inconnu ; `quantity <= 0` ; unité de recette non convertible ;
  - `factor_to_base <= 0` ; contexte d'unité référençant une unité non déclarée ;
  - **cycle de recettes** (A → B → A, profondeur quelconque) ;
  - axe de variante invalide ; axes mixtes sur un même parent.
- **`p_dry_run=true`** : validation + summary `{<type>: {create: n, update: n}}`, **zéro écriture**.
- **`p_dry_run=false`** : même validation ; si erreurs → retour sans écriture ; sinon écritures dans la transaction de la RPC (atomique, tout ou rien). **Upsert par SKU** (catégories par nom). Recettes : delete logique des lignes BOM actuelles + insert des nouvelles. Note : le trigger `tr_snapshot_recipe_version` est FOR EACH ROW (S15 D4) — un remplacement de BOM de N lignes produit plusieurs snapshots `recipe_versions`, comportement documenté acceptable pour l'audit.
- **Idempotency (flavor 2 S25)** : table dédiée `catalog_import_idempotency_keys` (PK = key, stocke le rapport JSONB) ; replay renvoie le rapport du 1er import avec `idempotent_replay: true` ; race gérée par catch `unique_violation` + re-read. Le dry-run n'écrit PAS de clé.
- **Gate** : permission `catalog.import` (seed MANAGER/ADMIN/SUPER_ADMIN). `audit_logs` action `catalog.imported` avec summary en metadata (pas en dry-run).
- **REVOKE pair canonique S25/S40** : REVOKE PUBLIC + anon + `ALTER DEFAULT PRIVILEGES` (3 lignes complètes — leçon P11 S40).

## 6. RPC `export_catalog_v1()`

SECURITY DEFINER lecture seule. Renvoie le payload §4 depuis l'état courant de la DB : tous les produits actifs (ingrédients = `visible_on_pos=false AND available_for_sale=false` ; variantes via `parent_product_id` ; le reste en Products), unités alternatives actives + contextes, BOM actives. Gate : permission `catalog.export` (mêmes rôles — l'export contient les `cost_price`). REVOKE pair canonique. Pas d'idempotency (lecture seule).

## 7. UI Backoffice — onglet « Import / Export »

- La page Products gagne une barre d'onglets : **Products** (liste actuelle inchangée) / **Import / Export** (route `/backoffice/products/import-export`, lazy, `PermissionGate` `catalog.import`). Pas de nouvelle entrée sidebar.
- **Le fichier ne quitte jamais le navigateur** : parsing client-side via SheetJS (`xlsx`, lazy-import), seul le JSON part vers la RPC.
- **3 zones** : Template (téléchargement du classeur vide) · Export (bouton → `export_catalog_v1` → conversion `.xlsx` côté client) · Import (stepper 3 étapes : upload → dry-run → import).
- **Stepper import** :
  1. *Upload* : drag & drop `.xlsx` ; erreurs de **structure** affichées immédiatement (onglet manquant, colonne requise absente, cellule non numérique, SKU dupliqué dans le fichier — y compris cross-onglets Ingredients/Products) ;
  2. *Prévisualisation* : `import_catalog_v1(dry_run=true)` → cards de summary par type (« Produits : 45 à créer, 12 à mettre à jour ») + table d'erreurs `{onglet, ligne, SKU, message}` filtrable ; bouton « Importer » actif seulement si zéro erreur ;
  3. *Import* : `dry_run=false` + idempotency key (`useRef(crypto.randomUUID())`, reset au succès) ; écran résultat + invalidation caches products/categories ; retry réseau réutilise la même clé.
- **Code** (`apps/backoffice/src/features/catalog-import/`) : `templateDefinition.ts` (source de vérité 6 onglets/colonnes) ; `parseCatalogWorkbook.ts` (pur : `ArrayBuffer → {payload, structureErrors[]}`) ; `buildTemplateWorkbook.ts` ; `buildExportWorkbook.ts` ; composants `CatalogImportPage`, `ImportDropzone`, `ImportSummaryCards`, `ImportErrorsTable`, `ImportResultPanel` ; hooks `useImportCatalog`, `useExportCatalog`.
- **Dépendance nouvelle** : `xlsx` (SheetJS) dans `@breakery/app-backoffice` uniquement.

## 8. Migrations & permissions

NAME-block `20260625000010..` (~6 migrations — vérifier `list_migrations` avant, monotonie post-S40 `20260624000022`) :
1. table `catalog_import_idempotency_keys` (+ REVOKE table) ;
2. `import_catalog_v1` ;
3. REVOKE pair `import_catalog_v1` ;
4. `export_catalog_v1` ;
5. REVOKE pair `export_catalog_v1` ;
6. seed permissions `catalog.import` + `catalog.export` (MANAGER/ADMIN/SUPER_ADMIN).

Puis regen types (`packages/supabase/src/types.generated.ts`) + ajout des 2 codes au union `PermissionCode`. Cible : cloud V3 dev `ikcyvlovptebroadgtvd` via MCP (pas de Docker).

## 9. Tests

- **pgTAP** `supabase/tests/catalog_import.test.sql` (~14 cas, via cloud MCP `BEGIN…ROLLBACK`) : happy path 6 types ; ré-import upsert (prix modifié, BOM remplacée, `recipe_versions` +1) ; dry-run = zéro écriture (counts avant/après) ; gate permission (CASHIER rejeté) ; cycle détecté ; matériau inconnu ; conflit variant/standalone ; replay idempotency ; REPLACE semantics units ; contexte d'unité invalide ; ligne `audit_logs` ; export shape = contrat d'import.
- **Unit Vitest BO** : `parseCatalogWorkbook` (fixtures xlsx en mémoire — structure errors, happy parse) ; **round-trip** `buildTemplateWorkbook → parse = 0 erreur` et `export payload → buildExportWorkbook → parse = payload identique`.
- **Smoke BO** : rendu onglet, bouton Importer désactivé si erreurs, mutation appelée `dry_run=true` puis `false`.
- `pnpm typecheck` 6/6.

## 10. Décisions actées (brainstorming 2026-06-12)

| # | Décision |
|---|---|
| D1 | Source = fichiers Excel de l'utilisateur, **template fourni par nous** calé sur le schéma V3 |
| D2 | Module = page BO (pas un script CLI) |
| D3 | Périmètre complet : ingrédients + produits + recettes (imbriquées) + variantes + unités/conversions |
| D4 | Format : 1 classeur xlsx, 6 onglets |
| D5 | Ré-import = **upsert par SKU** (itération sur la base de test) |
| D6 | Architecture B : RPC bulk atomique + dry-run (vs boucle client / EF async) |
| D7 | `image_url` dans Products et Variants (héritage parent → variant) |
| D8 | Unités alternatives + 4 contextes d'unités inclus (onglet Units + colonnes contextes) |
| D9 | Emplacement : page Products, onglet « Import / Export » (pas Settings) |
| D10 | Export complet du catalogue au format template (round-trip) |
