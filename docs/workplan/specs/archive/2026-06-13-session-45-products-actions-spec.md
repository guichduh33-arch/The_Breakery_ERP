# Session 45 — Spec : Products page — finir les actions catalogue (boutons morts)

> Statut : **DRAFT** — à valider avant exécution.
> Branche : `swarm/session-45` (base `master` @ `b80e3d9`, post-merge S44 PR #81).
> Type : **front-heavy + 1 RPC DB**. 1 migration NAME-block (`20260629000010..`), 1 perm **déjà existante** (`products.delete` seedée S13), types regen.

## 1. Contexte

Audit live (navigateur, 2026-06-13, connecté Owner SUPER_ADMIN sur `/backoffice/products`) : plusieurs boutons de la page Produits sont **dessinés mais jamais câblés** — vestiges de l'en-tête Session 14 (« Read-only — write paths arrive when the product CRUD RPCs land in a future session »). Confirmés morts en direct (clic → aucune navigation, aucune requête réseau, aucune modale, 0 erreur console — les `onX?.()` no-op silencieusement) **et** en lecture de code :

| # | Bouton | Emplacement | Cause | Destination/backend |
|---|--------|-------------|-------|---------------------|
| B1 | **Delete** (Trash2, action ligne) | `ProductsTable.tsx:156` | `onDelete` jamais passé par `Products.tsx:123` ; **aucun** hook `useDeleteProduct`, **aucune** RPC `delete_product_v1` | à créer |
| B2 | **Edit pricing** (`$`, action ligne) | `ProductsTable.tsx:152` | `onPricing` jamais passé | détail produit (onglet General édite déjà `retail_price`/`wholesale_price` via `update_product_v1`) |
| B3 | **Import** (pill en-tête) | `ProductsHeader.tsx:36` | `onImport` jamais passé par `Products.tsx:97` | route `products/import-export` **existe** (S41) |
| B4 | **Recipes** (pill en-tête) | `ProductsHeader.tsx:37` | `onRecipes` jamais passé | route `inventory/recipes` **existe** |
| B5 | **Modifiers** (pill en-tête) | `ProductsHeader.tsx:38` | `onModifiers` jamais passé | **aucune route/page nulle part dans le projet** |
| B6 | **Products** (pill en-tête) | `ProductsHeader.tsx:35` | jamais de `onClick` | page courante (no-op par design, mais visuellement actionnable → trompeur) |

Fonctionnel et hors scope (vérifié) : le **+ New Product** (gold) marche (`onNew`, gate `products.create`) ; l'**onglet** « IMPORT / EXPORT » sous l'en-tête est un vrai `NavLink` qui marche (`ProductsPageTabs`, gate `catalog.import`). C'est seulement le **raccourci pill** Import qui est mort, pas la feature.

## 2. Périmètre (les 6 corrections)

### Wave A — DB : `delete_product_v1` (B1 backend)

**Migration `20260629000010` — `create_delete_product_v1_rpc`**

```sql
delete_product_v1(p_product_id UUID, p_idempotency_key UUID DEFAULT NULL)
  RETURNS JSONB                          -- { product_id, deleted: true, idempotent_replay: bool }
  SECURITY DEFINER
```

- Gate `has_permission(auth.uid(), 'products.delete')` (perm **déjà** seedée S13 `20260513000004`, grants ADMIN + SUPER_ADMIN ; **pas** MANAGER → la corbeille restera invisible pour MANAGER, cf. D-W1-01).
- **Soft-delete** : `UPDATE products SET is_active = false WHERE id = p_product_id` — **jamais** de hard-delete (FK `order_items`, convention `delete_variant_v1` S27c).
- Garde **D2** : si le produit est un **parent de variantes avec ≥ 1 variante encore `is_active`** → `RAISE EXCEPTION 'parent_has_active_variants' (P0001, DETAIL JSON {variant_count})`. L'utilisateur doit d'abord dissoudre/désactiver les variantes (le flux S27c gère ça).
- Idempotence sémantique : ré-appel sur un produit déjà `is_active=false` → renvoie `{ deleted:true, idempotent_replay:true }` sans nouvel audit (pas de table dédiée — un soft-delete est naturellement idempotent ; le `p_idempotency_key` est journalisé dans l'audit metadata mais ne sert pas de PK).
- `audit_logs` : `actor_id / action='product.deleted' / entity_type='product' / entity_id=p_product_id / metadata={ sku, name, idempotency_key }`.
- **REVOKE pair canonique S25** (3 lignes : PUBLIC + anon + ALTER DEFAULT PRIVILEGES). Migration `20260629000011` ou inline — au choix de l'exécutant, NAME-block monotone.
- Types regen via MCP → `packages/supabase/src/types.generated.ts` + commit.

### Wave B — Front : suppression (B1 UI)

- `useDeleteProduct()` — mutation appelant `supabase.rpc('delete_product_v1', { p_product_id, p_idempotency_key })` (idempotency `useRef(crypto.randomUUID())`, **bind** `supabase.rpc` cf. pattern stock-audit C1), invalide `['products']` au succès, toast succès/erreur (mappe `parent_has_active_variants` → message FR explicite).
- `DeleteProductDialog` — confirmation (nom + SKU + avertissement « le produit sera désactivé, masqué du catalogue et du POS ; les commandes passées sont conservées »), bouton destructif, pending state. Réutilise le primitive Dialog `@breakery/ui` (pas de `<Select>`/`<RadioGroup>` — non exportés).
- `Products.tsx` : `onDelete={canDelete ? (row) => setToDelete(row) : undefined}` (gate `products.delete` via `authStore.hasPermission`) + montage du dialog. **Le bouton Trash2 ne doit s'afficher que si `canDelete`** (durcir `ProductsTable` : rendre l'action conditionnelle comme `VariantRowSortable`, sinon un MANAGER voit un bouton qui ne fait rien → régression du même bug).

### Wave C — Front : edit pricing (B2)

- **D3** : `$` ouvre le **détail produit sur l'onglet General** (où `retail_price`/`wholesale_price` sont éditables). Mécanisme : `ProductDetailPage` lit un query param `?tab=` au montage pour initialiser l'onglet actif (aujourd'hui state interne pur). `onPricing={(row) => navigate('/backoffice/products/' + row.id + '?tab=general')}`.
- `ProductsTable` : passer `onPricing` (et n'afficher le `$` que si l'utilisateur peut éditer — gate `products.update`).

### Wave D — Front : pills en-tête (B3/B4/B5/B6)

- `Products.tsx` câble sur `ProductsHeader` :
  - `onImport={canImport ? () => navigate('/backoffice/products/import-export') : undefined}` (gate `catalog.import`, aligné sur l'onglet).
  - `onRecipes={() => navigate('/backoffice/inventory/recipes')}`.
- **D1 — Modifiers** : **retirer le pill Modifiers** de `ProductsHeader` (aucune destination n'existe dans le projet ; construire un gestionnaire de modifiers global est une feature séparée hors scope). Le prop `onModifiers` reste dans l'interface mais le bouton n'est plus rendu. *(Décision à valider owner — alternative : le garder désactivé avec tooltip « Bientôt ».)*
- **D4 — Products** : le pill « Products » (page courante) rendu **non-interactif** (retirer le `<button>` cliquable → `<span>` état actif, ou `aria-current="page"` + `disabled`) pour ne plus simuler une action.

## 3. Décisions (à acter)

| ID | Décision | Choix proposé | Réversible ? |
|----|----------|---------------|--------------|
| **D1** | Pill Modifiers sans destination | **Retirer le bouton** (pas de page Modifiers globale) | oui (1 ligne) |
| **D2** | Soft-delete d'un parent de variantes | **Bloquer** si variantes actives (P0001) → dissoudre d'abord | n/a |
| **D3** | Cible du `$` Edit pricing | Deep-link détail → onglet **General** via `?tab=` | oui |
| **D4** | Pill « Products » (page courante) | Rendu **statique** non-cliquable | oui |
| **D-W1-01** | Visibilité corbeille pour MANAGER | `products.delete` non accordée à MANAGER (seed S13) → bouton **masqué** pour MANAGER. Pas de changement de perm en S45. | oui (seed) |

## 4. Tests

**pgTAP `supabase/tests/delete_product_v1.test.sql`** (cloud MCP, BEGIN/ROLLBACK, jwt-claims simulées) :
- T1 happy : soft-delete → `is_active=false`, renvoie `deleted:true`.
- T2 perm : CASHIER **et** MANAGER → 42501.
- T3 garde D2 : parent avec variante active → P0001 `parent_has_active_variants`.
- T4 idempotence : 2ᵉ appel → `idempotent_replay:true`, pas de 2ᵉ audit.
- T5 audit_logs : 1 ligne `product.deleted` cols canoniques.
- T6 REVOKE : `anon` n'a pas EXECUTE.

**Smokes BO (Vitest)** :
- `delete-product-dialog.smoke.test.tsx` — confirm appelle la mutation ; mappe l'erreur parent.
- `products-actions-wiring.smoke.test.tsx` — Trash2 masqué sans `products.delete` ; `$` navigue `?tab=general` ; Import/Recipes naviguent ; **pas** de bouton Modifiers ; Products pill non-cliquable.
- `product-detail-tab-param.smoke.test.tsx` — `?tab=general` initialise l'onglet General.

**Régression** : sweep BO complet + `pnpm typecheck` 6/6. (Aucun POS/domain touché.)

## 5. Hors scope (backlog S46+)

- Page de gestion **Modifiers** globale (B5 destination réelle).
- Dialog d'édition pricing inline (multi-catégories clients) — S45 se contente du deep-link.
- **Bulk delete** / restore (un-delete) produits ; vue « corbeille ».
- Hard-delete / purge data legacy.
- Câblage tab-param générique sur les autres detail pages.

## 6. Critères d'acceptation

1. Les 6 boutons sont soit **fonctionnels**, soit **retirés** (zéro bouton mort restant sur `/backoffice/products`).
2. `delete_product_v1` : soft-delete gated, garde parent, idempotent, audité, REVOKE pair — pgTAP 6/6 cloud.
3. Trash2 et `$` **conditionnels** aux permissions (pas de bouton inerte affiché).
4. Vérif **live navigateur** (playwright-cli) : delete réel d'un produit jetable → disparaît du catalogue actif + vérif DB `is_active=false` ; Import/Recipes naviguent ; `$` ouvre l'onglet General.
5. typecheck 6/6 + sweep BO sans nouvelle failure.
6. Reviews : spec-review + code-review par wave (subagent), pattern-guardian sur le diff migration, test-engineer sur le pgTAP.
