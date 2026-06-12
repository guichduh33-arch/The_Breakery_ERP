# Session 42 — Spec : Catalog Import/Export polish (8 Minors revue S41 Wave B)

**Date :** 2026-06-12
**Statut :** approved (design validé owner 2026-06-12)
**Source :** S41 INDEX §6 « Hors scope S42+ » — les 8 Minor de la revue Wave B.
**Périmètre :** 100 % front (`apps/backoffice`). Zéro migration, zéro types regen, zéro pgTAP.
**Branche :** `fix/catalog-import-minors` (base `origin/master` @ `740f938`), PR focalisée vers `master`.

## 1. Contexte

La S41 a livré l'onglet Import / Export du catalogue (PR #74). La revue de code Wave B
a relevé 8 issues *Minor*, toutes front-only, explicitement déférées S42+
(INDEX §6). Décisions de cadrage ratifiées :

- **Scope = bucket A uniquement** (les 8 Minors). Pas de CSV, pas d'import async EF,
  pas d'entités étendues, pas de cleanup data legacy.
- **Pas de compteur `restored`** dans le summary (resterait une migration RPC) — backlog.
- **Item 7 (tabs)** : on abandonne les rôles ARIA tab au profit de `nav` + `aria-current`
  (liens de routes, pas un widget tab).

## 2. Les 8 fixes

### Parser — `apps/backoffice/src/features/catalog-import/parseCatalogWorkbook.ts`

**P1 — Header dupliqué non détecté.**
Le scan des headers ne signale que les colonnes inconnues ; une colonne dupliquée
(ex. deux headers `sku`) est silencieuse et `headers.indexOf(col.key)` lit la
première occurrence sans prévenir.
→ Émettre une erreur row 1 `Duplicate column "<x>"` (une seule par colonne dupliquée,
`column` = le nom du header) quand un header non vide apparaît ≥ 2 fois sur un onglet.

**P2 — Off-by-N sur l'erreur duplicate-SKU.**
Le check cross-onglets (fin de `parseCatalogWorkbook`) rapporte `row: idx + 2`
(ordinal dans le payload + 2) — faux dès qu'une ligne blanche a été sautée.
→ Utiliser `rowMaps[payloadKey][idx]` (la structure existe précisément pour ça —
même mécanique que `toExcelRows` côté page). La liste `skuRows` doit porter le
`payloadKey` en plus du nom d'onglet.

**P3 — Colonne requise absente = 1 erreur header-level, pas N erreurs par ligne.**
Aujourd'hui, si le header d'une colonne `required` est absent de l'onglet, chaque
ligne de données émet `Required value missing` (bruit, et le user ne comprend pas
que c'est la colonne entière qui manque).
→ Si le header d'une colonne `required` est absent ET que l'onglet a ≥ 1 ligne de
données : une seule erreur `{row: 1, column: <key>, message: 'Required column "<key>" is missing'}`,
et **supprimer** les erreurs per-row `Required value missing` pour cette colonne
(le cas `hIdx === -1`). Les cellules vides d'une colonne *présente* continuent
d'émettre l'erreur per-row.

**P4 — Double erreur sur la même cellule.**
Une valeur non numérique dans une cellule requise émet `"abc" is not a number`
PUIS `Required value missing` (coerce retourne `null` → le check required se déclenche).
→ Ne pas émettre l'erreur required quand `coerce` a déjà émis une erreur pour cette
cellule (raw non vide mais coercion échouée). Implémentation suggérée : comparer
`errors.length` avant/après l'appel `coerce`, ou faire retourner un marqueur.

### Dropzone — `apps/backoffice/src/features/catalog-import/components/ImportDropzone.tsx`

**P5 — A11y + drop non-xlsx silencieux.**
(a) L'input file est `aria-hidden` mais reste focusable (tabbable) — violation
(élément focusable masqué à l'a11y tree) ; (b) il est imbriqué dans un div
`role="button"` (nested interactive).
→ Ajouter `tabIndex={-1}` sur l'input : il sort du tab order, `aria-hidden` devient
légitime, et le div extérieur reste l'unique contrôle interactif. Pas de
restructuration du markup.
(c) Un drop de fichier non-`.xlsx` est silencieusement ignoré (`handleDrop` filtre
sans feedback), et le check `endsWith('.xlsx')` est case-sensible (`.XLSX` rejeté).
→ Check d'extension case-insensible + `toast.error('Only .xlsx files are supported')`
(import `toast` de `sonner`, déjà utilisé dans la page) quand le fichier droppé
ne matche pas.

**P6 — `handleDragLeave` sans garde `relatedTarget`.**
`dragleave` se déclenche quand le curseur passe sur un enfant → flicker du highlight.
→ Early-return si `e.relatedTarget` est encore contenu dans `e.currentTarget` :
`if (e.currentTarget.contains(e.relatedTarget as Node)) return;` puis `setIsDragOver(false)`.
(`relatedTarget` peut être `null` — `contains(null)` retourne `false`, OK.)

### Tabs — `apps/backoffice/src/features/products/components/ProductsPageTabs.tsx`

**P7 — Rôles ARIA tabs incomplets → sémantique nav.**
`role="tablist"`/`role="tab"` sans `aria-selected`, sans `aria-controls`/`tabpanel`,
sans navigation clavier par flèches : pattern à moitié implémenté, pire que pas de
pattern. Ce sont des liens de navigation (routes), pas un widget tab.
→ Retirer `role="tablist"` et `role="tab"`. Garder `<nav aria-label="Products sections">` ;
`NavLink` pose automatiquement `aria-current="page"` sur le lien actif. Aucun
changement visuel.

### Page — `apps/backoffice/src/pages/products/ProductsImportExportPage.tsx`

**P8 — Label « Import N items » qui somme les compteurs de remplacement.**
`importTotal` somme TOUS les nombres du summary, y compris `units.replace_products`
et `recipes.products_replaced` qui comptent des *produits affectés*, pas des items.
→ Ne sommer que les clés `create` et `update` des sections (categories / ingredients /
products / variants). Si ce total vaut 0 mais que des remplacements existent,
fallback sur le label `Import catalog` (déjà le fallback quand `importTotal === 0`).
Implémentation robuste au shape : itérer les sections et n'additionner que
`section.create ?? 0` + `section.update ?? 0` (résiste à DEV-S41-A2-01).

## 3. Tests

- **P1–P4 :** étendre `__tests__/parse-catalog-workbook.test.ts` — 1 test ciblé par fix :
  - P1 : workbook avec header `sku` dupliqué → 1 erreur `Duplicate column` row 1 ;
  - P2 : SKU dupliqué après une ligne blanche → `row` = vraie ligne Excel ;
  - P3 : onglet sans colonne `name` avec 3 lignes de données → exactement 1 erreur
    header-level, 0 erreur per-row pour cette colonne ;
  - P4 : cellule requise non numérique → exactement 1 erreur pour cette cellule.
  Les workbooks de test sont construits via `XLSX.utils` (pattern existant du fichier).
- **P5–P6 :** smoke dropzone (nouveau fichier ou extension du smoke existant) :
  input a `tabIndex === -1` ; drop d'un `.txt` → `onFile` PAS appelé + toast erreur
  (mock `sonner`) ; drop `.XLSX` majuscule → `onFile` appelé ; dragleave vers un
  enfant ne retire pas l'état drag-over (si testable à coût raisonnable en jsdom —
  sinon assertion structurelle sur la garde).
- **P7–P8 :** étendre `__tests__/import-export-page.smoke.test.tsx` :
  plus de `role="tab"` dans le DOM + le lien actif porte `aria-current="page"` ;
  label du bouton de commit = somme create+update uniquement (summary fixture avec
  `replace_products`/`products_replaced` non nuls).
- **Régression :** sweep BO complet (`pnpm --filter @breakery/app-backoffice test`,
  baseline 485/486 — 1 skip pré-existant) + `pnpm typecheck` 6/6.
  Baseline env-gated pré-existante ≠ régression.

## 4. Hors scope (inchangé, backlog)

CSV, import async EF, entités étendues (modifiers/sections/combos/promotions/
customers/images/lots), cleanup data legacy (`g` sur `cup`/`pcs`), compteur
`restored` dans le summary.

## 5. Critères d'acceptation

1. Les 4 tests parser P1–P4 passent et documentent le comportement exact.
2. Plus aucune violation a11y connue sur la dropzone (input hors tab order) ni
   sur les tabs (sémantique nav + aria-current).
3. Drop non-xlsx → feedback visible ; `.XLSX` accepté.
4. Label de commit honnête (create+update uniquement).
5. Sweep BO + typecheck au vert (baseline pré-existante exclue).
6. Aucun changement DB, aucun changement de comportement RPC, aucun changement
   visuel hors les corrections décrites.
