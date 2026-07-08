# S69 — CRUD Customer Categories + Prix négocié par client (B2B) — Design

> **Date :** 2026-07-08 · **Session :** S69 · **Branche cible :** `swarm/session-69`
> **Ferme :** fiche 08 **D2.1** (déviation D-W6-CUSTCAT-01, page catégories read-only depuis S14) **et** fiche 09 **B1.1** (« prix négocié appliqué automatiquement » — surclaim 🔴).
> **Décisions propriétaire (2026-07-08, brainstorm) :** prix négocié **par CLIENT** · appliqué **B2B seulement** · overrides catégorie inchangés (type `custom`) · delete catégorie **bloqué** si clients rattachés · les **deux volets** dans S69 · perm dédiée `customer_prices.manage` · lecture `customer_product_prices` en `authenticated`.

## 1. Contexte & état réel

L'architecture de prix de The Breakery est **par catégorie client** (`get_customer_product_price`, `_resolve_line_price_v1`) :

- Table `customer_categories` (`20260509000001`) : `price_modifier_type` ∈ {`retail`, `wholesale`, `discount_percentage`, `custom`}, `discount_percentage`, `points_multiplier`, `is_default`, `is_active`, soft-delete `deleted_at`, `slug` unique (`UNIQUE NULLS NOT DISTINCT`), index partiel `idx_customer_categories_one_default` (un seul défaut vivant).
- Table `product_category_prices` (`20260509000003`) : overrides prix produit-par-produit, **lus uniquement quand la catégorie est de type `custom`** (`get_customer_product_price` l.41-47).
- Résolution serveur money-path : `_resolve_line_price_v1` (S51) re-résout le prix ligne par catégorie du client au POS. `create_b2b_order_v4` (S53/S68) **facture le `unit_price` envoyé par le client** — aucune résolution serveur, aucun prix négocié.
- **Permissions `customer_categories.create/update/delete` déjà seedées** (`20260513000004`, accordées aux rôles admin) + policies RLS INSERT/UPDATE gatées (`20260513000005`). **Il manque uniquement les RPCs d'écriture** : la page `CustomerCategoriesPage` est explicitement read-only (déviation D-W6-CUSTCAT-01), `PricingTab` affiche les overrides sans les éditer.

Le manque fonctionnel se résume donc à : (A) exposer le CRUD catégories + l'édition des overrides catégorie, et (B) ajouter une couche de **prix négocié par client** appliquée aux commandes B2B.

## 2. Périmètre (et non-périmètre)

**Dans le périmètre :**
- Volet A — CRUD catégories client + édition des overrides `product_category_prices`.
- Volet B — table `customer_product_prices` + perm dédiée + résolution serveur **dans les commandes B2B** (`create_b2b_order_v5`) + UI d'édition sur la fiche client.

**Hors périmètre (non-goals) :**
- **Aucune modification de la money-path POS** : `complete_order_with_payment_v17`, `pay_existing_order_v11`, `_resolve_line_price_v1`, `get_customer_product_price` restent **inchangés**. Le prix négocié client ne s'applique **pas** au comptoir (décision propriétaire) → pas de mismatch affichage/facturation POS.
- Pas de changement du comportement des overrides catégorie (toujours lus au seul type `custom`).
- Pas de cycle de livraison B2B, pas d'avoirs, pas de QR membre (autres fiches).

## 3. Volet A — CRUD Customer Categories

### 3.1 RPCs (SECURITY DEFINER, trio REVOKE anon/PUBLIC + `ALTER DEFAULT PRIVILEGES`, écrivent `audit_logs`)

| RPC | Gate | Comportement / gardes |
|---|---|---|
| `create_customer_category_v1(p_name, p_slug, p_price_modifier_type, p_discount_percentage, p_points_multiplier, p_loyalty_enabled, p_color, p_icon, p_is_default)` | `customer_categories.create` | Insère une catégorie. Gardes : `slug` non vide + unique (23505 → `slug_taken`), `p_discount_percentage ∈ [0,100]`, `p_points_multiplier ≥ 0`, `price_modifier_type` valide. Si `p_is_default = true` : `UPDATE customer_categories SET is_default = false WHERE is_default` d'abord (même transaction, respecte l'index partiel). Retourne la ligne créée. |
| `update_customer_category_v1(p_id, …mêmes champs…)` | `customer_categories.update` | Met à jour. Mêmes gardes. **Interdit de retirer `is_default` du dernier défaut** (→ `default_required`). Bascule de défaut : retire l'ancien d'abord. 404 → `category_not_found`. |
| `delete_customer_category_v1(p_id)` | `customer_categories.delete` | **Soft-delete** (`deleted_at = now()`, `is_active = false`). **Refuse si `is_default`** (→ `cannot_delete_default`). **Refuse si ≥ 1 client rattaché** : `EXISTS (SELECT 1 FROM customers WHERE category_id = p_id AND deleted_at IS NULL)` → `category_in_use`. Idempotent (re-delete d'une catégorie déjà supprimée = no-op). |
| `upsert_product_category_price_v1(p_category_id, p_product_id, p_price)` | `customer_categories.update` | `INSERT … ON CONFLICT (product_id, customer_category_id) DO UPDATE SET price`. Garde `p_price ≥ 0`, catégorie et produit existent (non soft-deleted). |
| `delete_product_category_price_v1(p_category_id, p_product_id)` | `customer_categories.update` | Supprime l'override (hard-delete de la ligne de jointure — pas de soft-delete métier ici). Idempotent. |

**Note de conception :** ces RPCs écrivent des tables déjà protégées par RLS gatée ; le SECURITY DEFINER + gate `has_permission` centralise l'audit et les gardes métier (unicité défaut, `category_in_use`) que la seule RLS ne peut pas exprimer.

### 3.2 UI Backoffice
- **`CustomerCategoriesPage`** : activer les boutons New / Edit / Delete. Nouveau `CategoryFormModal` (primitifs `@breakery/ui` : `Dialog`, `Input`, select **natif** pour `price_modifier_type` — pas de `Select` exporté, cf. breakery-ui-kit ; tokens sémantiques, zéro hex). Champ `discount_percentage` visible seulement si type = `discount_percentage`. Confirmation de suppression (message `category_in_use` remonté si refus). Retirer le bandeau/commentaire de déviation D-W6-CUSTCAT-01.
- **Hooks** : `useCreateCustomerCategory`, `useUpdateCustomerCategory`, `useDeleteCustomerCategory` (invalident `useCustomerCategories`), avec `classify()` des erreurs typées (`slug_taken`, `category_in_use`, `cannot_delete_default`, `default_required`, `permission_denied`).
- **`PricingTab`** (fiche client, quand catégorie = `custom`) : rendre la table d'overrides éditable — ajouter une ligne (picker produit + prix), éditer un prix, supprimer une ligne — via `upsert/delete_product_category_price_v1`. Hook `useCustomerCategoryPrices` étendu (mutations) ; l'édition porte sur la **catégorie** du client (les overrides sont partagés par catégorie, pas propres au client — libellé explicite dans l'UI pour éviter la confusion avec le prix négocié par client du Volet B).

## 4. Volet B — Prix négocié par client (B2B)

### 4.1 Schéma
```sql
CREATE TABLE customer_product_prices (
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products(id)  ON DELETE CASCADE,
  price       DECIMAL(12,2) NOT NULL CHECK (price >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, product_id)
);
-- trigger set_updated_at
-- RLS : SELECT pour authenticated ; INSERT/UPDATE/DELETE bloqués au rôle (écriture par RPC SECURITY DEFINER)
-- REVOKE trio (anon via PUBLIC + ALTER DEFAULT PRIVILEGES)
```

### 4.2 Permission
- Nouvelle permission **`customer_prices.manage`** (module `customer_prices`, action `manage`), seedée **MANAGER / ADMIN / SUPER_ADMIN**. Gate les 2 RPCs d'écriture. La lecture passe par RLS `authenticated` (cohérent avec `product_category_prices`).

### 4.3 RPCs
| RPC | Gate | Comportement |
|---|---|---|
| `upsert_customer_product_price_v1(p_customer_id, p_product_id, p_price)` | `customer_prices.manage` | `INSERT … ON CONFLICT (customer_id, product_id) DO UPDATE`. Garde `p_price ≥ 0`, client + produit existent. `audit_logs`. |
| `delete_customer_product_price_v1(p_customer_id, p_product_id)` | `customer_prices.manage` | Supprime la ligne. Idempotent. `audit_logs`. |

### 4.4 Application serveur — `create_b2b_order_v4 → v5`
- **Bump v5** (corps repris du **live** v4 — DEV-S57-02, jamais du fichier de migration d'origine), `DROP FUNCTION create_b2b_order_v4(<args>)` dans la même migration, `GRANT EXECUTE TO authenticated` (l'EF/BO appelle via JWT — caveat récurrent).
- **Résolution serveur du prix ligne** (pattern S51 « prix canonique serveur ») via un helper interne **`_resolve_b2b_line_price_v1(p_customer_id, p_product_id)`** (SECURITY DEFINER STABLE, REVOKE anon+authenticated+PUBLIC) :
  ```
  prix = COALESCE(
    (SELECT price FROM customer_product_prices WHERE customer_id = p_customer AND product_id = p_product),  -- 1. prix négocié client
    get_customer_product_price(p_product, p_customer),  -- 2. prix catégorie du client (retail/wholesale/discount%/custom)
    (SELECT retail_price FROM products WHERE id = p_product)  -- 3. filet
  )
  ```
  Le `unit_price` envoyé par le client devient **indicatif/ignoré** (comme le POS depuis S51). Le reste de v5 (garde stock flag-aware, `_record_sale_stock_v1` display-aware, JE AR/revenue, `invoice_number` S68, idempotence, plafond crédit TOCTOU) est **byte-identique à v4** — bump additif sur la seule résolution de prix.
- **`_resolve_line_price_v1` et `get_customer_product_price` NE sont PAS modifiés** → le POS (affichage `ProductTapHandler` + money-path v17) est inchangé. Le prix négocié client est confiné au chemin B2B.

### 4.5 UI Backoffice B2B
- **Fiche client** : nouvelle section/onglet « Negotiated prices » (visible pour les clients, utile surtout B2B) — table éditable des prix négociés du client (picker produit + prix), via `upsert/delete_customer_product_price_v1`, gate `customer_prices.manage`. Hook `useCustomerNegotiatedPrices` (read RLS + mutations).
- **`CreateB2bOrderModal`** : préremplir le prix de ligne depuis les prix négociés du client (fetch advisory) plutôt que le seul prix catalogue ; bandeau « le prix final est déterminé par le serveur » (le serveur v5 tranche). Le champ reste affiché ; l'utilisateur voit le prix négocié appliqué.

## 5. Tests

### pgTAP (via MCP `execute_sql`, enveloppe `BEGIN … ROLLBACK`)
- **`customer_category_crud.test.sql`** : create (slug unique 23505→`slug_taken`, discount hors bornes, is_default bascule), update (`default_required`, `category_not_found`), delete (`cannot_delete_default`, `category_in_use` avec client rattaché, soft-delete effectif, idempotence), `upsert/delete_product_category_price_v1` (prix ≥ 0, upsert conflict), ACL anon/`authenticated` sans perm → `permission_denied`.
- **`customer_product_prices_rls.test.sql`** : REVOKE rôle (INSERT/UPDATE/DELETE direct interdits), RLS SELECT `authenticated`, `upsert_customer_product_price_v1` conflict, `delete` idempotent, ACL sans `customer_prices.manage`.
- **`b2b_negotiated_price.test.sql`** : `create_b2b_order_v5` facture (1) le prix négocié client quand présent, (2) le prix catégorie sinon, (3) retail en filet ; **le `unit_price` client est ignoré** (envoyer un prix bidon → facturé au prix résolu) ; interaction avec catégorie `custom` (négocié client > override catégorie).

### Ancres money-path (re-vertes live après bump v5)
- `b2b_settlement` 14/14 (repointer v5) · `b2b_display_aware_stock` 3/3 (repointer v5) · `b2b_order_flag_aware_stock` A/B/C (repointer v5) · **`s44_money_gates` 12/12** (POS non touché → doit rester vert sans repoint).

### Smoke BO / types
- Smoke `CustomerCategoriesPage` (CRUD boutons actifs, form modal) + `PricingTab` (édition overrides) + section prix négociés fiche client.
- **Types regénérés** (`customer_product_prices`, `create_b2b_order_v5`, nouveaux RPCs, perm) → `packages/supabase/src/types.generated.ts`, no-drift vérifié.

## 6. Migrations & séquencement

Max local = `20260710000134` (S68). S69 démarre à **`20260710000135`** (confirmer via MCP `list_migrations` avant le 1er apply). Ordre proposé :

1. `_135` — RPCs CRUD catégories (`create/update/delete_customer_category_v1`) + trio REVOKE.
2. `_136` — RPCs overrides catégorie (`upsert/delete_product_category_price_v1`).
3. `_137` — table `customer_product_prices` (RLS + REVOKE trio) + perm `customer_prices.manage` (seed rôles).
4. `_138` — RPCs `upsert/delete_customer_product_price_v1`.
5. `_139` — helper `_resolve_b2b_line_price_v1` + `create_b2b_order_v5` (DROP v4, GRANT authenticated).

**Deux vagues d'implémentation :**
- **Vague 1 (hors money-path, parallélisable)** : `_135`, `_136` + UI Volet A (CustomerCategoriesPage, PricingTab, hooks) + pgTAP `customer_category_crud`.
- **Vague 2 (sous garde money-path)** : `_137`, `_138`, `_139` + UI Volet B (fiche client négocié, CreateB2bOrderModal) + pgTAP `customer_product_prices_rls` / `b2b_negotiated_price` + repoint & re-vert des ancres B2B.

## 7. Dépendances croisées & risques
- **Module 5 (Catalogue)** : les overrides `product_category_prices` sont partagés — D2.1 module 5 débloqué au passage.
- **Module 9 (B2B)** : v5 bump additif ; risque principal = régression sur la résolution de prix → couvert par `b2b_negotiated_price` + repoint des 3 ancres B2B.
- **Money-path POS** : **non touchée** — `s44_money_gates` doit rester vert sans intervention (garde-fou de non-régression).
- **Confidentialité** : `customer_product_prices` lisible par tout `authenticated` (choix propriétaire, cohérent avec l'existant) — si un durcissement `b2b.read` est souhaité plus tard, c'est un ALTER POLICY isolé.

## 8. Critères d'acceptation
1. Un manager crée/édite/supprime une catégorie client depuis le BO (delete refusé si clients rattachés) — D-W6-CUSTCAT-01 fermée.
2. Un manager édite les overrides prix d'une catégorie `custom` depuis `PricingTab`.
3. Un manager enregistre des prix négociés produit-par-produit pour un client donné.
4. Une commande B2B pour ce client **facture automatiquement** les prix négociés (serveur autoritaire, `unit_price` client ignoré) — fiche 09 B1.1 fermée.
5. Suite monorepo verte (typecheck/build/test), pgTAP nouvelles suites + ancres B2B + `s44_money_gates` vertes, types no-drift.
