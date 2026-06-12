# Session 42 — Plan : Catalog Import/Export polish (8 Minors S41 Wave B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fermer les 8 issues *Minor* de la revue S41 Wave B sur l'onglet Import/Export du catalogue — parser (4), dropzone (2), tabs (1), label de commit (1).

**Architecture:** 100 % front `apps/backoffice`. Zéro migration, zéro types regen, zéro pgTAP. 4 fichiers source touchés, TDD par fix, commits conventionnels `fix(backoffice): session 42 — task N — <topic>`.

**Tech Stack:** React + TS, Vitest + Testing Library (jsdom), SheetJS (`xlsx`) pour les workbooks de test.

**Spec:** [`docs/workplan/specs/2026-06-12-session-42-catalog-import-minors-spec.md`](../specs/2026-06-12-session-42-catalog-import-minors-spec.md)

**Branche:** `fix/catalog-import-minors` (déjà créée, base `origin/master` @ `740f938`, spec committée `b9c7907`). PR focalisée vers `master` à la fin.

**Rappels projet :**
- `pnpm` 9.15 + turbo, jamais `npm`. Tests ciblés : `pnpm --filter @breakery/app-backoffice test <pattern>`.
- Mock data objects en `vi.hoisted()` refs stables (DEV-S39-B1-01) sinon boucle de rendu infinie → OOM.
- Baseline env-gated pré-existante (fichiers BO qui échouent sur `VITE_SUPABASE_URL Required` hors env) ≠ régression. Sweep BO attendu : 485/486 + les nouveaux tests (1 skip pré-existant).

---

## Task 1 : Parser — P1 header dupliqué, P2 off-by-N duplicate-SKU, P3 colonne requise absente, P4 double erreur

**Files:**
- Modify: `apps/backoffice/src/features/catalog-import/parseCatalogWorkbook.ts`
- Test: `apps/backoffice/src/features/catalog-import/__tests__/parse-catalog-workbook.test.ts`

Les 4 fixes vivent dans le même fichier — un seul subagent, 4 cycles TDD, 1 commit par fix.

Contexte fichier : `parseCatalogWorkbook(buf)` est pur (ArrayBuffer → payload + erreurs de structure). `CATALOG_SHEETS` (de `templateDefinition.ts`) définit 6 onglets ; chaque `def.columns[i]` a `{key, required, type}`. Le test existant a deux helpers : `wbToBuffer(wb)` et `makeWb(sheets)` qui crée les 6 onglets avec headers et injecte les lignes fournies.

### Cycle 1.A — P1 : header dupliqué

- [ ] **Step 1.A.1 : Écrire le test qui échoue** — ajouter à la fin du `describe` existant :

```ts
  it('flags a duplicated header column once, at row 1', () => {
    // Build a Categories sheet whose header row contains "name" twice.
    const wb = XLSX.utils.book_new();
    for (const def of CATALOG_SHEETS) {
      const headers = def.columns.map((c) => c.key);
      if (def.name === 'Categories') headers.push('name'); // duplicate
      const ws = XLSX.utils.aoa_to_sheet([headers, ...(def.name === 'Categories' ? [['Cat A', null, null, null]] : [])]);
      XLSX.utils.book_append_sheet(wb, ws, def.name);
    }
    const { errors } = parseCatalogWorkbook(wbToBuffer(wb));
    const dup = errors.filter((e) => e.sheet === 'Categories' && e.message.includes('Duplicate column'));
    expect(dup).toHaveLength(1);
    expect(dup[0]!.row).toBe(1);
    expect(dup[0]!.column).toBe('name');
  });
```

- [ ] **Step 1.A.2 : Vérifier l'échec** — Run: `pnpm --filter @breakery/app-backoffice test parse-catalog-workbook`. Expected: FAIL (`dup` est vide — aucune erreur Duplicate column émise).
- [ ] **Step 1.A.3 : Implémenter** — dans `parseCatalogWorkbook.ts`, remplacer le bloc headers (lignes ~102-108) :

```ts
    const headers = (aoa[0] ?? []).map((h) => String(h ?? '').trim());
    const known = new Set(def.columns.map((c) => c.key));
    const headerCounts = new Map<string, number>();
    headers.forEach((h) => {
      if (h === '') return;
      headerCounts.set(h, (headerCounts.get(h) ?? 0) + 1);
      if (!known.has(h) && headerCounts.get(h) === 1) {
        errors.push({ sheet: def.name, row: 1, column: h, message: `Unknown column "${h}"` });
      }
    });
    for (const [h, n] of headerCounts) {
      if (n > 1) {
        errors.push({ sheet: def.name, row: 1, column: h, message: `Duplicate column "${h}" (${n} occurrences) — only the first is read` });
      }
    }
```

  (Note : le garde `headerCounts.get(h) === 1` évite aussi de doubler l'erreur *Unknown column* si une colonne inconnue est elle-même dupliquée.)

- [ ] **Step 1.A.4 : Vérifier le PASS** — même commande, le nouveau test ET les 7 existants passent.
- [ ] **Step 1.A.5 : Commit** — `git add apps/backoffice/src/features/catalog-import && git commit -m "fix(backoffice): session 42 — task 1 — P1 detect duplicated header columns"`.

### Cycle 1.B — P2 : off-by-N duplicate-SKU via rowMaps

- [ ] **Step 1.B.1 : Écrire le test qui échoue** :

```ts
  it('reports duplicate-SKU errors with real Excel rows (blank rows skipped)', () => {
    // Ingredients: data on Excel rows 2 and 4 (row 3 blank). The duplicate is on row 4.
    const buf = makeWb({
      Ingredients: [
        ['DUP-2', 'Farine', 'kg', 1000, null, null, null, null, null, null, null],
        ['', '', '', '', '', '', '', '', '', '', ''],
        ['DUP-2', 'Beurre', 'kg', 2000, null, null, null, null, null, null, null],
      ],
    });
    const { errors } = parseCatalogWorkbook(buf);
    const dup = errors.find((e) => e.message.includes('Duplicate SKU "DUP-2"'));
    expect(dup).toBeDefined();
    expect(dup!.row).toBe(4); // not 3 (= ordinal + 2)
  });
```

- [ ] **Step 1.B.2 : Vérifier l'échec** — Expected: FAIL avec `dup.row === 3`.
- [ ] **Step 1.B.3 : Implémenter** — remplacer le bloc duplicate-SKU (fin de fonction, lignes ~129-145) :

```ts
  // duplicate SKUs across Ingredients / Products / Variants
  const seen = new Map<string, string>();
  const skuSheets: Array<[string, PayloadKey]> = [
    ['Ingredients', 'ingredients'], ['Products', 'products'], ['Variants', 'variants'],
  ];
  for (const [sheet, key] of skuSheets) {
    payload[key].forEach((row, idx) => {
      const sku = typeof row['sku'] === 'string' ? row['sku'] : null;
      if (sku === null) return;
      const prev = seen.get(sku);
      if (prev !== undefined) {
        errors.push({
          sheet,
          row: rowMaps[key][idx] ?? idx + 2,
          column: 'sku',
          message: `Duplicate SKU "${sku}" (already used in ${prev})`,
        });
      } else {
        seen.set(sku, sheet);
      }
    });
  }
```

  Import à ajouter en tête de fichier : `PayloadKey` est déjà importé (`import { CATALOG_SHEETS, type PayloadKey, type SheetDef } from './templateDefinition.js';` — vérifier, sinon l'ajouter).

- [ ] **Step 1.B.4 : Vérifier le PASS** — toute la suite parser passe.
- [ ] **Step 1.B.5 : Commit** — `fix(backoffice): session 42 — task 1 — P2 duplicate-SKU errors use real Excel rows`.

### Cycle 1.C — P3 : colonne requise absente → 1 erreur header-level

- [ ] **Step 1.C.1 : Écrire le test qui échoue** :

```ts
  it('emits one header-level error when a required column is missing, no per-row noise', () => {
    // Categories sheet WITHOUT the required "name" column, 3 data rows.
    const wb = XLSX.utils.book_new();
    for (const def of CATALOG_SHEETS) {
      if (def.name === 'Categories') {
        const ws = XLSX.utils.aoa_to_sheet([
          ['dispatch_station', 'sort_order'],
          ['bakery', 10],
          ['kitchen', 20],
          ['none', 30],
        ]);
        XLSX.utils.book_append_sheet(wb, ws, def.name);
      } else {
        const ws = XLSX.utils.aoa_to_sheet([def.columns.map((c) => c.key)]);
        XLSX.utils.book_append_sheet(wb, ws, def.name);
      }
    }
    const { errors } = parseCatalogWorkbook(wbToBuffer(wb));
    const headerErr = errors.filter((e) => e.sheet === 'Categories' && e.message.includes('Required column'));
    const perRow = errors.filter((e) => e.sheet === 'Categories' && e.message === 'Required value missing');
    expect(headerErr).toHaveLength(1);
    expect(headerErr[0]!.row).toBe(1);
    expect(headerErr[0]!.column).toBe('name');
    expect(perRow).toHaveLength(0); // today: 3 noisy per-row errors
  });
```

- [ ] **Step 1.C.2 : Vérifier l'échec** — Expected: FAIL (`headerErr` vide, `perRow` length 3).
- [ ] **Step 1.C.3 : Implémenter** — après le bloc headers du cycle 1.A, avant la boucle de lignes, insérer :

```ts
    const headerSet = new Set(headers.filter((h) => h !== ''));
    const hasDataRows = aoa.slice(1).some(
      (cells) => (cells ?? []).some((c) => c !== null && String(c).trim() !== ''),
    );
    if (hasDataRows) {
      for (const col of def.columns) {
        if (col.required && !headerSet.has(col.key)) {
          errors.push({ sheet: def.name, row: 1, column: col.key, message: `Required column "${col.key}" is missing` });
        }
      }
    }
```

  Et dans la boucle de lignes, le check required ne s'applique que si la colonne est présente — remplacer :

```ts
        if (col.required && (v === null || v === '')) {
```

  par :

```ts
        if (col.required && hIdx !== -1 && (v === null || v === '')) {
```

  (`hIdx` est déjà calculé juste au-dessus : `const hIdx = headers.indexOf(col.key);`.)

- [ ] **Step 1.C.4 : Vérifier le PASS** — suite complète parser (le test existant « flags an empty required cell » doit continuer à passer : colonne présente, cellule vide).
- [ ] **Step 1.C.5 : Commit** — `fix(backoffice): session 42 — task 1 — P3 missing required column = one header-level error`.

### Cycle 1.D — P4 : pas de double erreur sur la même cellule

- [ ] **Step 1.D.1 : Écrire le test qui échoue** :

```ts
  it('emits a single error when a required numeric cell holds garbage (no double error)', () => {
    // Ingredients.cost_price is required+number; "abc" must yield exactly 1 error.
    const buf = makeWb({ Ingredients: [['ING-9', 'Sel', 'kg', 'abc', null, null, null, null, null, null, null]] });
    const { errors } = parseCatalogWorkbook(buf);
    const cellErrors = errors.filter((e) => e.sheet === 'Ingredients' && e.row === 2 && e.column === 'cost_price');
    expect(cellErrors).toHaveLength(1);
    expect(cellErrors[0]!.message).toContain('is not a number');
  });
```

- [ ] **Step 1.D.2 : Vérifier l'échec** — Expected: FAIL (`cellErrors` length 2 : « is not a number » + « Required value missing »).
- [ ] **Step 1.D.3 : Implémenter** — dans la boucle de colonnes, encadrer l'appel `coerce` :

```ts
        const errCountBefore = errors.length;
        const v = coerce(def, col.key, col.type, raw, rowIdx, errors);
        const coerceErrored = errors.length > errCountBefore;
        if (col.required && hIdx !== -1 && !coerceErrored && (v === null || v === '')) {
          errors.push({ sheet: def.name, row: rowIdx, column: col.key, message: `Required value missing` });
        }
```

- [ ] **Step 1.D.4 : Vérifier le PASS** — Run: `pnpm --filter @breakery/app-backoffice test parse-catalog-workbook`. Expected: 11/11 PASS (7 existants + 4 nouveaux).
- [ ] **Step 1.D.5 : Commit** — `fix(backoffice): session 42 — task 1 — P4 no double error on the same cell`.

---

## Task 2 : Dropzone — P5 a11y + drop non-xlsx, P6 garde dragLeave

**Files:**
- Modify: `apps/backoffice/src/features/catalog-import/components/ImportDropzone.tsx`
- Test (create): `apps/backoffice/src/features/catalog-import/__tests__/import-dropzone.smoke.test.tsx`

- [ ] **Step 2.1 : Écrire les tests qui échouent** — créer le fichier :

```tsx
// apps/backoffice/src/features/catalog-import/__tests__/import-dropzone.smoke.test.tsx
// S42 — P5 (a11y + non-xlsx drop feedback) and P6 (dragLeave relatedTarget guard).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImportDropzone } from '../components/ImportDropzone.js';

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: toastError } }));

function makeFile(name: string): File {
  const file = new File(['x'], name);
  // jsdom may not implement File.arrayBuffer — stub it on the instance.
  Object.defineProperty(file, 'arrayBuffer', {
    value: () => Promise.resolve(new ArrayBuffer(8)),
  });
  return file;
}

describe('ImportDropzone [S42 smoke]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('P5a: the hidden file input is out of the tab order (tabIndex -1)', () => {
    const { container } = render(<ImportDropzone onFile={vi.fn()} />);
    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    expect((input as HTMLInputElement).tabIndex).toBe(-1);
  });

  it('P5b: dropping a non-xlsx file shows an error and does not call onFile', () => {
    const onFile = vi.fn();
    render(<ImportDropzone onFile={onFile} />);
    fireEvent.drop(screen.getByTestId('import-dropzone'), {
      dataTransfer: { files: [makeFile('notes.txt')] },
    });
    expect(onFile).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('Only .xlsx files are supported');
  });

  it('P5c: an uppercase .XLSX extension is accepted', async () => {
    const onFile = vi.fn();
    render(<ImportDropzone onFile={onFile} />);
    fireEvent.drop(screen.getByTestId('import-dropzone'), {
      dataTransfer: { files: [makeFile('CATALOG.XLSX')] },
    });
    await waitFor(() => expect(onFile).toHaveBeenCalledTimes(1));
    expect(toastError).not.toHaveBeenCalled();
  });

  it('P6: dragleave towards a child keeps the drag-over highlight, leaving clears it', () => {
    render(<ImportDropzone onFile={vi.fn()} />);
    const zone = screen.getByTestId('import-dropzone');
    const child = zone.querySelector('p'); // any child element
    expect(child).not.toBeNull();

    fireEvent.dragOver(zone);
    expect(zone.className).toContain('border-gold');

    // Cursor moves onto a child → relatedTarget is inside the zone → keep state.
    fireEvent.dragLeave(zone, { relatedTarget: child });
    expect(zone.className).toContain('border-gold');

    // Cursor actually leaves → clear.
    fireEvent.dragLeave(zone, { relatedTarget: document.body });
    expect(zone.className).not.toContain('border-gold');
  });
});
```

- [ ] **Step 2.2 : Vérifier l'échec** — Run: `pnpm --filter @breakery/app-backoffice test import-dropzone`. Expected: 4 FAIL (tabIndex 0 ; pas de toast ; `.XLSX` rejeté ; dragLeave clears toujours).
- [ ] **Step 2.3 : Implémenter** — dans `ImportDropzone.tsx` :

  (a) Import sonner en tête : `import { toast } from 'sonner';`

  (b) `handleDragLeave` prend l'event et garde `relatedTarget` :

```ts
  function handleDragLeave(e: DragEvent<HTMLDivElement>): void {
    // dragleave also fires when the cursor moves onto a child — ignore those.
    if (e.relatedTarget !== null && e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragOver(false);
  }
```

  (c) `handleDrop` : check case-insensible + feedback :

```ts
  function handleDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    setIsDragOver(false);
    if (disabled) return;
    const file = e.dataTransfer.files[0];
    if (file === undefined) return;
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      toast.error('Only .xlsx files are supported');
      return;
    }
    void processFile(file);
  }
```

  (d) L'input sort du tab order — ajouter `tabIndex={-1}` sur le `<input>` (le div extérieur `role="button"` reste l'unique contrôle interactif ; `aria-hidden` devient légitime) :

```tsx
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
        className="sr-only"
        onChange={handleChange}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden
      />
```

- [ ] **Step 2.4 : Vérifier le PASS** — Run: `pnpm --filter @breakery/app-backoffice test import-dropzone`. Expected: 4/4 PASS. Puis non-régression page : `pnpm --filter @breakery/app-backoffice test import-export-page`. Expected: 5/5 PASS (la page mocke la dropzone, rien ne bouge).
- [ ] **Step 2.5 : Commit** — `git add apps/backoffice/src/features/catalog-import && git commit -m "fix(backoffice): session 42 — task 2 — P5/P6 dropzone a11y, non-xlsx feedback, dragleave guard"`.

---

## Task 3 : Tabs — P7 sémantique nav + aria-current

**Files:**
- Modify: `apps/backoffice/src/features/products/components/ProductsPageTabs.tsx`
- Test (create): `apps/backoffice/src/features/products/__tests__/products-page-tabs.smoke.test.tsx`

- [ ] **Step 3.1 : Écrire le test qui échoue** — créer le fichier :

```tsx
// apps/backoffice/src/features/products/__tests__/products-page-tabs.smoke.test.tsx
// S42 — P7: route-based tabs use nav semantics (aria-current), not ARIA tab roles.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProductsPageTabs } from '../components/ProductsPageTabs.js';

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (selector: (s: { hasPermission: (_: string) => boolean }) => unknown) =>
    selector({ hasPermission: () => true }),
}));

describe('ProductsPageTabs [S42 smoke]', () => {
  it('P7: no ARIA tab roles; active link carries aria-current=page', () => {
    render(
      <MemoryRouter initialEntries={['/backoffice/products']}>
        <ProductsPageTabs />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();

    const active = screen.getByRole('link', { name: 'Products' });
    expect(active).toHaveAttribute('aria-current', 'page');
    const inactive = screen.getByRole('link', { name: 'Import / Export' });
    expect(inactive).not.toHaveAttribute('aria-current');
  });
});
```

- [ ] **Step 3.2 : Vérifier l'échec** — Run: `pnpm --filter @breakery/app-backoffice test products-page-tabs`. Expected: FAIL (`getByRole('link')` ne matche pas — les éléments portent `role="tab"`, qui écrase le rôle implicite link).
- [ ] **Step 3.3 : Implémenter** — dans `ProductsPageTabs.tsx`, retirer `role="tablist"` du `<nav>` et `role="tab"` du `<NavLink>` (aucun autre changement — `NavLink` pose `aria-current="page"` automatiquement sur le lien actif) :

```tsx
      <nav aria-label="Products sections" className="flex flex-wrap gap-x-6">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
```

- [ ] **Step 3.4 : Vérifier le PASS** — Run: `pnpm --filter @breakery/app-backoffice test products-page-tabs`. Expected: 1/1 PASS.
- [ ] **Step 3.5 : Commit** — `git add apps/backoffice/src/features/products && git commit -m "fix(backoffice): session 42 — task 3 — P7 tabs use nav semantics (aria-current), drop half-built tab roles"`.

---

## Task 4 : Page — P8 label « Import N items » honnête

**Files:**
- Modify: `apps/backoffice/src/pages/products/ProductsImportExportPage.tsx`
- Test: `apps/backoffice/src/features/catalog-import/__tests__/import-export-page.smoke.test.tsx`

- [ ] **Step 4.1 : Écrire les tests qui échouent** — dans le bloc `vi.hoisted()` existant du smoke test, ajouter deux fixtures après `ERRORS_REPORT` (et les exposer dans le `return` du hoisted + la destructuration en tête) :

```ts
    // P8: replacement counters (units/recipes) must NOT inflate the items count.
    const MIXED_SUMMARY_REPORT = {
      valid: true,
      errors: [],
      summary: {
        categories:  { create: 0, update: 0 },
        ingredients: { create: 0, update: 0 },
        products:    { create: 1, update: 2 },
        units:       { replace_products: 5 },
        variants:    { create: 0, update: 0 },
        recipes:     { products_replaced: 3 },
      },
      idempotent_replay: false,
    };

    // P8 fallback: nothing created/updated, only replacements → "Import catalog".
    const REPLACE_ONLY_REPORT = {
      valid: true,
      errors: [],
      summary: {
        categories:  { create: 0, update: 0 },
        ingredients: { create: 0, update: 0 },
        products:    { create: 0, update: 0 },
        units:       { replace_products: 5 },
        variants:    { create: 0, update: 0 },
        recipes:     { products_replaced: 3 },
      },
      idempotent_replay: false,
    };
```

  Puis deux tests à la fin du `describe` :

```ts
  it('P8a: commit button counts only create+update, not replacement counters', async () => {
    importMutateAsync.mockResolvedValueOnce(MIXED_SUMMARY_REPORT);
    renderPage();
    await triggerUpload();
    await waitFor(() => {
      expect(screen.getByTestId('confirm-import')).toBeInTheDocument();
    });
    // 1 create + 2 update = 3 — NOT 11 (3 + 5 replace_products + 3 products_replaced)
    expect(screen.getByTestId('confirm-import')).toHaveTextContent('Import 3 items');
  });

  it('P8b: replacements only → falls back to "Import catalog"', async () => {
    importMutateAsync.mockResolvedValueOnce(REPLACE_ONLY_REPORT);
    renderPage();
    await triggerUpload();
    await waitFor(() => {
      expect(screen.getByTestId('confirm-import')).toBeInTheDocument();
    });
    expect(screen.getByTestId('confirm-import')).toHaveTextContent('Import catalog');
  });
```

- [ ] **Step 4.2 : Vérifier l'échec** — Run: `pnpm --filter @breakery/app-backoffice test import-export-page`. Expected: P8a FAIL (« Import 11 items »), P8b PASS-ou-FAIL selon le calcul actuel (8 ≠ 0 → « Import 8 items » → FAIL). Les 5 tests existants passent.
- [ ] **Step 4.3 : Implémenter** — dans `ProductsImportExportPage.tsx`, remplacer le calcul `importTotal` (lignes ~142-148) :

```ts
  // Items to import = create + update only. Replacement counters
  // (units.replace_products, recipes.products_replaced) count affected
  // products, not items — summing them inflates the label (P8, DEV-S41-A2-01).
  const importTotal =
    stage.step === 'previewed'
      ? Object.values(stage.report.summary).reduce(
          (sum, section) => sum + (section['create'] ?? 0) + (section['update'] ?? 0),
          0,
        )
      : 0;
```

- [ ] **Step 4.4 : Vérifier le PASS** — Run: `pnpm --filter @breakery/app-backoffice test import-export-page`. Expected: 7/7 PASS.
- [ ] **Step 4.5 : Commit** — `git add apps/backoffice/src && git commit -m "fix(backoffice): session 42 — task 4 — P8 honest import count (create+update only)"`.

---

## Task 5 : Régression — sweep BO + typecheck

**Files:** aucun (vérification seule).

- [ ] **Step 5.1 :** `pnpm --filter @breakery/app-backoffice test`. Expected: baseline 485/486 + 7 nouveaux tests (4 parser + 4 dropzone + 1 tabs + 2 page − recomptage exact selon le runner), zéro nouvelle failure. La baseline env-gated pré-existante (`VITE_SUPABASE_URL Required`) n'est PAS une régression — comparer aux failures, pas au total.
- [ ] **Step 5.2 :** `pnpm typecheck`. Expected: 6/6 PASS.
- [ ] **Step 5.3 :** Si un test hors périmètre casse : STOP, diagnostiquer avant tout fix (superpowers:systematic-debugging) — ne jamais maquiller une régression en flake.

---

## Closeout (contrôleur)

- [ ] Push + PR `fix/catalog-import-minors` → `master`, titre « Session 42 — Catalog Import/Export polish (8 Minors S41 Wave B) », body : liste P1-P8 + lien spec.
- [ ] CLAUDE.md : bump « Current session » (S42 exécutée, PR ouverte) — bref, pattern des sessions précédentes.
