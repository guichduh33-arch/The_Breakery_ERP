# Session 45 — Plan : Products page — finir les actions catalogue

> Spec : [`docs/workplan/specs/2026-06-13-session-45-products-actions-spec.md`](../specs/2026-06-13-session-45-products-actions-spec.md)
> Branche : `swarm/session-45` (base `master` @ `b80e3d9`).
> Méthode : **subagent-driven TDD**, 1 subagent par task, **spec-review + code-review par wave**, pattern-guardian sur le diff migration, test-engineer sur le pgTAP. Squash-merge par PR en fin de session.
> Migration NAME-block : `20260629000010..` (base vérifiée `list_migrations`, prior max NAME `20260628000018`). **Appliquer via MCP `apply_migration`** sur V3 dev `ikcyvlovptebroadgtvd`. Types regen MCP → commit.

## Ordre d'exécution

```
Wave A (DB, bloquant)            → delete_product_v1 + pgTAP + types regen
        │
        ├─ Wave B (front delete)  ─┐
        ├─ Wave C (front pricing)  ├─ parallélisables (3 subagents, fichiers disjoints)
        └─ Wave D (front pills)   ─┘
                                   │
Wave E (régression + review + live verify + closeout)
```
A est bloquant (B dépend de la RPC + types regen). B/C/D touchent des fichiers quasi disjoints (`Products.tsx` est le seul point de contact partagé → **un seul subagent édite `Products.tsx`** en fin, ou B/C/D produisent des patchs `Products.tsx` mergés par le contrôleur pour éviter le conflit — voir note Wave E).

---

## Wave A — `delete_product_v1` (subagent : `db-engineer`)

**TDD DB** : écrire le pgTAP d'abord, l'exécuter (rouge), puis la migration (vert).

### A.1 — pgTAP rouge
- Créer `supabase/tests/delete_product_v1.test.sql` (T1-T6 de la spec §4).
- Exécuter via MCP `execute_sql` BEGIN/ROLLBACK → doit échouer (fonction absente).

### A.2 — Migration
- `20260629000010_create_delete_product_v1_rpc.sql` :
  - `delete_product_v1(p_product_id UUID, p_idempotency_key UUID DEFAULT NULL) RETURNS JSONB SECURITY DEFINER SET search_path = public, pg_temp`.
  - Auth-first : `IF NOT has_permission(auth.uid(),'products.delete') THEN RAISE ... 42501`.
  - Lookup produit (P0002 si absent) ; si déjà `is_active=false` → return `{deleted:true, idempotent_replay:true}`.
  - Garde D2 : `SELECT count(*) FROM products WHERE parent_product_id = p_product_id AND is_active` > 0 → `RAISE 'parent_has_active_variants' USING ERRCODE='P0001', DETAIL=...`.
  - `UPDATE products SET is_active=false` ; `INSERT INTO audit_logs (...)` action `product.deleted`.
  - REVOKE pair canonique (PUBLIC + anon + ALTER DEFAULT PRIVILEGES) — inline ou `_011`.
- Appliquer via MCP `apply_migration`.

### A.3 — pgTAP vert + types
- Ré-exécuter le pgTAP → 6/6 PASS.
- `generate_typescript_types` → écrire `packages/supabase/src/types.generated.ts` → commit.

**Review A** : `test-engineer` rejoue le pgTAP indépendamment ; `pattern-guardian` audite le diff migration (REVOKE pair 3 lignes, auth-first, search_path, audit cols canoniques, soft-delete only).

**Gate de sortie A** : pgTAP 6/6 + types committés. → débloque B.

---

## Wave B — Suppression front (subagent : `backoffice-specialist`)

### B.1 — Hook (TDD)
- `apps/backoffice/src/features/products/hooks/useDeleteProduct.ts` : mutation `delete_product_v1`, `supabase.rpc` **bindé**, idempotency `useRef(crypto.randomUUID())`, invalide `['products']`, mappe `parent_has_active_variants`.

### B.2 — Dialog
- `apps/backoffice/src/features/products/components/DeleteProductDialog.tsx` : Dialog `@breakery/ui`, nom+SKU+avertissement soft-delete, bouton destructif, pending.

### B.3 — Durcir `ProductsTable` + câbler `Products.tsx`
- `ProductsTable` : rendre l'action Delete conditionnelle (`canDelete && onDelete !== undefined`) — modèle `VariantRowSortable`.
- `Products.tsx` : `canDelete = hasPermission('products.delete')` ; `onDelete` + state + montage `DeleteProductDialog`.

### B.4 — Smokes
- `delete-product-dialog.smoke.test.tsx`, et la partie delete de `products-actions-wiring.smoke.test.tsx` (Trash2 masqué sans perm + visible avec).

---

## Wave C — Edit pricing front (subagent : `backoffice-specialist`)

### C.1 — Tab param (TDD)
- `ProductDetailPage` : lire `useSearchParams().get('tab')` au montage, valider contre `ProductDetailTab`, initialiser l'onglet actif (fallback `overview`). Ne pas casser la nav par onglet interne.
- Smoke `product-detail-tab-param.smoke.test.tsx`.

### C.2 — Câbler `$`
- `ProductsTable` : passer `onPricing` (afficher le `$` seulement si `products.update`).
- `Products.tsx` : `onPricing={(row) => navigate('/backoffice/products/' + row.id + '?tab=general')}`.

---

## Wave D — Pills en-tête (subagent : `backoffice-specialist`)

### D.1 — Câblage + retrait
- `Products.tsx` : `onImport` (gate `catalog.import`), `onRecipes` → `navigate`.
- `ProductsHeader.tsx` : **retirer** le pill Modifiers (D1) ; rendre « Products » statique non-cliquable (D4).

### D.2 — Smokes
- Partie pills de `products-actions-wiring.smoke.test.tsx` : Import/Recipes naviguent, pas de bouton Modifiers, Products non-cliquable.

> **Note conflit `Products.tsx`** : B.3 / C.2 / D.1 éditent tous `Products.tsx`. Pour éviter la collision : soit exécuter B→C→D **séquentiellement** sur ce fichier (recommandé, le fichier est petit), soit isoler chaque wave en worktree et laisser le contrôleur merger. Les composants (`ProductsTable`, `ProductsHeader`, `ProductDetailPage`, dialogs, hooks) sont disjoints et parallélisables.

---

## Wave E — Régression, review, vérif live, closeout (contrôleur)

### E.1 — Sweep
- `pnpm --filter @breakery/app-backoffice test` (sweep BO complet) — zéro nouvelle failure vs baseline.
- `pnpm typecheck` 6/6.

### E.2 — Code review
- `reviewer` (ou `analyst`) : revue qualité B/C/D (gates de perm corrects, pas de bouton inerte, query keys, mapping erreur).
- 2ᵉ passe `pattern-guardian` sur le diff complet (front + migration).

### E.3 — Vérif live navigateur (playwright-cli, dev server BO)
- Login Owner (PIN `123456`).
- Créer/choisir un produit jetable → **Delete réel** → disparaît du catalogue actif → vérif DB MCP `SELECT is_active FROM products WHERE id=…` = false.
- `$` sur une ligne → ouvre détail onglet **General**.
- Pills **Import** → `/products/import-export`, **Recipes** → `/inventory/recipes` ; **pas** de pill Modifiers ; **Products** non-cliquable.
- Re-tester un MANAGER (ou simuler perms) : Trash2 **absent**.

### E.4 — Closeout
- INDEX `docs/workplan/plans/2026-06-13-session-45-INDEX.md` (déviations numérotées DEV-S45-*).
- Bump CLAUDE.md « Active Workplan » + bullet Migration sequence (NAME-block `20260629000010..`).
- PR squash `swarm/session-45` → `master`.

---

## Critères de sortie (rappel spec §6)

- [ ] Zéro bouton mort sur `/backoffice/products` (6 boutons fonctionnels ou retirés).
- [ ] pgTAP `delete_product_v1` 6/6 cloud.
- [ ] Trash2 + `$` conditionnels aux perms.
- [ ] Vérif live : delete réel + Import/Recipes nav + `$` onglet General.
- [ ] typecheck 6/6 + sweep BO propre.
- [ ] Reviews spec + code + pattern-guardian + test-engineer OK.

## Risques / pièges

- **`Products.tsx` partagé** par 3 waves → séquencer ou worktree (note Wave E).
- **Vitest mock data** : refs stables `vi.hoisted()` (cf. `project_vitest_hoisted_mock_data`, S39 B1 OOM).
- **`supabase.rpc` non bindé** → erreur runtime (pattern stock-audit C1) : toujours binder.
- **Bouton conditionnel** : ne pas répéter le bug d'origine — un bouton ne doit s'afficher que si son handler + sa perm existent.
- **types regen oublié** = #1 cause de CI cassée — commit obligatoire après Wave A.
