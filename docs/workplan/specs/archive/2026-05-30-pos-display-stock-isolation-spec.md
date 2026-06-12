# Spec — Isolation du stock vitrine POS (V1)

- **Date** : 2026-05-30
- **Topic** : `pos-display-stock-isolation`
- **Type** : feature standalone (hors cycle session numéroté)
- **Statut** : design validé — en attente relecture avant plan d'implémentation
- **Base** : `master` post-S32 (PR #40, `780e12e`)

---

## 1. Contexte & problème

Le module **stock du POS** (`apps/pos/src/features/stock`) est, par intention métier (owner, 2026-05-30), un **compteur de vitrine (display-case)** : il enregistre les produits finis sortis de la cuisine et mis en présentoir, et sert à **éviter de vendre un produit dont la vitrine est vide**. Il est censé être **indépendant** du module stock du back office.

**Cette indépendance n'existe pas dans le code actuel** :

- `usePOSReceiveStock` → `record_incoming_stock_v1` insère un `stock_movements` (type `incoming`) et incrémente le **global** `products.current_stock` — la colonne que lit aussi le BO (`get_stock_levels_v1`, wastage, perishable-turnover).
- La réception POS gonfle donc `current_stock` à `cost_price = 0` (le POS ne transmet jamais `p_unit_cost`), faussant les rapports d'inventaire BO.
- Un ajustement / opname BO sur un produit fini écrase le compteur vitrine du POS, et inversement — interférence croisée silencieuse.

Audit du 2026-05-30 (skill `stock-management`) : voir le bloc « POS display-stock vs BO stock » du SKILL et la mémoire projet `pos-stock-display-counter`.

## 2. Modèle métier validé

Un produit fini exposé possède **deux stocks distincts** :

- **Stock BO** (`products.current_stock`) — inventaire total de l'entreprise, alimenté par la **production** (`record_production_v1`), valorisé au coût recette.
- **Stock vitrine** (nouveau `display_stock`) — sous-ensemble physiquement en présentoir, propre au POS.

Seuls les **produits finis exposés** ont un stock vitrine (drapeau `products.is_display_item`). Les produits préparés à la commande (café, boissons) n'en ont pas.

### Comportement des stocks par geste

| Geste | `current_stock` (BO) | `display_stock` (vitrine) | Compta |
|---|---|---|---|
| Production cuisine (`record_production_v1`) | **+q** | — | inchangé (chemin existant) |
| **Mise en vitrine** (geste POS) | — *(ne touche plus le BO)* | **+q** | aucune |
| **Vente** (POS) | **−q** | **−q** | JE COGS (chemin existant) |
| **Retour cuisine** (clôture, transformation) | — *(déjà compté en cuisine)* | **−q** | aucune |
| **Paquet discount J+1** (clôture) | — | — *(reste présent)* | aucune → **non-geste en V1** |
| **Perte réelle** (saisie manuelle caisse) | **−q** | **−q** | **JE perte** (waste expense) |

### Garde de vente

Pour un produit `is_display_item`, le blocage « pas de vente si vide » porte **uniquement sur `display_stock`**. La déduction `current_stock` correspondante **n'est pas bloquante** et peut faire passer `current_stock` en négatif (signal métier : vendu plus que la production saisie au BO). Pour les produits non-display, le comportement actuel (garde sur `current_stock`) est **inchangé**.

## 3. Périmètre

### Dans la V1
Isolation + clôture (gestes purement stock) :
1. Drapeau produit + tables compteur/ledger vitrine.
2. Mise en vitrine.
3. Vente : double déduction indépendante (BO + vitrine), garde sur vitrine.
4. Clôture : retour cuisine (display-only) + perte (double déduction + JE).
5. BO : flag éditable + écran de consultation read-only.

### Hors V1 (chantiers ultérieurs)
- **Revente en paquet discount J+1** (pricing / catalogue — le stock vitrine ne bouge pas, les produits restent comptés en vitrine). Nécessitera vraisemblablement un suivi de **datation/péremption** du `display_stock` → spec dédiée.
- **Migration de données** des `current_stock` historiques gonflés par d'anciens `incoming` POS (négligeable : V3 dev only, pas de prod V3).
- Suivi de péremption / FIFO sur le stock vitrine.

## 4. Modèle de données

### 4.1 `products.is_display_item`
```sql
ALTER TABLE products
  ADD COLUMN is_display_item BOOLEAN NOT NULL DEFAULT false;
```
Marque les produits finis exposés. Ajouté à l'allowlist de `create_product_v1` et `update_product_v1`.

### 4.2 Table `display_stock` (cache compteur)
```
product_id   UUID PK → products(id)
quantity     NUMERIC(10,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0)
updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
```
- RLS : `SELECT` gaté `display.read` ; `INSERT/UPDATE/DELETE` **révoqués** pour `authenticated` (écriture par RPC SECURITY DEFINER uniquement).
- Trigger `set_updated_at`.

### 4.3 Table `display_movements` (ledger append-only — source de vérité)
```
id              UUID PK DEFAULT gen_random_uuid()
product_id      UUID NOT NULL → products(id)
movement_type   display_movement_type NOT NULL
quantity        NUMERIC(10,3) NOT NULL CHECK (quantity <> 0)   -- signée
reason          TEXT
reference_type  TEXT          -- ex. 'order' pour une vente
reference_id    UUID          -- ex. order_id
created_by      UUID NOT NULL → user_profiles(id)
idempotency_key UUID UNIQUE
created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
```
- ENUM `display_movement_type` : `stock_in`, `sale`, `return_to_kitchen`, `waste`, `adjustment`. *(Réservé V2 : ajout possible sans migration cassante — `to_discount` n'est PAS nécessaire car le paquet discount ne déplace pas le stock.)*
- RLS : `SELECT` gaté `display.read` ; écritures révoquées (RPC SECURITY DEFINER seulement) — **pattern `stock_movements`, mais table séparée → zéro contact avec le ledger BO**.
- Index : `(product_id, created_at DESC)`.

> **Note d'isolation** : `display_stock` / `display_movements` ne sont **jamais** touchés par `record_stock_movement_v1` ni les triggers BO (`tr_20_je_emit`, `tr_update_product_cost_on_purchase`). Aucun JE inventaire n'est émis sur la mise en vitrine / retour cuisine. La seule passerelle vitrine→BO est la **vente** et la **perte**, gérées explicitement dans leurs RPC respectives.

## 5. RPCs

Toutes : `SECURITY DEFINER SET search_path = public`, gate `has_permission`, `p_idempotency_key UUID` (replay via `display_movements.idempotency_key UNIQUE` + catch `unique_violation`), REVOKE pair canonique S25 (`REVOKE EXECUTE … FROM PUBLIC` + `FROM anon` + `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`), retour JSONB `{ product_id, new_display_stock, idempotent_replay }`.

### 5.1 `add_display_stock_v1(p_product_id, p_quantity, p_reason, p_idempotency_key)`
Mise en vitrine. Gate `display.manage`. Erreurs : `forbidden` (P0003), `not_a_display_item` (P0002 si `is_display_item=false`), `quantity_must_be_positive`. Effet : `display_movements 'stock_in' (+q)` + `display_stock += q` (UPSERT). **Aucun effet BO.**

### 5.2 `return_display_to_kitchen_v1(p_product_id, p_quantity, p_reason, p_idempotency_key)`
Retour cuisine (clôture). Gate `display.manage`. Garde `display_stock >= q` sinon `insufficient_display_stock` (P0002). Effet : `display_movements 'return_to_kitchen' (−q)` + `display_stock −= q`. **`current_stock` inchangé, aucun JE** (le produit reste compté en stock cuisine BO).

### 5.3 `waste_display_stock_v1(p_product_id, p_quantity, p_reason, p_idempotency_key)`
Perte réelle (saisie caisse). Gate `display.manage`. Garde `display_stock >= q`. Effet :
- **vitrine** : `display_movements 'waste' (−q)` + `display_stock −= q` ;
- **BO** : émet la perte comptable → `stock_movements 'waste' (−q)` (déclenche `tr_20_je_emit` → JE waste expense) + `current_stock −= q`.
- **Point d'attention** : la déduction BO ici **n'est pas bloquée** par une garde `current_stock` (cohérence avec « garde sur vitrine seule ») — `current_stock` peut passer négatif. À implémenter via la primitive interne ou un INSERT contrôlé, **sans** réutiliser la garde `insufficient_stock` de `waste_stock_v1`.

### 5.4 `adjust_display_stock_v1(p_product_id, p_new_qty, p_reason, p_idempotency_key)`
Correction de comptage vitrine. Gate `display.manage`. `p_reason` requis (≥ 3 chars). Effet : `display_movements 'adjustment' (delta signé)` + `display_stock = p_new_qty`. **Aucun effet BO.**

## 6. Bump `complete_order_with_payment_v9` → `_v10`

RPC critique (JE, loyalty, promotions). Stratégie : `CREATE FUNCTION …_v10` + `DROP FUNCTION …_v9(<signature exacte>)` dans la **même** migration ; REVOKE pair sur v10 ; bump de tous les callers POS ; types regen.

**Signature** : identique à v9 (aucun nouvel argument).

**Changement, dans la boucle d'items** — pour chaque ligne dont `products.is_display_item = true` :
1. **Garde** : `IF display_stock < quantity THEN RAISE 'insufficient_display_stock'`. Cette garde **remplace** la garde `current_stock < quantity` actuelle pour ces produits (la déduction `current_stock` devient non-bloquante et peut passer négatif).
2. **Déduction BO** (chemin existant préservé) : `stock_movements 'sale'` + `current_stock −= q` + JE COGS.
3. **Déduction vitrine** (ajout) : `display_movements 'sale' (−q, reference_type='order', reference_id=order_id)` + `display_stock −= q`.

Pour les produits **non-display** : comportement **100 % inchangé** (garde + déduction sur `current_stock`).

**Idempotency** : la garde d'idempotence de l'order (sur `p_idempotency_key`) couvre l'ensemble — un replay de l'order ne réinsère ni le `stock_movements 'sale'` ni le `display_movements 'sale'`.

## 7. POS (`apps/pos/src/features/stock`)

- `usePOSReceiveStock.ts` : `record_incoming_stock_v1` → **`add_display_stock_v1`**.
- `usePOSStockProducts.ts` : lire `display_stock.quantity` (LEFT JOIN sur `product_id`) **au lieu de** `products.current_stock` pour l'affichage vitrine ; filtrer sur `is_display_item = true`.
- `POSStockView.tsx` / `POSStockCard.tsx` : afficher le compteur vitrine ; KPIs out/low calculés sur `display_stock`.
- Nouveaux hooks + UI clôture : `useReturnToKitchen` (`return_display_to_kitchen_v1`), `useWasteDisplay` (`waste_display_stock_v1`), `useAdjustDisplay` (`adjust_display_stock_v1`).
- `useCompleteOrder*` : bump appel `complete_order_with_payment_v9` → `_v10`.

## 8. Back office

- **Éditeur produit** : toggle `is_display_item` (ajout allowlist `update_product_v1` + `create_product_v1` + UI `GeneralPanel` / `NewProductDialog`).
- **Rapports d'inventaire** : aucun changement requis — le découplage vient de la mise en vitrine qui ne touche plus `current_stock`. Vérifier en régression que `get_stock_levels_v1` / wastage / perishable ne régressent pas.
- **Nouvelle page read-only « Stock vitrine »** (`/backoffice/inventory/display` ou onglet) : `useDisplayStock` (liste compteurs) + `useDisplayMovements` (ledger récent, cursor). Gate `display.read`. Sidebar entry.

## 9. Permissions (seed)

- `display.read` — consultation (POS + BO). Roles : tout staff (CASHIER, waiter, MANAGER, ADMIN, SUPER_ADMIN).
- `display.manage` — gestes vitrine (add / return / waste / adjust). Roles : CASHIER, waiter, MANAGER, ADMIN, SUPER_ADMIN.

## 10. Tests

**pgTAP** `supabase/tests/display_stock.test.sql` :
- `add_display_stock_v1` : happy + perm denied + `not_a_display_item` + idempotent replay.
- `return_display_to_kitchen_v1` : happy (display −q, `current_stock` inchangé) + garde insuffisant.
- `waste_display_stock_v1` : happy (display −q **et** `current_stock` −q + JE waste émis) + `current_stock` autorisé négatif.
- `adjust_display_stock_v1` : happy + reason requis.
- **bump `complete_order…_v10`** : vente produit display (double déduction), vente non-display (inchangé), vente mixte, garde `insufficient_display_stock` quand vitrine vide, `current_stock` négatif toléré pour display, idempotency replay (pas de double déduction).
- REVOKE pair vérifiée (anon `EXECUTE = false`) sur les 4 nouvelles RPC + v10.

**Smoke** : POS (`usePOSReceiveStock` cible la nouvelle RPC ; affichage `display_stock`) ; BO (toggle `is_display_item` ; page Stock vitrine). Régression : suites `complete_order` / inventory existantes vertes.

## 11. Risques & points d'attention

- **R1 — bump `complete_order…_v10`** : RPC la plus critique du système. Drop+create même migration, bump tous les callers, types regen, pgTAP de non-régression obligatoire (vente standard, paiement, loyalty, promo).
- **R2 — `current_stock` négatif** : nouveau régime pour les produits display (vente + waste non bloquants côté BO). Vérifier l'absence de `CHECK (current_stock >= 0)` sur `products` ; si présent, le relâcher pour les produits display (ou globalement, documenté).
- **R3 — produits déjà vendus via `current_stock`** : à la bascule, marquer `is_display_item` ne migre pas le `display_stock` (démarre à 0, la vitrine se remplit au prochain geste). Acceptable (dev only).
- **R4 — double source d'affichage** : bien cantonner la lecture POS au `display_stock` pour les produits display, sinon confusion compteur BO vs vitrine.

## 12. Séquence de migrations

Bloc monotone **après** S32 (`20260617000014`). Proposé `20260618000010…` (timestamps assignés à l'implémentation) :
- `_010` ENUM `display_movement_type` + `ALTER products ADD is_display_item`
- `_011` table `display_stock` + RLS + trigger
- `_012` table `display_movements` + RLS + index
- `_013..016` 4 RPCs + REVOKE pairs
- `_017` bump `complete_order_with_payment_v10` + DROP v9 + REVOKE pair
- `_018` allowlist `is_display_item` dans `create_product_v1` + `update_product_v1`
- `_019` seed perms `display.read` + `display.manage` + role grants
- types regen après `_010` (enum/col) et après `_019` (final)

---

## Hors-scope explicite (rappel)
Paquet discount J+1, datation/péremption vitrine, FIFO vitrine, migration des `current_stock` historiques, suivi de valorisation du `display_stock` (le stock vitrine n'est jamais valorisé — le coût vit côté BO).
