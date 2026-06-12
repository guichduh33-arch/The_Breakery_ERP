# Isolation du stock vitrine POS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner aux produits finis exposés deux stocks distincts — le `current_stock` BO (inventaire entreprise, alimenté par la production) et un nouveau `display_stock` vitrine propre au POS — pour que la mise en vitrine et la clôture ne polluent plus les rapports d'inventaire BO, tout en gardant la vente comme seule passerelle de double déduction.

**Architecture :** Deux nouvelles tables isolées (`display_stock` cache + `display_movements` ledger append-only) jamais touchées par `record_stock_movement_v1` ni les triggers BO. Quatre RPCs `SECURITY DEFINER` pour les gestes vitrine (mise en vitrine / retour cuisine / perte / ajustement). Bump de la RPC critique `complete_order_with_payment_v9 → _v10` qui ajoute la déduction vitrine + déplace la garde de vente sur `display_stock` pour les produits `is_display_item`. Le POS lit `display_stock` au lieu de `current_stock` pour la vue vitrine. Le BO gagne un toggle `is_display_item` + un écran de consultation read-only.

**Tech Stack :** Supabase Postgres (cloud V3 dev `ikcyvlovptebroadgtvd`, migrations via MCP `apply_migration`, tests via MCP `execute_sql` pgTAP) · Deno Edge Functions · React + React Router + @tanstack/react-query + Zustand (apps/pos, apps/backoffice) · TypeScript · pnpm + turbo · Vitest.

---

## Contexte de référence (lire avant de commencer)

- **Spec source** : [`docs/workplan/specs/2026-05-30-pos-display-stock-isolation-spec.md`](../../specs/archive/2026-05-30-pos-display-stock-isolation-spec.md) — le modèle métier validé. Ce plan en est la traduction exécutable.
- **Mémoire projet** : `pos-stock-display-counter` (le module stock POS EST un compteur de vitrine, indépendant en intention du BO).
- **Base** : branche `feat/pos-display-stock-isolation` (déjà checkout), `master` post-S32 (`780e12e`).

### Faits du codebase vérifiés (sources exactes — ne pas re-supposer)

| Fait | Source |
|---|---|
| **Aucun** `CHECK (current_stock >= 0)` sur `products` (`current_stock DECIMAL(10,3) NOT NULL DEFAULT 0`) | `supabase/migrations/20260503000002_init_catalog.sql:25` |
| Contrainte `chk_stock_movements_section_required` **exempte `waste`** → INSERT direct type `waste` sans section valide | `supabase/migrations/20260516000020_relax_stock_movements_section_constraint.sql` |
| Trigger `tr_20_je_emit` (AFTER INSERT sur `stock_movements`) émet JE `waste` (DR `WASTE_EXPENSE` / CR `INVENTORY_GENERAL`) **uniquement si `cost_price × |qty| > 0`** | `supabase/migrations/20260517000022_create_tr_stock_movement_je_function.sql:44-79` |
| `complete_order_with_payment_v9` signature 16 params + garde stock (boucle validation l.183-187) + déduction (boucle insertion l.394-405) | `supabase/migrations/20260517000015_bump_complete_order_v9.sql` |
| Seul caller de la RPC : l'Edge Function `process-payment` (`userClient.rpc('complete_order_with_payment_v9', …)`) | `supabase/functions/process-payment/index.ts:149` |
| `create_product_v1(p_payload JSONB)` allowlist 21 cols + INSERT explicite | `supabase/migrations/20260520101735_create_create_product_v1_rpc.sql:13-21,71-101` |
| `update_product_v1(p_product_id UUID, p_patch JSONB)` allowlist 18 cols + UPDATE COALESCE | `supabase/migrations/20260520023035_create_update_product_v1_rpc.sql:13-20,40-59` |
| Template REVOKE pair canonique S25 | `supabase/migrations/20260617000014_revoke_anon_get_orders_list_v1.sql` |
| Template seed permission + role_permissions | `supabase/migrations/20260616000010_seed_orders_read_perm.sql` |
| Template wrapper RPC (garde + délégation) | `supabase/migrations/20260516000009_create_waste_stock_rpc.sql` |
| POS reçoit le stock via `record_incoming_stock_v1` | `apps/pos/src/features/stock/hooks/usePOSReceiveStock.ts:50` |
| POS lit `products.current_stock` pour la vue vitrine | `apps/pos/src/features/stock/hooks/usePOSStockProducts.ts:44-51` |
| Toggles produit BO (pattern `ToggleRow` role="switch") | `apps/backoffice/src/features/products/components/GeneralPanel.tsx:246-278` |
| `ProductUpdatePatch` type (18 champs) | `apps/backoffice/src/features/products/hooks/useUpdateProduct.ts:13-32` |
| Sidebar BO `NavItem` + groupe Stock | `apps/backoffice/src/layouts/Sidebar.tsx:38-46,86-97` |
| Routes BO `PermissionGate` + `<Route>` inventory | `apps/backoffice/src/routes/index.tsx:97-106,238-244` |
| Routes POS lazy + `SideMenuDrawer` item Cafe Stock | `apps/pos/src/routes/index.tsx:54`, `apps/pos/src/features/nav/SideMenuDrawer.tsx:204-208` |

### Séquence de migrations (bloc monotone après S32 `20260617000014`)

Pré-vol obligatoire avant d'écrire la 1ʳᵉ migration : `mcp__plugin_supabase_supabase__list_migrations` puis vérifier le dernier timestamp dans `supabase/migrations/`. Si le bloc `20260618000010…` est déjà pris, décaler tout le bloc d'un cran (`20260618000020…`). Le tableau ci-dessous suppose `20260618000010` libre.

| # | Fichier migration | Contenu |
|---|---|---|
| _010 | `20260618000010_create_display_stock_enum_and_product_flag.sql` | ENUM `display_movement_type` + `ALTER products ADD is_display_item` |
| _011 | `20260618000011_create_table_display_stock.sql` | table `display_stock` + RLS + REVOKE writes |
| _012 | `20260618000012_create_table_display_movements.sql` | table `display_movements` + RLS + index + REVOKE writes |
| _013 | `20260618000013_create_add_display_stock_v1_rpc.sql` | `add_display_stock_v1` |
| _014 | `20260618000014_revoke_pair_add_display_stock_v1.sql` | REVOKE pair |
| _015 | `20260618000015_create_return_display_to_kitchen_v1_rpc.sql` | `return_display_to_kitchen_v1` |
| _016 | `20260618000016_revoke_pair_return_display_to_kitchen_v1.sql` | REVOKE pair |
| _017 | `20260618000017_create_waste_display_stock_v1_rpc.sql` | `waste_display_stock_v1` |
| _018 | `20260618000018_revoke_pair_waste_display_stock_v1.sql` | REVOKE pair |
| _019 | `20260618000019_create_adjust_display_stock_v1_rpc.sql` | `adjust_display_stock_v1` |
| _020 | `20260618000020_revoke_pair_adjust_display_stock_v1.sql` | REVOKE pair |
| _021 | `20260618000021_bump_complete_order_v10.sql` | `complete_order_with_payment_v10` + DROP v9 |
| _022 | `20260618000022_revoke_pair_complete_order_v10.sql` | REVOKE pair v10 |
| _023 | `20260618000023_add_is_display_item_to_product_rpcs.sql` | bump allowlist `create_product_v1` + `update_product_v1` |
| _024 | `20260618000024_seed_display_permissions.sql` | seed `display.read` + `display.manage` + grants |

> **Workflow DB rappel (Docker retiré)** : chaque migration = (1) écrire le fichier `.sql` dans `supabase/migrations/` ; (2) l'appliquer via `mcp__plugin_supabase_supabase__apply_migration` (`project_id='ikcyvlovptebroadgtvd'`, `name` = nom du fichier sans extension ni timestamp, body = SQL) ; (3) tester via `mcp__plugin_supabase_supabase__execute_sql` (enveloppe `BEGIN … ROLLBACK` pour pgTAP). Types regen via `mcp__plugin_supabase_supabase__generate_typescript_types` → écrire dans `packages/supabase/src/types.generated.ts` + commit. **Ne jamais** lancer `supabase start`, `db reset`, ou `run_pgtap.sh`.

---

## File Structure

**Migrations (créées)** — `supabase/migrations/20260618000010..024_*.sql` (15 fichiers, voir tableau).

**Edge Function (modifiée)**
- `supabase/functions/process-payment/index.ts` — bump l'appel RPC `complete_order_with_payment_v9 → _v10` (1 ligne).

**Tests DB (créés)**
- `supabase/tests/display_stock.test.sql` — pgTAP : 4 RPCs gestes + REVOKE pairs.
- `supabase/tests/complete_order_v10_display.test.sql` — pgTAP : double déduction vente, garde vitrine, non-régression non-display.

**Types (régénérés)**
- `packages/supabase/src/types.generated.ts` — après _010 (enum+col) et après _024 (final).

**POS (`apps/pos/src/features/stock/`)**
- `hooks/usePOSReceiveStock.ts` — modifié : `record_incoming_stock_v1 → add_display_stock_v1`.
- `hooks/usePOSStockProducts.ts` — modifié : lire `display_stock.quantity` + filtre `is_display_item`.
- `hooks/useReturnToKitchen.ts` — créé : wrap `return_display_to_kitchen_v1`.
- `hooks/useWasteDisplay.ts` — créé : wrap `waste_display_stock_v1`.
- `hooks/useAdjustDisplay.ts` — créé : wrap `adjust_display_stock_v1`.
- `POSStockView.tsx` — modifié : KPI/colonnes sur `display_stock` ; brancher les gestes clôture.
- `components/POSStockCard.tsx` — modifié : afficher `display_stock` ; menu clôture (retour cuisine / perte / ajustement).
- `__tests__/` — smoke tests existants à mettre à jour + nouveaux.

**POS payment (`apps/pos/src/features/payment/`)**
- Aucun changement de signature requis (l'EF `process-payment` est l'unique pont ; le wire-protocol POS→EF est inchangé). Vérifier en régression que `useCheckout` passe toujours.

**Back office (`apps/backoffice/src/`)**
- `features/products/hooks/useUpdateProduct.ts` — modifié : `ProductUpdatePatch += is_display_item`.
- `features/products/hooks/useCreateProduct.ts` (+ `components/NewProductDialog.tsx`) — modifié : champ optionnel `is_display_item`.
- `features/products/components/GeneralPanel.tsx` — modifié : nouveau `ToggleRow` `is_display_item`.
- `features/inventory/hooks/useDisplayStock.ts` — créé : liste read-only des compteurs vitrine.
- `features/inventory/hooks/useDisplayMovements.ts` — créé : ledger récent (cursor).
- `pages/inventory/DisplayStockPage.tsx` — créé : page read-only.
- `layouts/Sidebar.tsx` — modifié : entrée "Display Stock".
- `routes/index.tsx` — modifié : route `/backoffice/inventory/display` gated `display.read`.

---

## WAVE 1 — Fondations DB (isolation)

> Produit testable : le schéma vitrine existe, isolé du ledger BO. Aucune RPC encore. Vérifiable par pgTAP de structure.

### Task 1 : ENUM `display_movement_type` + drapeau produit `is_display_item`

**Files:**
- Create: `supabase/migrations/20260618000010_create_display_stock_enum_and_product_flag.sql`

- [ ] **Step 1 : Pré-vol numérotation**

Lancer `mcp__plugin_supabase_supabase__list_migrations` et lister `supabase/migrations/` (dernier fichier). Confirmer que `20260618000010` est libre et monotone. Si pris, décaler tout le bloc.

- [ ] **Step 2 : Écrire la migration**

```sql
-- 20260618000010_create_display_stock_enum_and_product_flag.sql
-- POS display-stock isolation — Wave 1.
-- ENUM des types de mouvement vitrine + drapeau produit "exposé en vitrine".
-- Réservé V2 : ajout futur de valeurs à l'ENUM sans migration cassante.

CREATE TYPE display_movement_type AS ENUM (
  'stock_in',           -- mise en vitrine
  'sale',               -- vente (pont depuis complete_order v10)
  'return_to_kitchen',  -- clôture : retour cuisine
  'waste',              -- perte réelle
  'adjustment'          -- correction de comptage
);

ALTER TABLE products
  ADD COLUMN is_display_item BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN products.is_display_item IS
  'true = produit fini exposé en vitrine POS. La vente garde sur display_stock '
  '(pas current_stock) ; la mise en vitrine ne touche pas current_stock.';
```

- [ ] **Step 3 : Appliquer via MCP**

`mcp__plugin_supabase_supabase__apply_migration` avec `project_id='ikcyvlovptebroadgtvd'`, `name='create_display_stock_enum_and_product_flag'`, body = SQL ci-dessus.

- [ ] **Step 4 : Vérifier (execute_sql)**

```sql
SELECT
  EXISTS(SELECT 1 FROM pg_type WHERE typname = 'display_movement_type') AS enum_ok,
  EXISTS(SELECT 1 FROM information_schema.columns
         WHERE table_name='products' AND column_name='is_display_item') AS col_ok;
```
Attendu : `enum_ok = true`, `col_ok = true`.

- [ ] **Step 5 : Regen types + commit**

Regen via `mcp__plugin_supabase_supabase__generate_typescript_types` → écrire dans `packages/supabase/src/types.generated.ts`.

```bash
git add supabase/migrations/20260618000010_create_display_stock_enum_and_product_flag.sql packages/supabase/src/types.generated.ts
git commit -m "feat(db): display-stock — enum display_movement_type + products.is_display_item"
```

---

### Task 2 : Table `display_stock` (cache compteur)

**Files:**
- Create: `supabase/migrations/20260618000011_create_table_display_stock.sql`

- [ ] **Step 1 : Écrire la migration**

```sql
-- 20260618000011_create_table_display_stock.sql
-- Cache du compteur vitrine (1 ligne par produit display). Source de vérité = display_movements.
-- Écritures via RPC SECURITY DEFINER uniquement (REVOKE pour authenticated).

CREATE TABLE display_stock (
  product_id UUID PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  quantity   NUMERIC(10,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE display_stock IS
  'Compteur vitrine POS (cache). Jamais touché par record_stock_movement_v1 ni les '
  'triggers BO. Écrit uniquement par les RPC display_*_v1 (SECURITY DEFINER).';

ALTER TABLE display_stock ENABLE ROW LEVEL SECURITY;

-- SELECT gaté display.read (la permission est seedée en Wave 2 ; la policy lit has_permission).
CREATE POLICY display_stock_select ON display_stock
  FOR SELECT TO authenticated
  USING (has_permission(auth.uid(), 'display.read'));

-- Écritures révoquées : tout passe par les RPC SECURITY DEFINER.
REVOKE INSERT, UPDATE, DELETE ON display_stock FROM authenticated;
REVOKE ALL ON display_stock FROM anon;
```

- [ ] **Step 2 : Appliquer via MCP**

`apply_migration` name=`create_table_display_stock`.

- [ ] **Step 3 : Vérifier**

```sql
SELECT
  EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='display_stock') AS tbl_ok,
  EXISTS(SELECT 1 FROM pg_policies WHERE tablename='display_stock' AND policyname='display_stock_select') AS pol_ok,
  has_table_privilege('authenticated','display_stock','INSERT') AS auth_insert;
```
Attendu : `tbl_ok=true`, `pol_ok=true`, `auth_insert=false`.

- [ ] **Step 4 : Commit**

```bash
git add supabase/migrations/20260618000011_create_table_display_stock.sql
git commit -m "feat(db): display-stock — table display_stock + RLS (write-revoked)"
```

---

### Task 3 : Table `display_movements` (ledger append-only)

**Files:**
- Create: `supabase/migrations/20260618000012_create_table_display_movements.sql`

- [ ] **Step 1 : Écrire la migration**

```sql
-- 20260618000012_create_table_display_movements.sql
-- Ledger append-only des mouvements vitrine — source de vérité.
-- Table SÉPARÉE de stock_movements → zéro contact avec le ledger BO ni tr_20_je_emit.

CREATE TABLE display_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID NOT NULL REFERENCES products(id),
  movement_type   display_movement_type NOT NULL,
  quantity        NUMERIC(10,3) NOT NULL CHECK (quantity <> 0),  -- signée
  reason          TEXT,
  reference_type  TEXT,
  reference_id    UUID,
  created_by      UUID NOT NULL REFERENCES user_profiles(id),
  idempotency_key UUID UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_display_movements_product_created
  ON display_movements (product_id, created_at DESC);

COMMENT ON TABLE display_movements IS
  'Ledger append-only vitrine POS. Aucun JE inventaire émis ici. La seule passerelle '
  'vitrine→BO est la vente (complete_order v10) et la perte (waste_display_stock_v1), '
  'gérées explicitement dans leurs RPC. idempotency_key UNIQUE = replay-safe.';

ALTER TABLE display_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY display_movements_select ON display_movements
  FOR SELECT TO authenticated
  USING (has_permission(auth.uid(), 'display.read'));

REVOKE INSERT, UPDATE, DELETE ON display_movements FROM authenticated;
REVOKE ALL ON display_movements FROM anon;
```

- [ ] **Step 2 : Appliquer via MCP**

`apply_migration` name=`create_table_display_movements`.

- [ ] **Step 3 : Vérifier**

```sql
SELECT
  EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='display_movements') AS tbl_ok,
  EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='idx_display_movements_product_created') AS idx_ok,
  has_table_privilege('authenticated','display_movements','INSERT') AS auth_insert;
```
Attendu : `tbl_ok=true`, `idx_ok=true`, `auth_insert=false`.

- [ ] **Step 4 : Commit**

```bash
git add supabase/migrations/20260618000012_create_table_display_movements.sql
git commit -m "feat(db): display-stock — ledger display_movements append-only + index"
```

---

## WAVE 2 — RPCs gestes vitrine + permissions

> Produit testable : les 4 gestes vitrine fonctionnent (sauf vente — Wave 3). pgTAP `display_stock.test.sql` vert. **Note d'ordre** : la permission `display.read`/`display.manage` est seedée en Task 12 (fin de Wave 2) mais référencée par les policies/RPC dès maintenant via `has_permission` (résolution runtime — pas de dépendance de compilation). Les tests pgTAP de cette wave seedent les permissions dans leur transaction OU s'exécutent après Task 12. **Recommandation : implémenter Task 12 (seed perms) AVANT d'exécuter les tests pgTAP des Tasks 4-11.**

### Task 4 : RPC `add_display_stock_v1` (mise en vitrine)

**Files:**
- Create: `supabase/migrations/20260618000013_create_add_display_stock_v1_rpc.sql`

- [ ] **Step 1 : Écrire la migration**

```sql
-- 20260618000013_create_add_display_stock_v1_rpc.sql
-- Mise en vitrine. Gate display.manage. AUCUN effet BO (current_stock intact).
-- Idempotent via display_movements.idempotency_key UNIQUE (replay re-read).

CREATE OR REPLACE FUNCTION add_display_stock_v1(
  p_product_id      UUID,
  p_quantity        NUMERIC(10,3),
  p_reason          TEXT DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_profile_id UUID;
  v_is_display BOOLEAN;
  v_new        NUMERIC(10,3);
BEGIN
  IF NOT has_permission(v_uid, 'display.manage') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  SELECT id INTO v_profile_id FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE='P0001';
  END IF;

  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity_must_be_positive';
  END IF;

  SELECT is_display_item INTO v_is_display FROM products
    WHERE id = p_product_id AND deleted_at IS NULL;
  IF v_is_display IS NULL THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002';
  END IF;
  IF v_is_display = false THEN
    RAISE EXCEPTION 'not_a_display_item' USING ERRCODE='P0002';
  END IF;

  -- Idempotency replay : si la clé existe déjà, ne pas réappliquer le delta.
  IF p_idempotency_key IS NOT NULL
     AND EXISTS (SELECT 1 FROM display_movements WHERE idempotency_key = p_idempotency_key) THEN
    SELECT quantity INTO v_new FROM display_stock WHERE product_id = p_product_id;
    RETURN jsonb_build_object(
      'product_id', p_product_id,
      'new_display_stock', COALESCE(v_new, 0),
      'idempotent_replay', true
    );
  END IF;

  INSERT INTO display_movements (product_id, movement_type, quantity, reason, created_by, idempotency_key)
    VALUES (p_product_id, 'stock_in', p_quantity, p_reason, v_profile_id, p_idempotency_key);

  INSERT INTO display_stock (product_id, quantity, updated_at)
    VALUES (p_product_id, p_quantity, now())
    ON CONFLICT (product_id) DO UPDATE
      SET quantity = display_stock.quantity + EXCLUDED.quantity, updated_at = now()
    RETURNING quantity INTO v_new;

  RETURN jsonb_build_object(
    'product_id', p_product_id,
    'new_display_stock', v_new,
    'idempotent_replay', false
  );
EXCEPTION WHEN unique_violation THEN
  -- Course concurrente sur idempotency_key : re-read.
  SELECT quantity INTO v_new FROM display_stock WHERE product_id = p_product_id;
  RETURN jsonb_build_object(
    'product_id', p_product_id,
    'new_display_stock', COALESCE(v_new, 0),
    'idempotent_replay', true
  );
END $$;

REVOKE EXECUTE ON FUNCTION add_display_stock_v1 FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION add_display_stock_v1 TO authenticated;

COMMENT ON FUNCTION add_display_stock_v1 IS
  'Mise en vitrine. Gate display.manage. Aucun effet BO. Idempotent via display_movements.idempotency_key.';
```

- [ ] **Step 2 : Appliquer via MCP** — `apply_migration` name=`create_add_display_stock_v1_rpc`.

- [ ] **Step 3 : Commit**

```bash
git add supabase/migrations/20260618000013_create_add_display_stock_v1_rpc.sql
git commit -m "feat(db): display-stock — add_display_stock_v1 (mise en vitrine, idempotent)"
```

---

### Task 5 : REVOKE pair `add_display_stock_v1`

**Files:**
- Create: `supabase/migrations/20260618000014_revoke_pair_add_display_stock_v1.sql`

- [ ] **Step 1 : Écrire la migration** (pattern S25 canonique)

```sql
-- 20260618000014_revoke_pair_add_display_stock_v1.sql
-- REVOKE pair canonique S25 : defense-in-depth contre anon-callable.
REVOKE EXECUTE ON FUNCTION public.add_display_stock_v1(UUID, NUMERIC, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.add_display_stock_v1(UUID, NUMERIC, TEXT, UUID) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

- [ ] **Step 2 : Appliquer via MCP** — name=`revoke_pair_add_display_stock_v1`.

- [ ] **Step 3 : Vérifier** (anon ne peut pas exécuter)

```sql
SELECT has_function_privilege('anon', 'public.add_display_stock_v1(UUID, NUMERIC, TEXT, UUID)', 'EXECUTE') AS anon_exec;
```
Attendu : `anon_exec = false`.

- [ ] **Step 4 : Commit**

```bash
git add supabase/migrations/20260618000014_revoke_pair_add_display_stock_v1.sql
git commit -m "feat(db): display-stock — REVOKE pair add_display_stock_v1"
```

---

### Task 6 : RPC `return_display_to_kitchen_v1` (retour cuisine)

**Files:**
- Create: `supabase/migrations/20260618000015_create_return_display_to_kitchen_v1_rpc.sql`

- [ ] **Step 1 : Écrire la migration**

```sql
-- 20260618000015_create_return_display_to_kitchen_v1_rpc.sql
-- Retour cuisine (clôture). Gate display.manage. display_stock -= q.
-- current_stock INCHANGÉ, AUCUN JE (le produit reste compté en stock cuisine BO).

CREATE OR REPLACE FUNCTION return_display_to_kitchen_v1(
  p_product_id      UUID,
  p_quantity        NUMERIC(10,3),
  p_reason          TEXT DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_profile_id UUID;
  v_current    NUMERIC(10,3);
  v_new        NUMERIC(10,3);
BEGIN
  IF NOT has_permission(v_uid, 'display.manage') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  SELECT id INTO v_profile_id FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE='P0001';
  END IF;

  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity_must_be_positive';
  END IF;

  IF p_idempotency_key IS NOT NULL
     AND EXISTS (SELECT 1 FROM display_movements WHERE idempotency_key = p_idempotency_key) THEN
    SELECT quantity INTO v_new FROM display_stock WHERE product_id = p_product_id;
    RETURN jsonb_build_object('product_id', p_product_id, 'new_display_stock', COALESCE(v_new,0), 'idempotent_replay', true);
  END IF;

  SELECT quantity INTO v_current FROM display_stock WHERE product_id = p_product_id FOR UPDATE;
  IF v_current IS NULL OR v_current < p_quantity THEN
    RAISE EXCEPTION 'insufficient_display_stock' USING ERRCODE='P0002';
  END IF;

  INSERT INTO display_movements (product_id, movement_type, quantity, reason, created_by, idempotency_key)
    VALUES (p_product_id, 'return_to_kitchen', -p_quantity, p_reason, v_profile_id, p_idempotency_key);

  UPDATE display_stock SET quantity = quantity - p_quantity, updated_at = now()
    WHERE product_id = p_product_id RETURNING quantity INTO v_new;

  RETURN jsonb_build_object('product_id', p_product_id, 'new_display_stock', v_new, 'idempotent_replay', false);
EXCEPTION WHEN unique_violation THEN
  SELECT quantity INTO v_new FROM display_stock WHERE product_id = p_product_id;
  RETURN jsonb_build_object('product_id', p_product_id, 'new_display_stock', COALESCE(v_new,0), 'idempotent_replay', true);
END $$;

REVOKE EXECUTE ON FUNCTION return_display_to_kitchen_v1 FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION return_display_to_kitchen_v1 TO authenticated;

COMMENT ON FUNCTION return_display_to_kitchen_v1 IS
  'Retour cuisine (clôture). Gate display.manage. display_stock -= q. current_stock inchangé, aucun JE.';
```

- [ ] **Step 2 : Appliquer via MCP** — name=`create_return_display_to_kitchen_v1_rpc`.

- [ ] **Step 3 : Commit**

```bash
git add supabase/migrations/20260618000015_create_return_display_to_kitchen_v1_rpc.sql
git commit -m "feat(db): display-stock — return_display_to_kitchen_v1 (clôture, display-only)"
```

---

### Task 7 : REVOKE pair `return_display_to_kitchen_v1`

**Files:**
- Create: `supabase/migrations/20260618000016_revoke_pair_return_display_to_kitchen_v1.sql`

- [ ] **Step 1 : Écrire la migration**

```sql
-- 20260618000016_revoke_pair_return_display_to_kitchen_v1.sql
REVOKE EXECUTE ON FUNCTION public.return_display_to_kitchen_v1(UUID, NUMERIC, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.return_display_to_kitchen_v1(UUID, NUMERIC, TEXT, UUID) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

- [ ] **Step 2 : Appliquer + vérifier** (name=`revoke_pair_return_display_to_kitchen_v1`)

```sql
SELECT has_function_privilege('anon', 'public.return_display_to_kitchen_v1(UUID, NUMERIC, TEXT, UUID)', 'EXECUTE') AS anon_exec;
```
Attendu : `false`.

- [ ] **Step 3 : Commit**

```bash
git add supabase/migrations/20260618000016_revoke_pair_return_display_to_kitchen_v1.sql
git commit -m "feat(db): display-stock — REVOKE pair return_display_to_kitchen_v1"
```

---

### Task 8 : RPC `waste_display_stock_v1` (perte réelle — double déduction + JE)

> **Le geste le plus subtil.** La perte déduit la vitrine ET le BO. La déduction BO passe par un **INSERT direct** dans `stock_movements` type `waste` (exempté de la contrainte de section, déclenche `tr_20_je_emit` → JE waste) **sans** garde `current_stock` → `current_stock` peut passer négatif (cohérent avec « garde sur vitrine seule »). On ne réutilise PAS `waste_stock_v1`/`record_stock_movement_v1` (qui bloquent sur `insufficient_stock`).

**Files:**
- Create: `supabase/migrations/20260618000017_create_waste_display_stock_v1_rpc.sql`

- [ ] **Step 1 : Écrire la migration**

```sql
-- 20260618000017_create_waste_display_stock_v1_rpc.sql
-- Perte réelle (saisie caisse). Gate display.manage.
-- Vitrine : display_movements 'waste' (-q) + display_stock -= q (garde display_stock >= q).
-- BO      : INSERT direct stock_movements 'waste' (-q) → tr_20_je_emit émet JE waste
--           (DR WASTE_EXPENSE / CR INVENTORY_GENERAL si cost_price*q > 0) + current_stock -= q.
-- La déduction BO N'EST PAS bloquée par une garde current_stock (peut passer négatif).

CREATE OR REPLACE FUNCTION waste_display_stock_v1(
  p_product_id      UUID,
  p_quantity        NUMERIC(10,3),
  p_reason          TEXT DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_profile_id UUID;
  v_current    NUMERIC(10,3);
  v_new        NUMERIC(10,3);
  v_unit       TEXT;
BEGIN
  IF NOT has_permission(v_uid, 'display.manage') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  SELECT id INTO v_profile_id FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE='P0001';
  END IF;

  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity_must_be_positive';
  END IF;

  IF p_idempotency_key IS NOT NULL
     AND EXISTS (SELECT 1 FROM display_movements WHERE idempotency_key = p_idempotency_key) THEN
    SELECT quantity INTO v_new FROM display_stock WHERE product_id = p_product_id;
    RETURN jsonb_build_object('product_id', p_product_id, 'new_display_stock', COALESCE(v_new,0), 'idempotent_replay', true);
  END IF;

  SELECT quantity INTO v_current FROM display_stock WHERE product_id = p_product_id FOR UPDATE;
  IF v_current IS NULL OR v_current < p_quantity THEN
    RAISE EXCEPTION 'insufficient_display_stock' USING ERRCODE='P0002';
  END IF;

  -- (1) Vitrine
  INSERT INTO display_movements (product_id, movement_type, quantity, reason, created_by, idempotency_key)
    VALUES (p_product_id, 'waste', -p_quantity, p_reason, v_profile_id, p_idempotency_key);

  UPDATE display_stock SET quantity = quantity - p_quantity, updated_at = now()
    WHERE product_id = p_product_id RETURNING quantity INTO v_new;

  -- (2) BO : INSERT direct (waste exempté de la contrainte de section ; déclenche tr_20_je_emit).
  --     unit NOT NULL → résolu depuis products.unit. PAS de garde current_stock.
  SELECT COALESCE(unit, 'pcs') INTO v_unit FROM products WHERE id = p_product_id;

  INSERT INTO stock_movements (product_id, movement_type, quantity, unit, reason, reference_type, created_by)
    VALUES (p_product_id, 'waste', -p_quantity, v_unit, COALESCE(p_reason, 'Display waste'), 'display_waste', v_profile_id);

  UPDATE products SET current_stock = current_stock - p_quantity, updated_at = now()
    WHERE id = p_product_id;

  RETURN jsonb_build_object('product_id', p_product_id, 'new_display_stock', v_new, 'idempotent_replay', false);
EXCEPTION WHEN unique_violation THEN
  SELECT quantity INTO v_new FROM display_stock WHERE product_id = p_product_id;
  RETURN jsonb_build_object('product_id', p_product_id, 'new_display_stock', COALESCE(v_new,0), 'idempotent_replay', true);
END $$;

REVOKE EXECUTE ON FUNCTION waste_display_stock_v1 FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION waste_display_stock_v1 TO authenticated;

COMMENT ON FUNCTION waste_display_stock_v1 IS
  'Perte vitrine. Gate display.manage. Double déduction display_stock + current_stock (peut passer '
  'négatif, pas de garde BO). INSERT direct stock_movements waste → JE via tr_20_je_emit.';
```

> **Note de vérification (Step 3)** : `stock_movements` a une colonne `reason` (présente dans le schéma — `record_stock_movement_v1` la peuple). Si l'INSERT échoue sur une colonne absente, lire la définition courante de `stock_movements` (`\d stock_movements` via `execute_sql`) et ajuster la liste de colonnes de l'INSERT (garder au minimum `product_id, movement_type, quantity, unit, created_by`). La colonne `reference_type='display_waste'` doit être acceptée par toute CHECK sur `stock_movements.reference_type` ; si une telle CHECK existe et la rejette, retirer `reference_type` de l'INSERT (il est purement informatif ici).

- [ ] **Step 2 : Appliquer via MCP** — name=`create_waste_display_stock_v1_rpc`.

- [ ] **Step 3 : Vérifier le shape stock_movements** (avant de compter sur l'INSERT)

```sql
SELECT column_name, is_nullable FROM information_schema.columns
  WHERE table_name='stock_movements' ORDER BY ordinal_position;
```
Confirmer que `product_id, movement_type, quantity, unit, created_by` existent et que `unit` est NOT NULL (déjà fourni). Ajuster l'INSERT si `reason`/`reference_type` absents.

- [ ] **Step 4 : Commit**

```bash
git add supabase/migrations/20260618000017_create_waste_display_stock_v1_rpc.sql
git commit -m "feat(db): display-stock — waste_display_stock_v1 (double déduction + JE waste)"
```

---

### Task 9 : REVOKE pair `waste_display_stock_v1`

**Files:**
- Create: `supabase/migrations/20260618000018_revoke_pair_waste_display_stock_v1.sql`

- [ ] **Step 1 : Écrire**

```sql
-- 20260618000018_revoke_pair_waste_display_stock_v1.sql
REVOKE EXECUTE ON FUNCTION public.waste_display_stock_v1(UUID, NUMERIC, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.waste_display_stock_v1(UUID, NUMERIC, TEXT, UUID) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

- [ ] **Step 2 : Appliquer + vérifier** (name=`revoke_pair_waste_display_stock_v1`)

```sql
SELECT has_function_privilege('anon', 'public.waste_display_stock_v1(UUID, NUMERIC, TEXT, UUID)', 'EXECUTE') AS anon_exec;
```
Attendu : `false`.

- [ ] **Step 3 : Commit**

```bash
git add supabase/migrations/20260618000018_revoke_pair_waste_display_stock_v1.sql
git commit -m "feat(db): display-stock — REVOKE pair waste_display_stock_v1"
```

---

### Task 10 : RPC `adjust_display_stock_v1` (correction de comptage)

**Files:**
- Create: `supabase/migrations/20260618000019_create_adjust_display_stock_v1_rpc.sql`

- [ ] **Step 1 : Écrire la migration**

```sql
-- 20260618000019_create_adjust_display_stock_v1_rpc.sql
-- Correction de comptage vitrine. Gate display.manage. p_reason requis (>= 3 chars).
-- display_movements 'adjustment' (delta signé) + display_stock = p_new_qty. AUCUN effet BO.

CREATE OR REPLACE FUNCTION adjust_display_stock_v1(
  p_product_id      UUID,
  p_new_qty         NUMERIC(10,3),
  p_reason          TEXT,
  p_idempotency_key UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_profile_id UUID;
  v_is_display BOOLEAN;
  v_current    NUMERIC(10,3);
  v_delta      NUMERIC(10,3);
BEGIN
  IF NOT has_permission(v_uid, 'display.manage') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  SELECT id INTO v_profile_id FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE='P0001';
  END IF;

  IF p_new_qty < 0 THEN
    RAISE EXCEPTION 'quantity_must_be_non_negative';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  SELECT is_display_item INTO v_is_display FROM products
    WHERE id = p_product_id AND deleted_at IS NULL;
  IF v_is_display IS NULL THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002';
  END IF;
  IF v_is_display = false THEN
    RAISE EXCEPTION 'not_a_display_item' USING ERRCODE='P0002';
  END IF;

  IF p_idempotency_key IS NOT NULL
     AND EXISTS (SELECT 1 FROM display_movements WHERE idempotency_key = p_idempotency_key) THEN
    SELECT quantity INTO v_current FROM display_stock WHERE product_id = p_product_id;
    RETURN jsonb_build_object('product_id', p_product_id, 'new_display_stock', COALESCE(v_current,0), 'idempotent_replay', true);
  END IF;

  SELECT COALESCE(quantity, 0) INTO v_current FROM display_stock WHERE product_id = p_product_id FOR UPDATE;
  v_current := COALESCE(v_current, 0);
  v_delta   := p_new_qty - v_current;

  IF v_delta = 0 THEN
    -- No-op : ne pas insérer (display_movements.quantity CHECK <> 0). Pas de persist de la clé.
    RETURN jsonb_build_object('product_id', p_product_id, 'new_display_stock', v_current, 'idempotent_replay', false, 'noop', true);
  END IF;

  INSERT INTO display_movements (product_id, movement_type, quantity, reason, created_by, idempotency_key)
    VALUES (p_product_id, 'adjustment', v_delta, p_reason, v_profile_id, p_idempotency_key);

  INSERT INTO display_stock (product_id, quantity, updated_at)
    VALUES (p_product_id, p_new_qty, now())
    ON CONFLICT (product_id) DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now();

  RETURN jsonb_build_object('product_id', p_product_id, 'new_display_stock', p_new_qty, 'idempotent_replay', false);
EXCEPTION WHEN unique_violation THEN
  SELECT quantity INTO v_current FROM display_stock WHERE product_id = p_product_id;
  RETURN jsonb_build_object('product_id', p_product_id, 'new_display_stock', COALESCE(v_current,0), 'idempotent_replay', true);
END $$;

REVOKE EXECUTE ON FUNCTION adjust_display_stock_v1 FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION adjust_display_stock_v1 TO authenticated;

COMMENT ON FUNCTION adjust_display_stock_v1 IS
  'Correction comptage vitrine. Gate display.manage. reason requis. display_stock = p_new_qty. Aucun effet BO.';
```

- [ ] **Step 2 : Appliquer via MCP** — name=`create_adjust_display_stock_v1_rpc`.

- [ ] **Step 3 : Commit**

```bash
git add supabase/migrations/20260618000019_create_adjust_display_stock_v1_rpc.sql
git commit -m "feat(db): display-stock — adjust_display_stock_v1 (correction comptage)"
```

---

### Task 11 : REVOKE pair `adjust_display_stock_v1`

**Files:**
- Create: `supabase/migrations/20260618000020_revoke_pair_adjust_display_stock_v1.sql`

- [ ] **Step 1 : Écrire**

```sql
-- 20260618000020_revoke_pair_adjust_display_stock_v1.sql
REVOKE EXECUTE ON FUNCTION public.adjust_display_stock_v1(UUID, NUMERIC, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.adjust_display_stock_v1(UUID, NUMERIC, TEXT, UUID) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

- [ ] **Step 2 : Appliquer + vérifier** (name=`revoke_pair_adjust_display_stock_v1`)

```sql
SELECT has_function_privilege('anon', 'public.adjust_display_stock_v1(UUID, NUMERIC, TEXT, UUID)', 'EXECUTE') AS anon_exec;
```
Attendu : `false`.

- [ ] **Step 3 : Commit**

```bash
git add supabase/migrations/20260618000020_revoke_pair_adjust_display_stock_v1.sql
git commit -m "feat(db): display-stock — REVOKE pair adjust_display_stock_v1"
```

---

### Task 12 : Seed permissions `display.read` + `display.manage`

**Files:**
- Create: `supabase/migrations/20260618000024_seed_display_permissions.sql`

> Numéro `_024` réservé pour le seed (dernière migration du bloc), mais **implémenter ici** (avant les tests pgTAP). Appliquer ce fichier maintenant ; il restera en position `_024` dans l'historique git car le timestamp est ce qui compte pour `schema_migrations`.

- [ ] **Step 1 : Écrire la migration** (pattern S31 `orders.read`)

```sql
-- 20260618000024_seed_display_permissions.sql
-- Seed display.read (consultation POS+BO) + display.manage (gestes vitrine).
-- display.read : tout staff. display.manage : CASHIER+ (gestes de caisse).

INSERT INTO permissions (code, module, action, description) VALUES
  ('display.read',   'display', 'read',   'View display-case (vitrine) stock'),
  ('display.manage', 'display', 'manage', 'Manage display-case stock (add/return/waste/adjust)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code)
SELECT r.code, p.code
FROM roles r
CROSS JOIN (VALUES ('display.read'), ('display.manage')) AS p(code)
WHERE r.code IN ('CASHIER', 'WAITER', 'MANAGER', 'ADMIN', 'SUPER_ADMIN')
ON CONFLICT DO NOTHING;
```

> **Step 1bis : vérifier les codes de rôle exacts.** La spec écrit "waiter" (minuscule) ; S31 utilise `MANAGER/ADMIN/SUPER_ADMIN`. Avant d'appliquer, lancer `SELECT code FROM roles ORDER BY code;` et corriger la liste `IN (...)` pour matcher exactement les codes réels (probablement `CASHIER, WAITER, MANAGER, ADMIN, SUPER_ADMIN` — ADMIN/SUPER_ADMIN peuvent avoir `has_permission` inconditionnel, auquel cas leur grant explicite est redondant mais sans danger).

- [ ] **Step 2 : Appliquer via MCP** — name=`seed_display_permissions`.

- [ ] **Step 3 : Vérifier**

```sql
SELECT code FROM permissions WHERE code LIKE 'display.%' ORDER BY code;
SELECT role_code, permission_code FROM role_permissions WHERE permission_code LIKE 'display.%' ORDER BY role_code, permission_code;
```
Attendu : 2 permissions + grants pour chaque rôle staff.

- [ ] **Step 4 : Commit**

```bash
git add supabase/migrations/20260618000024_seed_display_permissions.sql
git commit -m "feat(db): display-stock — seed permissions display.read + display.manage"
```

---

### Task 13 : pgTAP suite gestes vitrine (`display_stock.test.sql`)

**Files:**
- Create: `supabase/tests/display_stock.test.sql`

Pattern de référence : `supabase/tests/orders_list_v1.test.sql` (BEGIN/ROLLBACK, `SELECT plan(N)`, `set_config('request.jwt.claim.sub', uuid, true)` pour simuler un user, `has_function_privilege` pour REVOKE).

- [ ] **Step 1 : Écrire le fichier de test** (couvre la spec §10)

```sql
-- supabase/tests/display_stock.test.sql
-- pgTAP — 4 RPCs gestes vitrine + REVOKE pairs. Exécuter via MCP execute_sql (BEGIN..ROLLBACK).
BEGIN;
SELECT plan(16);

-- ── Fixtures : un user MANAGER, une catégorie, un produit display (cost_price>0), un non-display.
-- Réutiliser un user existant avec display.manage. Adapter les SELECT de fixture au seed réel
-- (chercher un user_profiles + auth user ayant le rôle MANAGER ; sinon insérer un profil de test).
DO $$
DECLARE
  v_auth UUID; v_prof UUID; v_cat UUID; v_disp UUID; v_nondisp UUID;
BEGIN
  -- Récupère un MANAGER existant (auth_user_id non nul).
  SELECT up.auth_user_id, up.id INTO v_auth, v_prof
    FROM user_profiles up
    JOIN roles r ON r.code = up.role_code
    WHERE up.role_code IN ('MANAGER','ADMIN','SUPER_ADMIN') AND up.deleted_at IS NULL
    LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);

  SELECT id INTO v_cat FROM categories WHERE deleted_at IS NULL LIMIT 1;

  INSERT INTO products (sku, name, category_id, retail_price, cost_price, unit, is_display_item, current_stock)
    VALUES ('TEST-DISP-1', 'Test Display Croissant', v_cat, 25000, 8000, 'pcs', true, 100)
    RETURNING id INTO v_disp;
  INSERT INTO products (sku, name, category_id, retail_price, cost_price, unit, is_display_item, current_stock)
    VALUES ('TEST-NONDISP-1', 'Test Non Display', v_cat, 15000, 5000, 'pcs', false, 50)
    RETURNING id INTO v_nondisp;

  PERFORM set_config('breakery.t_disp', v_disp::text, true);
  PERFORM set_config('breakery.t_nondisp', v_nondisp::text, true);
  PERFORM set_config('breakery.t_prof', v_prof::text, true);
END $$;

-- T1 : add_display_stock happy → display_stock = 10
SELECT is(
  (add_display_stock_v1(current_setting('breakery.t_disp')::uuid, 10, 'mise vitrine', gen_random_uuid())->>'new_display_stock')::numeric,
  10::numeric, 'T1 add_display_stock_v1 → 10');

-- T2 : add sur non-display → not_a_display_item
SELECT throws_ok(
  $$ SELECT add_display_stock_v1(current_setting('breakery.t_nondisp')::uuid, 5, 'x', gen_random_uuid()) $$,
  'P0002', NULL, 'T2 add on non-display raises not_a_display_item');

-- T3 : add idempotent replay (même clé → pas de double)
DO $$ DECLARE k UUID := gen_random_uuid(); r1 JSONB; r2 JSONB;
BEGIN
  r1 := add_display_stock_v1(current_setting('breakery.t_disp')::uuid, 7, 'x', k);
  r2 := add_display_stock_v1(current_setting('breakery.t_disp')::uuid, 7, 'x', k);
  PERFORM set_config('breakery.t3a', (r1->>'new_display_stock'), true);
  PERFORM set_config('breakery.t3b', (r2->>'new_display_stock'), true);
  PERFORM set_config('breakery.t3replay', (r2->>'idempotent_replay'), true);
END $$;
SELECT is(current_setting('breakery.t3a'), current_setting('breakery.t3b'), 'T3 idempotent replay same qty');
SELECT is(current_setting('breakery.t3replay'), 'true', 'T3 replay flag true');

-- T4 : return_to_kitchen happy → display -q, current_stock inchangé
DO $$ DECLARE cs_before NUMERIC; cs_after NUMERIC;
BEGIN
  SELECT current_stock INTO cs_before FROM products WHERE id = current_setting('breakery.t_disp')::uuid;
  PERFORM return_display_to_kitchen_v1(current_setting('breakery.t_disp')::uuid, 3, 'retour', gen_random_uuid());
  SELECT current_stock INTO cs_after FROM products WHERE id = current_setting('breakery.t_disp')::uuid;
  PERFORM set_config('breakery.t4cs', (cs_before = cs_after)::text, true);
END $$;
SELECT is(current_setting('breakery.t4cs'), 'true', 'T4 return_to_kitchen leaves current_stock unchanged');

-- T5 : return garde insuffisant
SELECT throws_ok(
  $$ SELECT return_display_to_kitchen_v1(current_setting('breakery.t_disp')::uuid, 99999, 'x', gen_random_uuid()) $$,
  'P0002', NULL, 'T5 return insufficient_display_stock');

-- T6/T7 : waste happy → display -q ET current_stock -q ET JE waste émis
DO $$ DECLARE disp_before NUMERIC; disp_after NUMERIC; cs_before NUMERIC; cs_after NUMERIC; je_count INT;
BEGIN
  SELECT quantity INTO disp_before FROM display_stock WHERE product_id = current_setting('breakery.t_disp')::uuid;
  SELECT current_stock INTO cs_before FROM products WHERE id = current_setting('breakery.t_disp')::uuid;
  PERFORM waste_display_stock_v1(current_setting('breakery.t_disp')::uuid, 2, 'spoiled', gen_random_uuid());
  SELECT quantity INTO disp_after FROM display_stock WHERE product_id = current_setting('breakery.t_disp')::uuid;
  SELECT current_stock INTO cs_after FROM products WHERE id = current_setting('breakery.t_disp')::uuid;
  SELECT count(*) INTO je_count FROM journal_entries je
    JOIN stock_movements sm ON sm.id = je.reference_id
    WHERE je.reference_type = 'stock_movement' AND je.metadata->>'movement_type' = 'waste'
      AND sm.product_id = current_setting('breakery.t_disp')::uuid;
  PERFORM set_config('breakery.t6disp', (disp_before - disp_after = 2)::text, true);
  PERFORM set_config('breakery.t6cs',   (cs_before  - cs_after  = 2)::text, true);
  PERFORM set_config('breakery.t7je',   (je_count >= 1)::text, true);
END $$;
SELECT is(current_setting('breakery.t6disp'), 'true', 'T6 waste deducts display_stock');
SELECT is(current_setting('breakery.t6cs'),   'true', 'T6 waste deducts current_stock');
SELECT is(current_setting('breakery.t7je'),   'true', 'T7 waste emits JE via tr_20_je_emit');

-- T8 : waste autorise current_stock négatif (vendu plus que produit)
DO $$ DECLARE cs NUMERIC;
BEGIN
  UPDATE products SET current_stock = 1 WHERE id = current_setting('breakery.t_disp')::uuid;
  -- display_stock doit avoir >= 5 ; on remet à niveau
  PERFORM add_display_stock_v1(current_setting('breakery.t_disp')::uuid, 10, 'top up', gen_random_uuid());
  PERFORM waste_display_stock_v1(current_setting('breakery.t_disp')::uuid, 5, 'over', gen_random_uuid());
  SELECT current_stock INTO cs FROM products WHERE id = current_setting('breakery.t_disp')::uuid;
  PERFORM set_config('breakery.t8', (cs < 0)::text, true);
END $$;
SELECT is(current_setting('breakery.t8'), 'true', 'T8 waste allows current_stock to go negative');

-- T9 : adjust happy → display_stock = new_qty
SELECT is(
  (adjust_display_stock_v1(current_setting('breakery.t_disp')::uuid, 42, 'recount', gen_random_uuid())->>'new_display_stock')::numeric,
  42::numeric, 'T9 adjust sets display_stock to new_qty');

-- T10 : adjust reason requis
SELECT throws_ok(
  $$ SELECT adjust_display_stock_v1(current_setting('breakery.t_disp')::uuid, 10, 'x', gen_random_uuid()) $$,
  NULL, 'reason_required', 'T10 adjust requires reason >= 3 chars');

-- T11 : isolation — aucun display_movements n'a touché stock_movements pour add/return/adjust
--        (seul waste crée un stock_movements). Vérifie qu'add ne crée pas de stock_movements.
DO $$ DECLARE sm_count INT;
BEGIN
  SELECT count(*) INTO sm_count FROM stock_movements
    WHERE product_id = current_setting('breakery.t_disp')::uuid AND movement_type = 'stock_in';
  PERFORM set_config('breakery.t11', (sm_count = 0)::text, true);
END $$;
SELECT is(current_setting('breakery.t11'), 'true', 'T11 add_display_stock writes no stock_movements (isolation)');

-- T12-T15 : REVOKE pairs — anon ne peut exécuter aucune des 4 RPC
SELECT is(has_function_privilege('anon','public.add_display_stock_v1(UUID,NUMERIC,TEXT,UUID)','EXECUTE'), false, 'T12 anon !exec add');
SELECT is(has_function_privilege('anon','public.return_display_to_kitchen_v1(UUID,NUMERIC,TEXT,UUID)','EXECUTE'), false, 'T13 anon !exec return');
SELECT is(has_function_privilege('anon','public.waste_display_stock_v1(UUID,NUMERIC,TEXT,UUID)','EXECUTE'), false, 'T14 anon !exec waste');
SELECT is(has_function_privilege('anon','public.adjust_display_stock_v1(UUID,NUMERIC,TEXT,UUID)','EXECUTE'), false, 'T15 anon !exec adjust');

-- T16 : forbidden quand l'appelant n'a pas display.manage
DO $$ DECLARE v_auth UUID;
BEGIN
  SELECT up.auth_user_id INTO v_auth FROM user_profiles up
    WHERE up.role_code = 'CASHIER' AND up.deleted_at IS NULL LIMIT 1;
  -- Si aucun CASHIER sans display.manage, ce test peut être ajusté ; ici on suppose CASHIER a display.manage,
  -- donc on teste plutôt un rôle sans la perm si présent. Sinon, retirer T16 et ajuster plan(15).
  PERFORM 1;
END $$;
SELECT pass('T16 placeholder — voir note ci-dessous');

SELECT * FROM finish();
ROLLBACK;
```

> **Note T16** : la spec accorde `display.manage` à tout staff (CASHIER inclus), donc un test "forbidden" exige un rôle SANS la perm. Si aucun rôle staff n'est exclu, **retirer T16 et passer `plan(15)`**. Le reviewer décide à l'exécution selon le seed de rôles réel.

- [ ] **Step 2 : Exécuter via MCP execute_sql**

Coller le contenu du fichier dans `mcp__plugin_supabase_supabase__execute_sql`. Le `ROLLBACK` final annule les fixtures.
Attendu : tous les tests `ok`. Ajuster `plan(N)` si T16 retiré.

- [ ] **Step 3 : Itérer jusqu'au vert**

Si un test échoue, lire le message pgTAP, corriger la RPC concernée (nouvelle migration corrective `_0xx` — ne jamais éditer une migration appliquée) ou le test, ré-appliquer, ré-exécuter.

- [ ] **Step 4 : Commit**

```bash
git add supabase/tests/display_stock.test.sql
git commit -m "test(db): display-stock — pgTAP 4 RPCs gestes + REVOKE pairs"
```

---

## WAVE 3 — Bump `complete_order_with_payment_v9 → _v10` (vente double déduction)

> **R1 — RPC la plus critique du système.** Stratégie : copier le corps de v9 verbatim, appliquer 3 modifications chirurgicales, DROP v9 dans la même migration, bump l'EF caller, types regen, pgTAP de non-régression. Produit testable : vente d'un produit display déduit les 2 stocks ; vente non-display 100% inchangée.

### Task 14 : Migration bump v10

**Files:**
- Create: `supabase/migrations/20260618000021_bump_complete_order_v10.sql`
- Reference: `supabase/migrations/20260517000015_bump_complete_order_v9.sql` (corps source à copier)

- [ ] **Step 1 : Construire le fichier — squelette + DROP v9**

Créer `20260618000021_bump_complete_order_v10.sql`. Commencer par le bloc DROP (cible le nom suffixé `_v9`) :

```sql
-- 20260618000021_bump_complete_order_v10.sql
-- POS display-stock isolation — Wave 3.
-- Bump v9 → v10 : ajoute la déduction vitrine + déplace la garde de vente sur display_stock
-- pour les produits is_display_item. Comportement non-display 100% inchangé.
-- Décision D14 (versioning monotone) : DROP v9 dans la même migration.

DO $drop$
DECLARE _r RECORD;
BEGIN
  FOR _r IN SELECT oid::regprocedure AS sig FROM pg_proc
    WHERE proname = 'complete_order_with_payment_v9' AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION ' || _r.sig::text || ' CASCADE';
  END LOOP;
END $drop$;

CREATE OR REPLACE FUNCTION complete_order_with_payment_v10(
  -- … COPIER VERBATIM la liste des 16 paramètres de v9 (lignes 22-38 de 20260517000015) …
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
-- … COPIER VERBATIM le bloc DECLARE de v9 (lignes 42-91) …
-- … COPIER VERBATIM le corps de v9 (lignes 92-517) en appliquant les 3 diffs ci-dessous …
$$;

GRANT EXECUTE ON FUNCTION complete_order_with_payment_v10 TO authenticated;

COMMENT ON FUNCTION complete_order_with_payment_v10 IS
  'Bump v9 → v10 (POS display-stock isolation). Pour is_display_item : garde de vente sur '
  'display_stock (current_stock non-bloquant, peut passer négatif) + déduction display_movements/display_stock '
  'en plus de la déduction BO existante. Non-display : comportement v9 inchangé.';
```

> **Méthode de copie** : ouvrir `20260517000015_bump_complete_order_v9.sql`, copier les lignes 22-517 dans v10, renommer `complete_order_with_payment_v9` → `_v10` dans la signature, le COMMENT et la clé `rpc_version` du audit_log (`'v9'` → `'v10'`, ligne 498). Puis appliquer les 3 diffs suivants.

- [ ] **Step 2 : DIFF 1 — garde de vente (boucle de validation, ~lignes 183-187 de v9)**

Dans la **première** boucle items (validation), remplacer la garde inconditionnelle :

```sql
-- AVANT (v9, lignes 183-187) :
    IF v_product.current_stock < v_quantity THEN
      RAISE EXCEPTION 'Insufficient stock for product % (have %, need %)',
        v_product.name, v_product.current_stock, v_quantity
        USING ERRCODE = 'P0002';
    END IF;
```

```sql
-- APRÈS (v10) :
    IF v_product.is_display_item THEN
      -- Produit vitrine : garde sur display_stock uniquement (current_stock peut passer négatif).
      IF COALESCE((SELECT quantity FROM display_stock WHERE product_id = v_product.id), 0) < v_quantity THEN
        RAISE EXCEPTION 'Insufficient display stock for product % (need %)',
          v_product.name, v_quantity
          USING ERRCODE = 'P0002';
      END IF;
    ELSE
      -- Produit non-display : garde inchangée sur current_stock.
      IF v_product.current_stock < v_quantity THEN
        RAISE EXCEPTION 'Insufficient stock for product % (have %, need %)',
          v_product.name, v_product.current_stock, v_quantity
          USING ERRCODE = 'P0002';
      END IF;
    END IF;
```

> Note : `v_product` est un `RECORD` issu de `SELECT * FROM products … FOR UPDATE` (ligne 173-175 de v9), donc `v_product.is_display_item` est disponible après le bump de la colonne (Wave 1). Pas de SELECT supplémentaire nécessaire pour le flag.

- [ ] **Step 3 : DIFF 2 — déduction vitrine (boucle d'insertion, après le bloc lignes 394-405 de v9)**

Dans la **deuxième** boucle items (insertion), **après** le `UPDATE products SET current_stock = current_stock - v_quantity …` existant (lignes 402-405), ajouter la déduction vitrine conditionnelle. Il faut récupérer `is_display_item` + `created_by` (`v_profile_id` est déjà en scope) :

```sql
-- APRÈS le UPDATE products existant (≈ ligne 405 de v9), AVANT le END LOOP :
    -- Déduction vitrine pour les produits display (ledger isolé + cache).
    IF (SELECT is_display_item FROM products WHERE id = v_product_id) THEN
      INSERT INTO display_movements (product_id, movement_type, quantity, reason, reference_type, reference_id, created_by)
        VALUES (v_product_id, 'sale', -v_quantity, 'POS sale', 'order', v_order_id, v_profile_id);
      UPDATE display_stock SET quantity = quantity - v_quantity, updated_at = now()
        WHERE product_id = v_product_id;
    END IF;
```

> L'idempotency de l'order (garde `p_idempotency_key` lignes 108-123 de v9) couvre l'ensemble : un replay retourne tôt et ne ré-exécute aucune boucle, donc pas de double `display_movements 'sale'`.

- [ ] **Step 4 : DIFF 3 — audit_log rpc_version (ligne 498 de v9)**

```sql
-- AVANT : 'rpc_version', 'v9'
-- APRÈS : 'rpc_version', 'v10'
```

- [ ] **Step 5 : Appliquer via MCP** — name=`bump_complete_order_v10`.

> Le `DROP … CASCADE` de v9 ne casse aucun objet dépendant (la RPC n'est référencée par aucune vue/contrainte ; seul l'EF l'appelle par nom à l'exécution). Vérifier qu'aucune erreur de dépendance n'est levée.

- [ ] **Step 6 : Vérifier que v10 existe et v9 a disparu**

```sql
SELECT proname FROM pg_proc WHERE proname IN ('complete_order_with_payment_v9','complete_order_with_payment_v10');
```
Attendu : seulement `complete_order_with_payment_v10`.

- [ ] **Step 7 : Commit**

```bash
git add supabase/migrations/20260618000021_bump_complete_order_v10.sql
git commit -m "feat(db): display-stock — bump complete_order_with_payment_v10 (vente double déduction)"
```

---

### Task 15 : REVOKE pair `complete_order_with_payment_v10`

**Files:**
- Create: `supabase/migrations/20260618000022_revoke_pair_complete_order_v10.sql`

- [ ] **Step 1 : Récupérer la signature exacte** (16 types, ordre exact) pour la cible REVOKE

```sql
SELECT oid::regprocedure FROM pg_proc WHERE proname = 'complete_order_with_payment_v10';
```
Copier la signature retournée (ex. `complete_order_with_payment_v10(uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, numeric, jsonb, jsonb)`).

- [ ] **Step 2 : Écrire la migration** (substituer `<SIG>` par la signature exacte du Step 1)

```sql
-- 20260618000022_revoke_pair_complete_order_v10.sql
REVOKE EXECUTE ON FUNCTION public.complete_order_with_payment_v10(<SIG>) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_order_with_payment_v10(<SIG>) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

- [ ] **Step 3 : Appliquer + vérifier** (name=`revoke_pair_complete_order_v10`)

```sql
SELECT has_function_privilege('anon', (SELECT oid::regprocedure::text FROM pg_proc WHERE proname='complete_order_with_payment_v10'), 'EXECUTE') AS anon_exec;
```
Attendu : `false`. (L'EF appelle via `authenticated`, pas `anon` — non impacté.)

- [ ] **Step 4 : Commit**

```bash
git add supabase/migrations/20260618000022_revoke_pair_complete_order_v10.sql
git commit -m "feat(db): display-stock — REVOKE pair complete_order_with_payment_v10"
```

---

### Task 16 : Bump le caller Edge Function `process-payment`

**Files:**
- Modify: `supabase/functions/process-payment/index.ts:149`

- [ ] **Step 1 : Modifier l'appel RPC**

```typescript
// AVANT (ligne 149) :
  const { data, error } = await userClient.rpc('complete_order_with_payment_v9', {
// APRÈS :
  const { data, error } = await userClient.rpc('complete_order_with_payment_v10', {
```

Aucun autre changement : la signature v10 est identique à v9, les arguments passés (`p_session_id`, `p_order_type`, `p_items`, `p_payment`/`p_payments`, `p_idempotency_key`, `p_customer_id`, `p_loyalty_points_redeemed`, `p_table_number`, `p_promotions`) sont inchangés. Mettre à jour le commentaire d'en-tête si pertinent (ligne 1-8).

- [ ] **Step 2 : Déployer l'EF sur le cloud V3 dev**

`mcp__plugin_supabase_supabase__deploy_edge_function` avec `project_id='ikcyvlovptebroadgtvd'`, name=`process-payment`, fichiers = `index.ts` (+ `_shared/cors.ts` si le déploiement exige les dépendances). Sinon, noter dans le commit que le déploiement EF est manuel.

> **Mapping d'erreur préservé** : l'EF mappe déjà `P0002 → insufficient_stock` (ligne 167). La nouvelle garde vitrine lève aussi `P0002` ('Insufficient display stock…') → remappé en `insufficient_stock` côté HTTP. Acceptable pour V1 (le POS bloque déjà la vente via l'affichage `display_stock`). Optionnel : différencier le message dans le payload.

- [ ] **Step 3 : Commit**

```bash
git add supabase/functions/process-payment/index.ts
git commit -m "feat(edge): display-stock — process-payment appelle complete_order_with_payment_v10"
```

---

### Task 17 : Regen types + pgTAP vente v10

**Files:**
- Modify: `packages/supabase/src/types.generated.ts`
- Create: `supabase/tests/complete_order_v10_display.test.sql`

- [ ] **Step 1 : Regen types**

`mcp__plugin_supabase_supabase__generate_typescript_types` → écrire dans `packages/supabase/src/types.generated.ts`. Cela met à jour la fonction RPC `complete_order_with_payment_v10` + `display_stock`/`display_movements`/`is_display_item`.

- [ ] **Step 2 : Écrire le pgTAP vente** (spec §10 — bloc complete_order v10)

```sql
-- supabase/tests/complete_order_v10_display.test.sql
-- pgTAP — vente v10 : double déduction display, garde vitrine, non-régression non-display.
BEGIN;
SELECT plan(6);

-- Fixtures : session ouverte + user MANAGER (pos.sale.create) + 1 produit display + 1 non-display.
-- Adapter les fixtures au seed réel : il faut une pos_sessions 'open' opened_by le profil appelant.
DO $$
DECLARE
  v_auth UUID; v_prof UUID; v_cat UUID; v_disp UUID; v_nondisp UUID; v_sess UUID;
BEGIN
  SELECT up.auth_user_id, up.id INTO v_auth, v_prof
    FROM user_profiles up WHERE up.role_code IN ('MANAGER','ADMIN','SUPER_ADMIN') AND up.deleted_at IS NULL LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  SELECT id INTO v_cat FROM categories WHERE deleted_at IS NULL LIMIT 1;

  INSERT INTO products (sku,name,category_id,retail_price,cost_price,unit,is_display_item,current_stock)
    VALUES ('TST-V10-DISP','V10 Display',v_cat,20000,7000,'pcs',true,3) RETURNING id INTO v_disp;
  INSERT INTO products (sku,name,category_id,retail_price,cost_price,unit,is_display_item,current_stock)
    VALUES ('TST-V10-ND','V10 NonDisplay',v_cat,10000,4000,'pcs',false,50) RETURNING id INTO v_nondisp;

  -- Stock vitrine du produit display.
  PERFORM add_display_stock_v1(v_disp, 10, 'seed', gen_random_uuid());

  -- Session ouverte.
  INSERT INTO pos_sessions (opened_by, status, opening_float)
    VALUES (v_prof, 'open', 0) RETURNING id INTO v_sess;

  PERFORM set_config('breakery.v_disp', v_disp::text, true);
  PERFORM set_config('breakery.v_nondisp', v_nondisp::text, true);
  PERFORM set_config('breakery.v_sess', v_sess::text, true);
END $$;

-- T1 : vente d'un produit display → display_stock -2 ET current_stock -2
DO $$ DECLARE ds_before NUMERIC; ds_after NUMERIC; cs_before NUMERIC; cs_after NUMERIC; res JSONB;
BEGIN
  SELECT quantity INTO ds_before FROM display_stock WHERE product_id = current_setting('breakery.v_disp')::uuid;
  SELECT current_stock INTO cs_before FROM products WHERE id = current_setting('breakery.v_disp')::uuid;
  res := complete_order_with_payment_v10(
    p_session_id := current_setting('breakery.v_sess')::uuid,
    p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('breakery.v_disp'), 'quantity', 2, 'unit_price', 20000)),
    p_payment := jsonb_build_object('method','cash','amount',40000,'cash_received',40000)
  );
  SELECT quantity INTO ds_after FROM display_stock WHERE product_id = current_setting('breakery.v_disp')::uuid;
  SELECT current_stock INTO cs_after FROM products WHERE id = current_setting('breakery.v_disp')::uuid;
  PERFORM set_config('breakery.t1ds', (ds_before - ds_after = 2)::text, true);
  PERFORM set_config('breakery.t1cs', (cs_before - cs_after = 2)::text, true);
END $$;
SELECT is(current_setting('breakery.t1ds'), 'true', 'T1 sale deducts display_stock by qty');
SELECT is(current_setting('breakery.t1cs'), 'true', 'T1 sale deducts current_stock by qty');

-- T2 : garde vitrine — vendre plus que display_stock → insufficient (P0002), même si current_stock négatif autorisé
SELECT throws_ok(
  $$ SELECT complete_order_with_payment_v10(
       p_session_id := current_setting('breakery.v_sess')::uuid,
       p_order_type := 'take_out'::order_type,
       p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('breakery.v_disp'), 'quantity', 99999, 'unit_price', 20000)),
       p_payment := jsonb_build_object('method','cash','amount',1999980000,'cash_received',1999980000)) $$,
  'P0002', NULL, 'T2 sale blocked when display_stock insufficient');

-- T3 : current_stock display PEUT passer négatif si display_stock suffit mais current_stock bas
DO $$ DECLARE cs NUMERIC;
BEGIN
  UPDATE products SET current_stock = 1 WHERE id = current_setting('breakery.v_disp')::uuid;
  -- display_stock restant >= 3 après T1 (10-2=8) ; vendre 3
  PERFORM complete_order_with_payment_v10(
    p_session_id := current_setting('breakery.v_sess')::uuid,
    p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('breakery.v_disp'), 'quantity', 3, 'unit_price', 20000)),
    p_payment := jsonb_build_object('method','cash','amount',60000,'cash_received',60000));
  SELECT current_stock INTO cs FROM products WHERE id = current_setting('breakery.v_disp')::uuid;
  PERFORM set_config('breakery.t3', (cs < 0)::text, true);
END $$;
SELECT is(current_setting('breakery.t3'), 'true', 'T3 display sale lets current_stock go negative');

-- T4 : vente non-display → comportement v9 inchangé (current_stock -q, AUCUN display_movements)
DO $$ DECLARE cs_before NUMERIC; cs_after NUMERIC; dm_count INT;
BEGIN
  SELECT current_stock INTO cs_before FROM products WHERE id = current_setting('breakery.v_nondisp')::uuid;
  PERFORM complete_order_with_payment_v10(
    p_session_id := current_setting('breakery.v_sess')::uuid,
    p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('breakery.v_nondisp'), 'quantity', 4, 'unit_price', 10000)),
    p_payment := jsonb_build_object('method','cash','amount',40000,'cash_received',40000));
  SELECT current_stock INTO cs_after FROM products WHERE id = current_setting('breakery.v_nondisp')::uuid;
  SELECT count(*) INTO dm_count FROM display_movements WHERE product_id = current_setting('breakery.v_nondisp')::uuid;
  PERFORM set_config('breakery.t4cs', (cs_before - cs_after = 4)::text, true);
  PERFORM set_config('breakery.t4dm', (dm_count = 0)::text, true);
END $$;
SELECT is(current_setting('breakery.t4cs'), 'true', 'T4 non-display sale deducts current_stock unchanged');
SELECT is(current_setting('breakery.t4dm'), 'true', 'T4 non-display sale writes no display_movements');

SELECT * FROM finish();
ROLLBACK;
```

> **Fixtures à adapter** : la forme exacte de `pos_sessions` (colonnes `opening_float`/`opened_by`/`status`) doit matcher le schéma réel — vérifier via `\d pos_sessions` avant. De même `order_type` enum values (`'take_out'` vs `'takeaway'`) — confirmer via `SELECT enum_range(NULL::order_type);`.

- [ ] **Step 3 : Exécuter via MCP execute_sql** — itérer jusqu'au vert.

- [ ] **Step 4 : Régression — pgTAP accounting/orders existants**

Ré-exécuter `supabase/tests/accounting.test.sql` et toute suite touchant `complete_order` via `execute_sql` pour confirmer que le bump v10 ne régresse pas la vente standard / loyalty / promo.

- [ ] **Step 5 : Commit**

```bash
git add supabase/tests/complete_order_v10_display.test.sql packages/supabase/src/types.generated.ts
git commit -m "test(db): display-stock — pgTAP vente v10 double déduction + non-régression ; regen types"
```

---

## WAVE 4 — Allowlist produit `is_display_item`

> Produit testable : un MANAGER peut marquer un produit `is_display_item` via les RPC create/update.

### Task 18 : Ajouter `is_display_item` aux RPCs produit

**Files:**
- Create: `supabase/migrations/20260618000023_add_is_display_item_to_product_rpcs.sql`
- Reference: `20260520101735_create_create_product_v1_rpc.sql`, `20260520023035_create_update_product_v1_rpc.sql`

- [ ] **Step 1 : Écrire la migration — `CREATE OR REPLACE` des deux RPCs**

Copier le corps complet des deux RPCs sources et appliquer les ajouts. Pour `create_product_v1` : ajouter `'is_display_item'` à l'allowlist (après `'deduct_stock'`), ajouter `is_display_item` à la liste de colonnes de l'INSERT et `COALESCE((p_payload->>'is_display_item')::BOOLEAN, false)` à la liste VALUES. Pour `update_product_v1` : ajouter `'is_display_item'` à `v_allowed_fields` et la ligne `is_display_item = COALESCE((p_patch->>'is_display_item')::BOOLEAN, is_display_item),` au UPDATE.

```sql
-- 20260618000023_add_is_display_item_to_product_rpcs.sql
-- Étend l'allowlist create_product_v1 + update_product_v1 avec is_display_item.

-- ── create_product_v1 : copier le corps de 20260520101735 et ajouter is_display_item.
CREATE OR REPLACE FUNCTION create_product_v1(p_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id CONSTANT UUID := auth.uid();
  v_allowed   CONSTANT TEXT[] := ARRAY[
    'name','sku','category_id','description',
    'retail_price','wholesale_price','cost_price',
    'tax_inclusive','image_url',
    'is_active','is_favorite','is_semi_finished',
    'visible_on_pos','available_for_sale','track_inventory','deduct_stock',
    'is_display_item',                                   -- ← AJOUT
    'min_stock_threshold','target_gross_margin_pct','default_shelf_life_hours',
    'product_type','unit'
  ];
  v_key TEXT; v_ignored TEXT[] := ARRAY[]::TEXT[];
  v_name TEXT; v_sku TEXT; v_category_id UUID; v_retail NUMERIC; v_unit TEXT; v_id UUID; v_row products%ROWTYPE;
BEGIN
  IF NOT has_permission(v_caller_id, 'products.create') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_payload) LOOP
    IF NOT (v_key = ANY (v_allowed)) THEN v_ignored := array_append(v_ignored, v_key); END IF;
  END LOOP;
  v_name := NULLIF(trim(p_payload->>'name'), '');
  v_sku  := NULLIF(trim(p_payload->>'sku'), '');
  v_category_id := NULLIF(p_payload->>'category_id', '')::UUID;
  v_retail := COALESCE((p_payload->>'retail_price')::NUMERIC, 0);
  v_unit := COALESCE(NULLIF(trim(p_payload->>'unit'), ''), 'pcs');
  IF v_name IS NULL OR v_sku IS NULL OR v_category_id IS NULL THEN
    RAISE EXCEPTION 'missing_required_fields' USING ERRCODE='22023', HINT='name, sku and category_id are required';
  END IF;
  IF v_retail < 0 THEN
    RAISE EXCEPTION 'invalid_retail_price' USING ERRCODE='22023', HINT='retail_price must be >= 0';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM categories WHERE id = v_category_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'category_not_found' USING ERRCODE='P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM products WHERE sku = v_sku AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'sku_taken' USING ERRCODE='23505', HINT=format('A product with sku=%s already exists', v_sku);
  END IF;
  INSERT INTO products (
    sku, name, category_id, description,
    retail_price, wholesale_price, cost_price,
    tax_inclusive, image_url,
    is_active, is_favorite, is_semi_finished,
    visible_on_pos, available_for_sale, track_inventory, deduct_stock,
    is_display_item,                                     -- ← AJOUT
    min_stock_threshold, target_gross_margin_pct, default_shelf_life_hours,
    product_type, unit
  ) VALUES (
    v_sku, v_name, v_category_id, p_payload->>'description',
    v_retail, NULLIF(p_payload->>'wholesale_price','')::NUMERIC, COALESCE((p_payload->>'cost_price')::NUMERIC, 0),
    COALESCE((p_payload->>'tax_inclusive')::BOOLEAN, true), p_payload->>'image_url',
    COALESCE((p_payload->>'is_active')::BOOLEAN, true), COALESCE((p_payload->>'is_favorite')::BOOLEAN, false),
    COALESCE((p_payload->>'is_semi_finished')::BOOLEAN, false),
    COALESCE((p_payload->>'visible_on_pos')::BOOLEAN, true), COALESCE((p_payload->>'available_for_sale')::BOOLEAN, true),
    COALESCE((p_payload->>'track_inventory')::BOOLEAN, true), COALESCE((p_payload->>'deduct_stock')::BOOLEAN, true),
    COALESCE((p_payload->>'is_display_item')::BOOLEAN, false),   -- ← AJOUT
    COALESCE((p_payload->>'min_stock_threshold')::NUMERIC, 0),
    NULLIF(p_payload->>'target_gross_margin_pct','')::NUMERIC, NULLIF(p_payload->>'default_shelf_life_hours','')::INTEGER,
    COALESCE(NULLIF(p_payload->>'product_type',''), 'finished'), v_unit
  ) RETURNING * INTO v_row;
  v_id := v_row.id;
  INSERT INTO product_unit_contexts (product_id, stock_opname_unit, recipe_unit, purchase_unit, sales_unit)
    VALUES (v_id, v_unit, v_unit, v_unit, v_unit) ON CONFLICT (product_id) DO NOTHING;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload, metadata)
    VALUES (v_caller_id, 'product.create', 'product', v_id, p_payload, jsonb_build_object('ignored_fields', v_ignored));
  RETURN jsonb_build_object('product', to_jsonb(v_row), 'ignored_fields', to_jsonb(v_ignored));
END $$;

-- ── update_product_v1 : copier le corps de 20260520023035 et ajouter is_display_item.
CREATE OR REPLACE FUNCTION update_product_v1(p_product_id UUID, p_patch JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id      UUID := auth.uid();
  v_allowed_fields CONSTANT TEXT[] := ARRAY[
    'name', 'sku', 'category_id', 'description',
    'retail_price', 'wholesale_price', 'tax_inclusive', 'image_url',
    'is_active', 'is_favorite', 'is_semi_finished',
    'visible_on_pos', 'available_for_sale', 'track_inventory', 'deduct_stock',
    'is_display_item',                                   -- ← AJOUT
    'min_stock_threshold', 'target_gross_margin_pct', 'default_shelf_life_hours'
  ];
  v_key TEXT; v_ignored_fields TEXT[] := ARRAY[]::TEXT[]; v_product products%ROWTYPE;
BEGIN
  IF NOT has_permission(v_caller_id, 'products.update') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_product_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF NOT (v_key = ANY (v_allowed_fields)) THEN v_ignored_fields := array_append(v_ignored_fields, v_key); END IF;
  END LOOP;
  UPDATE products SET
    name = COALESCE((p_patch->>'name')::TEXT, name),
    sku = COALESCE((p_patch->>'sku')::TEXT, sku),
    category_id = COALESCE((p_patch->>'category_id')::UUID, category_id),
    description = COALESCE((p_patch->>'description')::TEXT, description),
    retail_price = COALESCE((p_patch->>'retail_price')::NUMERIC, retail_price),
    wholesale_price = COALESCE((p_patch->>'wholesale_price')::NUMERIC, wholesale_price),
    tax_inclusive = COALESCE((p_patch->>'tax_inclusive')::BOOLEAN, tax_inclusive),
    image_url = COALESCE((p_patch->>'image_url')::TEXT, image_url),
    is_active = COALESCE((p_patch->>'is_active')::BOOLEAN, is_active),
    is_favorite = COALESCE((p_patch->>'is_favorite')::BOOLEAN, is_favorite),
    is_semi_finished = COALESCE((p_patch->>'is_semi_finished')::BOOLEAN, is_semi_finished),
    visible_on_pos = COALESCE((p_patch->>'visible_on_pos')::BOOLEAN, visible_on_pos),
    available_for_sale = COALESCE((p_patch->>'available_for_sale')::BOOLEAN, available_for_sale),
    track_inventory = COALESCE((p_patch->>'track_inventory')::BOOLEAN, track_inventory),
    deduct_stock = COALESCE((p_patch->>'deduct_stock')::BOOLEAN, deduct_stock),
    is_display_item = COALESCE((p_patch->>'is_display_item')::BOOLEAN, is_display_item),  -- ← AJOUT
    min_stock_threshold = COALESCE((p_patch->>'min_stock_threshold')::NUMERIC, min_stock_threshold),
    target_gross_margin_pct = COALESCE((p_patch->>'target_gross_margin_pct')::NUMERIC, target_gross_margin_pct),
    default_shelf_life_hours = COALESCE((p_patch->>'default_shelf_life_hours')::INTEGER, default_shelf_life_hours),
    updated_at = now()
  WHERE id = p_product_id RETURNING * INTO v_product;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload, metadata)
    VALUES (v_caller_id, 'product.update', 'product', p_product_id, p_patch, jsonb_build_object('ignored_fields', v_ignored_fields));
  RETURN jsonb_build_object('product', to_jsonb(v_product), 'ignored_fields', to_jsonb(v_ignored_fields));
END $$;
```

> Les RPCs gardent leur signature exacte (`create_product_v1(JSONB)`, `update_product_v1(UUID, JSONB)`) → pas de DROP nécessaire, `CREATE OR REPLACE` suffit. Pas de nouvelle REVOKE pair (les RPC existantes en ont déjà une depuis S27).

- [ ] **Step 2 : Appliquer via MCP** — name=`add_is_display_item_to_product_rpcs`.

- [ ] **Step 3 : Vérifier** (un update marque le flag)

```sql
-- sur un produit de test (à rollback) :
BEGIN;
SELECT set_config('request.jwt.claim.sub',
  (SELECT auth_user_id::text FROM user_profiles WHERE role_code IN ('MANAGER','ADMIN','SUPER_ADMIN') AND deleted_at IS NULL LIMIT 1), true);
SELECT (update_product_v1((SELECT id FROM products WHERE deleted_at IS NULL LIMIT 1),
  '{"is_display_item": true}'::jsonb) -> 'product' ->> 'is_display_item') AS flagged;
ROLLBACK;
```
Attendu : `flagged = true`.

- [ ] **Step 4 : Regen types + commit**

Regen `packages/supabase/src/types.generated.ts` (le retour RPC inclut désormais `is_display_item` dans `products` Row — souvent déjà capturé en Task 1 ; re-regen par sûreté).

```bash
git add supabase/migrations/20260618000023_add_is_display_item_to_product_rpcs.sql packages/supabase/src/types.generated.ts
git commit -m "feat(db): display-stock — is_display_item dans allowlist create/update_product_v1"
```

---

## WAVE 5 — POS wiring

> Produit testable : la vue POS affiche `display_stock`, la mise en vitrine appelle `add_display_stock_v1`, les gestes clôture fonctionnent. Smoke tests POS verts.

### Task 19 : `usePOSStockProducts` lit `display_stock` + filtre `is_display_item`

**Files:**
- Modify: `apps/pos/src/features/stock/hooks/usePOSStockProducts.ts`
- Test: `apps/pos/src/features/stock/__tests__/usePOSStockProducts.test.ts` (créer si absent)

- [ ] **Step 1 : Écrire le test d'abord (TDD)**

Créer `apps/pos/src/features/stock/__tests__/usePOSStockProducts.test.ts` — mock `supabase.from('products')` pour renvoyer 2 produits (1 display avec `display_stock` lié, 1 non-display) et asserter que le hook ne renvoie que le display avec `display_stock` mappé en `display_stock`. (Adapter au pattern de mock supabase déjà utilisé dans `__tests__/POSStockView.test.tsx`.)

- [ ] **Step 2 : Modifier le hook — type + select + map**

```typescript
// Remplacer l'interface POSStockProductRow.current_stock par display_stock,
// et le SELECT pour filtrer is_display_item + embed display_stock.
export interface POSStockProductRow {
  id: string;
  sku: string;
  name: string;
  unit: string;
  image_url: string | null;
  display_stock: number;       // ← remplace current_stock (vitrine)
  min_stock_threshold: number;
  retail_price: number;
  category_id: string;
  category_name: string;
  category_slug: string;
}

interface RawRow {
  id: string; sku: string; name: string; unit: string; image_url: string | null;
  min_stock_threshold: number; retail_price: number; category_id: string;
  category: { id: string; name: string; slug: string } | null;
  display_stock: { quantity: number } | null;   // ← embed LEFT JOIN
}

export const POS_STOCK_PRODUCTS_KEY = ['pos-stock-products'];

export function usePOSStockProducts() {
  return useQuery<POSStockProductRow[]>({
    queryKey: POS_STOCK_PRODUCTS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select(
          'id, sku, name, unit, image_url, min_stock_threshold, retail_price, category_id, ' +
          'category:categories(id, name, slug), display_stock(quantity)',
        )
        .eq('is_active', true)
        .eq('is_display_item', true)     // ← seuls les produits vitrine
        .is('deleted_at', null)
        .order('name');
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as unknown as RawRow[];
      return rows.map((r) => ({
        id: r.id, sku: r.sku, name: r.name, unit: r.unit, image_url: r.image_url,
        display_stock: Number(r.display_stock?.quantity ?? 0),
        min_stock_threshold: Number(r.min_stock_threshold),
        retail_price: Number(r.retail_price),
        category_id: r.category_id,
        category_name: r.category?.name ?? 'Uncategorized',
        category_slug: r.category?.slug ?? 'uncategorized',
      }));
    },
    staleTime: 15_000,
  });
}
```

> Le PostgREST embed `display_stock(quantity)` fonctionne car `display_stock.product_id` est une FK vers `products.id` (relation détectée). Pour une relation 1-1, l'embed renvoie un objet (pas un tableau) ; si PostgREST renvoie un tableau `[{quantity}]`, adapter le map en `r.display_stock?.[0]?.quantity`. Vérifier à l'exécution.

- [ ] **Step 3 : Lancer le test**

```bash
pnpm --filter @breakery/app-pos test usePOSStockProducts
```
Attendu : PASS.

- [ ] **Step 4 : Commit**

```bash
git add apps/pos/src/features/stock/hooks/usePOSStockProducts.ts apps/pos/src/features/stock/__tests__/usePOSStockProducts.test.ts
git commit -m "feat(pos): display-stock — usePOSStockProducts lit display_stock + filtre is_display_item"
```

---

### Task 20 : `usePOSReceiveStock` → `add_display_stock_v1`

**Files:**
- Modify: `apps/pos/src/features/stock/hooks/usePOSReceiveStock.ts`

- [ ] **Step 1 : Modifier la mutation pour cibler la nouvelle RPC**

```typescript
// Renommer sémantiquement en "mise en vitrine". Garder l'export usePOSReceiveStock
// pour minimiser le diff dans POSStockView, mais cibler add_display_stock_v1.
export function usePOSReceiveStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: POSReceiveStockArgs) => {
      const rpcArgs: {
        p_product_id: string; p_quantity: number; p_idempotency_key: string; p_reason?: string;
      } = {
        p_product_id: args.productId,
        p_quantity: args.quantity,
        p_idempotency_key: args.idempotencyKey,
      };
      if (args.reason !== undefined && args.reason.trim() !== '') {
        rpcArgs.p_reason = args.reason.trim();
      }
      const { data, error } = await supabase.rpc('add_display_stock_v1', rpcArgs);  // ← changement
      if (error) throw new POSReceiveStockError(classify(error.message), error.message);
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: POS_STOCK_PRODUCTS_KEY });
    },
  });
}
```

Mettre à jour `classify()` pour mapper les nouveaux codes : ajouter `if (message.includes('not_a_display_item')) return 'not_a_display_item';`.

- [ ] **Step 2 : Vérifier le permission gate côté UI**

Dans `POSStockView.tsx:39`, `hasInventoryReceive` lit `inventory.receive`. La mise en vitrine est désormais gatée `display.manage` côté RPC. Mettre à jour la garde UI ligne 39 → `useAuthStore((s) => s.hasPermission('display.manage'))` (renommer la variable en `hasDisplayManage`). Ajuster `handleReceive` ligne 83 + le toast d'erreur.

- [ ] **Step 3 : Lancer la régression smoke existante**

```bash
pnpm --filter @breakery/app-pos test stock
```
Attendu : les tests existants passent après mise à jour des mocks RPC (`add_display_stock_v1`).

- [ ] **Step 4 : Commit**

```bash
git add apps/pos/src/features/stock/hooks/usePOSReceiveStock.ts apps/pos/src/features/stock/POSStockView.tsx
git commit -m "feat(pos): display-stock — mise en vitrine via add_display_stock_v1 (gate display.manage)"
```

---

### Task 21 : Hooks clôture POS (`useReturnToKitchen`, `useWasteDisplay`, `useAdjustDisplay`)

**Files:**
- Create: `apps/pos/src/features/stock/hooks/useReturnToKitchen.ts`
- Create: `apps/pos/src/features/stock/hooks/useWasteDisplay.ts`
- Create: `apps/pos/src/features/stock/hooks/useAdjustDisplay.ts`

- [ ] **Step 1 : `useReturnToKitchen.ts`** (pattern `usePOSReceiveStock`)

```typescript
// apps/pos/src/features/stock/hooks/useReturnToKitchen.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { POS_STOCK_PRODUCTS_KEY } from './usePOSStockProducts';

export interface ReturnToKitchenArgs {
  productId: string; quantity: number; idempotencyKey: string; reason?: string;
}
export class DisplayGestureError extends Error {
  constructor(public code: string, message?: string) { super(message ?? code); this.name = 'DisplayGestureError'; }
}
function classify(m: string): string {
  if (m.includes('forbidden')) return 'forbidden';
  if (m.includes('insufficient_display_stock')) return 'insufficient_display_stock';
  if (m.includes('quantity_must_be_positive')) return 'quantity_must_be_positive';
  return 'unknown';
}
export function useReturnToKitchen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: ReturnToKitchenArgs) => {
      const rpcArgs: { p_product_id: string; p_quantity: number; p_idempotency_key: string; p_reason?: string } = {
        p_product_id: args.productId, p_quantity: args.quantity, p_idempotency_key: args.idempotencyKey,
      };
      if (args.reason?.trim()) rpcArgs.p_reason = args.reason.trim();
      const { data, error } = await supabase.rpc('return_display_to_kitchen_v1', rpcArgs);
      if (error) throw new DisplayGestureError(classify(error.message), error.message);
      return data;
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: POS_STOCK_PRODUCTS_KEY }); },
  });
}
```

- [ ] **Step 2 : `useWasteDisplay.ts`** — identique en structure, RPC `waste_display_stock_v1`, réutiliser `DisplayGestureError` (importé depuis `useReturnToKitchen`). Args = `{ productId, quantity, idempotencyKey, reason? }`.

- [ ] **Step 3 : `useAdjustDisplay.ts`** — RPC `adjust_display_stock_v1`, args = `{ productId, newQty, reason, idempotencyKey }` (`reason` REQUIS, ≥ 3 chars), classify ajoute `reason_required` + `not_a_display_item`.

```typescript
// apps/pos/src/features/stock/hooks/useAdjustDisplay.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { POS_STOCK_PRODUCTS_KEY } from './usePOSStockProducts';
import { DisplayGestureError } from './useReturnToKitchen';

export interface AdjustDisplayArgs {
  productId: string; newQty: number; reason: string; idempotencyKey: string;
}
function classify(m: string): string {
  if (m.includes('forbidden')) return 'forbidden';
  if (m.includes('reason_required')) return 'reason_required';
  if (m.includes('not_a_display_item')) return 'not_a_display_item';
  return 'unknown';
}
export function useAdjustDisplay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: AdjustDisplayArgs) => {
      const { data, error } = await supabase.rpc('adjust_display_stock_v1', {
        p_product_id: args.productId, p_new_qty: args.newQty, p_reason: args.reason, p_idempotency_key: args.idempotencyKey,
      });
      if (error) throw new DisplayGestureError(classify(error.message), error.message);
      return data;
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: POS_STOCK_PRODUCTS_KEY }); },
  });
}
```

- [ ] **Step 4 : Typecheck**

```bash
pnpm --filter @breakery/app-pos typecheck
```
Attendu : PASS.

- [ ] **Step 5 : Commit**

```bash
git add apps/pos/src/features/stock/hooks/useReturnToKitchen.ts apps/pos/src/features/stock/hooks/useWasteDisplay.ts apps/pos/src/features/stock/hooks/useAdjustDisplay.ts
git commit -m "feat(pos): display-stock — hooks clôture (return/waste/adjust)"
```

---

### Task 22 : Vue + carte POS affichent `display_stock` et exposent la clôture

**Files:**
- Modify: `apps/pos/src/features/stock/components/POSStockCard.tsx`
- Modify: `apps/pos/src/features/stock/POSStockView.tsx`
- Modify: `apps/pos/src/features/stock/__tests__/POSStockView.test.tsx`

- [ ] **Step 1 : `POSStockCard.tsx` — remplacer `current_stock` par `display_stock`**

Remplacer toutes les références `product.current_stock` (lignes 33, 91) par `product.display_stock`. Le reste de la carte (banners out/low, stepper) reste identique. Ajouter un menu/section "Clôture" sous la carte avec 3 actions (Retour cuisine / Perte / Ajuster) déclenchant des callbacks `onReturnToKitchen(qty)`, `onWaste(qty, reason)`, `onAdjust(newQty, reason)` passés en props (le parent câble les hooks). Garder le geste "Receive +N" existant (= mise en vitrine).

> Garder le diff minimal : pour V1, exposer au moins **Retour cuisine** et **Perte** (les 2 gestes de clôture spec §3). L'ajustement peut être un bouton secondaire. Réutiliser le pattern stepper existant pour la quantité.

- [ ] **Step 2 : `POSStockView.tsx` — KPI + câblage des hooks clôture**

- Ligne 54-55 : remplacer `r.current_stock` par `r.display_stock` dans le calcul `counts`.
- Importer + instancier `useReturnToKitchen`, `useWasteDisplay`, `useAdjustDisplay`.
- Ajouter des handlers (`handleReturnToKitchen`, `handleWaste`, `handleAdjust`) sur le modèle de `handleReceive` (ligne 82-100) : gate `hasDisplayManage`, `idempotencyKey: crypto.randomUUID()`, toast succès/erreur, passer en props à `POSStockCard`.

- [ ] **Step 3 : Mettre à jour le smoke test**

Dans `__tests__/POSStockView.test.tsx`, remplacer `current_stock` par `display_stock` dans le `POSStockProductRow` mock (lignes ~49-64) et les assertions KPI. Ajouter un test : un tap "Retour cuisine" appelle `useReturnToKitchen.mutate`.

```bash
pnpm --filter @breakery/app-pos test POSStockView
```
Attendu : PASS.

- [ ] **Step 4 : Commit**

```bash
git add apps/pos/src/features/stock/components/POSStockCard.tsx apps/pos/src/features/stock/POSStockView.tsx apps/pos/src/features/stock/__tests__/POSStockView.test.tsx
git commit -m "feat(pos): display-stock — vue/carte affichent display_stock + gestes clôture"
```

---

## WAVE 6 — Back office (toggle + page consultation)

> Produit testable : un admin marque `is_display_item` dans l'éditeur produit ; une page read-only liste les compteurs vitrine + ledger.

### Task 23 : Toggle `is_display_item` dans l'éditeur produit

**Files:**
- Modify: `apps/backoffice/src/features/products/hooks/useUpdateProduct.ts:13-32`
- Modify: `apps/backoffice/src/features/products/components/GeneralPanel.tsx:246-278`

- [ ] **Step 1 : Étendre `ProductUpdatePatch`**

Dans `useUpdateProduct.ts`, ajouter `is_display_item?: boolean;` au type `ProductUpdatePatch` (à côté de `track_inventory`/`deduct_stock`).

- [ ] **Step 2 : Ajouter le `ToggleRow` dans `GeneralPanel`**

Dans `GeneralPanel.tsx`, après le toggle `deduct_stock` (≈ lignes 246-278), ajouter un `ToggleRow` pour `is_display_item` en suivant exactement le pattern existant :

```tsx
<ToggleRow
  label="Display-case item (POS vitrine)"
  description="Stock vitrine séparé ; la vente garde sur le compteur vitrine, pas l'inventaire global."
  checked={draft.is_display_item ?? false}
  onChange={(v) => handleToggle('is_display_item', v)}
/>
```

> Adapter le nom du composant/props au `ToggleRow` réel du fichier (vérifier sa signature lignes 246-278). Le `draft`/`handleToggle` suit le pattern existant (`onChange?.({ [key]: value })`, lignes 35-39). S'assurer que `ProductRow` (type du draft) inclut `is_display_item` — étendre le SELECT de `useProductDetail`/`useProducts` si nécessaire pour charger la colonne.

- [ ] **Step 3 : Étendre le SELECT produit BO si besoin**

Vérifier que le hook qui charge le produit en édition (`useProductDetail` ou `useProducts`) SELECT bien `is_display_item`. Sinon l'ajouter à la liste de colonnes + au type `ProductRow`.

- [ ] **Step 4 : Smoke test**

Créer/étendre un smoke test BO (`apps/backoffice/src/features/products/__tests__/general-panel-display-item.smoke.test.tsx`) : rend `GeneralPanel` avec un produit, toggle `is_display_item`, asserte que `onChange` est appelé avec `{ is_display_item: true }`. Pattern : `MemoryRouter` + render + fireEvent (voir `products-list-filter.smoke.test.tsx`).

```bash
pnpm --filter @breakery/app-backoffice test general-panel
```
Attendu : PASS.

- [ ] **Step 5 : Commit**

```bash
git add apps/backoffice/src/features/products/hooks/useUpdateProduct.ts apps/backoffice/src/features/products/components/GeneralPanel.tsx apps/backoffice/src/features/products/__tests__/general-panel-display-item.smoke.test.tsx
git commit -m "feat(backoffice): display-stock — toggle is_display_item dans l'éditeur produit"
```

---

### Task 24 : Option create — `is_display_item` dans `NewProductDialog`

**Files:**
- Modify: `apps/backoffice/src/features/products/hooks/useCreateProduct.ts`
- Modify: `apps/backoffice/src/features/products/components/NewProductDialog.tsx`

- [ ] **Step 1 : Étendre le payload create**

Dans `useCreateProduct.ts` (type `CreateProductPayload`) ajouter `is_display_item?: boolean;`. Dans `NewProductDialog.tsx` ajouter une checkbox/toggle optionnelle "Display-case item" (défaut décoché) et l'inclure dans l'objet envoyé à `createProduct.mutate`.

- [ ] **Step 2 : Smoke test** — étendre `new-product-dialog.smoke.test.tsx` (existant S27b) : cocher le toggle → asserte que le payload contient `is_display_item: true`.

```bash
pnpm --filter @breakery/app-backoffice test new-product-dialog
```
Attendu : PASS.

- [ ] **Step 3 : Commit**

```bash
git add apps/backoffice/src/features/products/hooks/useCreateProduct.ts apps/backoffice/src/features/products/components/NewProductDialog.tsx apps/backoffice/src/features/products/__tests__/new-product-dialog.smoke.test.tsx
git commit -m "feat(backoffice): display-stock — is_display_item optionnel à la création produit"
```

---

### Task 25 : Hooks read-only `useDisplayStock` + `useDisplayMovements`

**Files:**
- Create: `apps/backoffice/src/features/inventory/hooks/useDisplayStock.ts`
- Create: `apps/backoffice/src/features/inventory/hooks/useDisplayMovements.ts`

- [ ] **Step 1 : `useDisplayStock.ts`** (query read-only — pattern `usePOSStockProducts`, sans filtre `is_active`)

```typescript
// apps/backoffice/src/features/inventory/hooks/useDisplayStock.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface DisplayStockRow {
  product_id: string; product_name: string; sku: string; unit: string;
  quantity: number; updated_at: string;
}
export const DISPLAY_STOCK_KEY = ['display-stock'];

export function useDisplayStock() {
  return useQuery<DisplayStockRow[]>({
    queryKey: DISPLAY_STOCK_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('display_stock')
        .select('quantity, updated_at, product:products(id, name, sku, unit)')
        .order('updated_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []).map((r: any) => ({
        product_id: r.product?.id,
        product_name: r.product?.name ?? '—',
        sku: r.product?.sku ?? '—',
        unit: r.product?.unit ?? 'pcs',
        quantity: Number(r.quantity),
        updated_at: r.updated_at,
      }));
    },
    staleTime: 15_000,
  });
}
```

- [ ] **Step 2 : `useDisplayMovements.ts`** — query du ledger récent (LIMIT 200 ordered `created_at DESC`, embed product name). Pattern simple (pas de cursor obligatoire en V1 ; suivre `StockMovementsPage` si infinite scroll souhaité, sinon LIMIT 200 MVP).

```typescript
// apps/backoffice/src/features/inventory/hooks/useDisplayMovements.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface DisplayMovementRow {
  id: string; product_name: string; movement_type: string; quantity: number;
  reason: string | null; reference_type: string | null; created_at: string;
}
export const DISPLAY_MOVEMENTS_KEY = ['display-movements'];

export function useDisplayMovements() {
  return useQuery<DisplayMovementRow[]>({
    queryKey: DISPLAY_MOVEMENTS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('display_movements')
        .select('id, movement_type, quantity, reason, reference_type, created_at, product:products(name)')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return (data ?? []).map((r: any) => ({
        id: r.id, product_name: r.product?.name ?? '—', movement_type: r.movement_type,
        quantity: Number(r.quantity), reason: r.reason, reference_type: r.reference_type, created_at: r.created_at,
      }));
    },
    staleTime: 15_000,
  });
}
```

- [ ] **Step 3 : Typecheck + commit**

```bash
pnpm --filter @breakery/app-backoffice typecheck
git add apps/backoffice/src/features/inventory/hooks/useDisplayStock.ts apps/backoffice/src/features/inventory/hooks/useDisplayMovements.ts
git commit -m "feat(backoffice): display-stock — hooks read-only useDisplayStock + useDisplayMovements"
```

---

### Task 26 : Page `DisplayStockPage` + route + sidebar

**Files:**
- Create: `apps/backoffice/src/pages/inventory/DisplayStockPage.tsx`
- Modify: `apps/backoffice/src/routes/index.tsx:238-244` (zone routes inventory)
- Modify: `apps/backoffice/src/layouts/Sidebar.tsx:86-97` (groupe Stock)

- [ ] **Step 1 : Écrire la page read-only** (pattern `StockMovementsPage`)

`DisplayStockPage.tsx` : deux sections — (1) table des compteurs (`useDisplayStock` : produit, SKU, quantité vitrine, dernière maj) ; (2) table du ledger récent (`useDisplayMovements` : date, produit, type, quantité signée, raison). Pas de mutation. États loading/error/empty. Réutiliser les primitives de table du projet (`DataTable` ou la structure de `StockMovementsPage`).

- [ ] **Step 2 : Déclarer la route gated `display.read`**

Dans `routes/index.tsx`, à côté de `inventory/movements` (lignes 238-244) :

```tsx
<Route path="inventory/display" element={
  <PermissionGate required="display.read">
    <DisplayStockPage />
  </PermissionGate>
} />
```

Ajouter le lazy import en tête de fichier sur le modèle des autres pages inventory.

- [ ] **Step 3 : Entrée sidebar**

Dans `Sidebar.tsx`, groupe Stock (lignes 86-97), ajouter :

```tsx
{ to: '/backoffice/inventory/display', label: 'Display Stock (Vitrine)',
  icon: Store, permission: 'display.read', indent: 1 },
```

Importer une icône lucide adéquate (ex. `Store` ou `MonitorSmartphone`) en tête de `Sidebar.tsx`.

- [ ] **Step 4 : Smoke test page**

Créer `apps/backoffice/src/pages/inventory/__tests__/display-stock-page.smoke.test.tsx` : mock `useDisplayStock`/`useDisplayMovements` (vi.mock), render sous `MemoryRouter`, asserte le rendu des deux tables (1 ligne compteur + 1 ligne ledger).

```bash
pnpm --filter @breakery/app-backoffice test display-stock-page
```
Attendu : PASS.

- [ ] **Step 5 : Commit**

```bash
git add apps/backoffice/src/pages/inventory/DisplayStockPage.tsx apps/backoffice/src/routes/index.tsx apps/backoffice/src/layouts/Sidebar.tsx apps/backoffice/src/pages/inventory/__tests__/display-stock-page.smoke.test.tsx
git commit -m "feat(backoffice): display-stock — page consultation read-only + route + sidebar"
```

---

## WAVE 7 — Intégration, régression & clôture

> Produit testable : suite complète verte, aucune régression POS/BO/DB.

### Task 27 : Régression de non-régression inventaire BO

**Files:** (aucune — vérification)

- [ ] **Step 1 : Régression rapports inventaire** — confirmer que la mise en vitrine ne touche plus `current_stock` (donc `get_stock_levels_v1` / wastage / perishable inchangés).

```sql
-- Sanity : un add_display_stock ne crée aucun stock_movements ni ne bouge current_stock.
BEGIN;
SELECT set_config('request.jwt.claim.sub',
  (SELECT auth_user_id::text FROM user_profiles WHERE role_code IN ('MANAGER','ADMIN','SUPER_ADMIN') AND deleted_at IS NULL LIMIT 1), true);
-- (créer un produit display de test, capter current_stock, add_display_stock, re-capter → inchangé)
ROLLBACK;
```

- [ ] **Step 2 : Ré-exécuter les suites pgTAP touchées**

Via `execute_sql` : `accounting.test.sql` + toute suite `complete_order`/inventory existante. Attendu : inchangées (vert).

- [ ] **Step 3 : Suites front complètes**

```bash
pnpm --filter @breakery/app-pos test
pnpm --filter @breakery/app-backoffice test
```
Attendu : pas de régression (mettre à jour tout mock RPC référant `record_incoming_stock_v1`/`complete_order_with_payment_v9`).

---

### Task 28 : Typecheck global + build + types final

**Files:**
- Verify: `packages/supabase/src/types.generated.ts` (à jour)

- [ ] **Step 1 : Regen types final** (post `_024`) — confirmer que `types.generated.ts` reflète enum, 2 tables, `is_display_item`, RPC v10 + 4 RPC display.

- [ ] **Step 2 : Typecheck monorepo**

```bash
pnpm typecheck
```
Attendu : 6/6 PASS (le fail pré-existant `@breakery/ui` lié à l'env n'est pas introduit par ce travail — vérifier qu'il est identique à `master`).

- [ ] **Step 3 : Build**

```bash
pnpm build
```
Attendu : succès.

- [ ] **Step 4 : Commit final types si modifié**

```bash
git add packages/supabase/src/types.generated.ts
git commit -m "chore(types): display-stock — regen types final post-bloc migrations"
```

---

### Task 29 : Mémoire projet + finalisation branche

- [ ] **Step 1 : Mettre à jour la mémoire projet**

Mettre à jour le fichier mémoire `pos-stock-display-counter` (`C:\Users\guich\.claude\projects\C--Users-guich-a-trier-The-Breakery-ERP\memory\pos-stock-display-counter.md`) pour refléter que l'isolation est désormais IMPLÉMENTÉE (`display_stock`/`display_movements` séparés, vente = double déduction, mise en vitrine n'impacte plus `current_stock`). Ajuster le `MEMORY.md` pointer si le hook change.

- [ ] **Step 2 : Finaliser la branche**

Invoquer la skill `superpowers:finishing-a-development-branch` pour décider merge/PR. Résumé attendu : 15 migrations `20260618000010..024`, 1 EF bump, ~13 fichiers front, 2 suites pgTAP, smoke POS+BO, types regen.

---

## Risques & points d'attention (rappel de la spec §11, traités dans le plan)

- **R1 — bump v10** : Task 14 copie v9 verbatim + 3 diffs chirurgicaux + DROP même migration + pgTAP non-régression (Task 17 Step 4). EF bump Task 16.
- **R2 — `current_stock` négatif** : vérifié — **aucun** `CHECK (current_stock >= 0)` sur `products` (`init_catalog:25`). Rien à relâcher. La garde vente/waste pour display est volontairement non-bloquante côté BO.
- **R3 — bascule sans migration de données** : `display_stock` démarre à 0 ; la vitrine se remplit au prochain `add_display_stock`. Acceptable (dev only). Aucune tâche de migration historique (hors V1).
- **R4 — double source d'affichage** : Task 19 cantonne la lecture POS à `display_stock` + filtre `is_display_item` ; les produits non-display sortent de la vue vitrine.
- **R5 (nouveau) — INSERT direct `stock_movements` waste** : validé contre la contrainte de section (`waste` exempté) et le trigger JE (`waste` géré, émet si `cost_price>0`). Test T7 (Task 13) asserte l'émission du JE.

## Hors-scope explicite (rappel)
Paquet discount J+1, datation/péremption vitrine, FIFO vitrine, migration des `current_stock` historiques, valorisation du `display_stock`. Différenciation du message HTTP `insufficient_display_stock` vs `insufficient_stock` (V1 remappe les deux en `insufficient_stock`).
