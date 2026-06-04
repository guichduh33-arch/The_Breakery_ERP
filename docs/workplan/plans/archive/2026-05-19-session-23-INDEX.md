# Session 23 — INDEX (Landed cost + sample/promo opt-out)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. 2 streams parallèles en Wave 1 + Wave 2 serial + closeout serial.

**Goal :** Fermer TASK-07-012 (landed cost shipping pro-rata 3 méthodes) + DEV-S17-1.C-01 (skip_wac sample/promo) en une session. Pas de toggle douane/assurance (exclu).

**Architecture :** Wave 0 (spec/INDEX/branch) serial → Wave 1 parallel 2 streams (Stream A = DB+RPC, Stream B = domain pure-TS) → Wave 2 serial 1 stream UI BO → Wave 3 closeout serial. Cloud-only via Supabase MCP — no Docker.

**Tech Stack :** Postgres `SELECT FOR UPDATE` advisory lock + jsonb envelope, SECURITY DEFINER RPC, pgTAP via MCP, Vitest live RPC, React Query mutations, TanStack Router, shadcn-ui Dialog/CenterModal primitives.

**Date :** 2026-05-19
**Branch :** `swarm/session-23` (off `f2742a4` master post-S22 squash-merge PR #26)
**Spec :** [`../specs/2026-05-19-session-23-spec.md`](../../specs/archive/2026-05-19-session-23-spec.md)
**Migration block réservé :** `20260527000010..099`

---

## 1. Goal global

| # | Item | Phase | Estim |
|---|------|-------|-------|
| 1 | 4 migrations DDL (PO shipping/method, product weight, PO items landed_cost, movement skip_wac) | 1.A | S ~30min |
| 2 | RPC `receive_po_v1` (agrège receipt multi-lignes, allocation, idempotency) | 1.A | M ~2h |
| 3 | RPC `recalculate_po_landed_costs_preview_v1` (pure read, UI preview) | 1.A | S ~30min |
| 4 | MODIFY `record_stock_movement_v1` + `receive_stock_v1` (+p_skip_wac) | 1.A | S ~45min |
| 5 | pgTAP `landed_cost.test.sql` (12 cas T1-T12) | 1.A | M ~1.5h |
| 6 | Vitest live `receive-po.test.ts` (5 scénarios) | 1.A | M ~1h |
| 7 | Domain helper `landedCostAllocation.ts` (pure fn) + 8-10 tests unitaires | 1.B | S ~1h |
| 8 | `ReceivePoPage` (NEW) + 3 composants + hook `useReceivePo` | 2.A | M ~2.5h |
| 9 | MODIFY `ProductFormDrawer` + `PurchaseOrderForm` + `PurchaseOrderDetailPage` | 2.A | S ~1h |
| 10 | i18n fr.json (~25 strings) | 2.A | S ~20min |
| 11 | BO smoke `receive-po-page.smoke.test.tsx` | 2.A | S ~45min |
| 12 | Closeout (types regen, Status notes, roadmap, PR) | 3.A | M ~1.5h |

**Total :** ~12h serial ; ~8h wall-time avec Wave 1 streams parallèles.

---

## 2. Architecture en vagues

```
Wave 0 (planning) — Phase 0.1
  └─► Spec ✓ + INDEX ✓ + branche `swarm/session-23` ✓
        │
        ▼
Wave 1 (2 streams parallèles via subagent fan-out)
  ├── Stream A : Phase 1.A — DB + RPC + tests DB
  │     · 4 migrations DDL (010-013)
  │     · 2 RPCs NEW (receive_po_v1, recalculate_po_landed_costs_preview_v1)
  │     · 2 RPCs MODIFY (record_stock_movement_v1, receive_stock_v1)
  │     · pgTAP 12 cas + Vitest live 5 scénarios
  │
  └── Stream B : Phase 1.B — Domain helper pure TS
        · packages/domain/src/inventory/landedCostAllocation.ts
        · 8-10 tests unitaires Vitest
        │
        ▼ Sync gate (les 2 streams DONE → spec-reviewer)
Wave 2 — Phase 2.A : UI BO (1 stream serial)
  · ReceivePoPage NEW + 3 composants + AllocationPreviewModal
  · MODIFY ProductFormDrawer (+weight_grams)
  · MODIFY PurchaseOrderForm (+shipping_cost +allocation_method)
  · MODIFY PurchaseOrderDetailPage (+landed_cost column)
  · Hook useReceivePo
  · i18n fr.json (~25 strings)
  · BO smoke tests
        │
        ▼
Wave 3 — Phase 3.A : closeout
  · Types regen via MCP
  · Status notes 2 modules + roadmap globale 3 lignes Indicateurs
  · INDEX §10 deviations
  · Quality gates final
  · Commit + push + PR
```

---

## 3. Wave 0 — Prerequisites

### Phase 0.1 — Spec + INDEX + branch

- [x] Spec dated 2026-05-19, 8 sections + 8 décisions + 8 risques.
- [x] Branche `swarm/session-23` créée off `f2742a4` master.
- [x] INDEX dated, 4 vagues + 5 phases.
- [ ] Commit spec + INDEX.

**Complexity :** S (~30min). **Suggested executor :** lead.

---

## 4. Wave 1 — Stream A : DB + RPC + tests DB (Phase 1.A)

**Module(s) :** 07-purchasing-suppliers, 06-inventory-stock.
**Migration sub-block :** `20260527000010..023`.
**Executor :** 1 subagent `backend-dev` sonnet, name `stream-a`.

### Sub-phase 1.A.0 — Pre-flight empirical checks (10min)

Avant d'écrire la moindre migration, le subagent DOIT exécuter via MCP `execute_sql` sur `ikcyvlovptebroadgtvd` :

```sql
-- 1) Vérifier signature actuelle record_stock_movement_v1 (params, return type, owner)
SELECT pg_get_function_identity_arguments(oid) AS args, prorettype::regtype, prosecdef, pg_get_userbyid(proowner) AS owner
  FROM pg_proc WHERE proname='record_stock_movement_v1' AND pronamespace='public'::regnamespace;

-- 2) Lister tous les callers internes de record_stock_movement_v1 (RPCs qui pourraient casser)
SELECT proname FROM pg_proc
 WHERE pronamespace='public'::regnamespace
   AND prosrc ILIKE '%record_stock_movement_v1%'
   AND proname != 'record_stock_movement_v1';

-- 3) Vérifier type SQL réel de purchase_order_items.received_quantity (numeric ou int ?)
SELECT data_type, numeric_precision, numeric_scale
  FROM information_schema.columns
 WHERE table_name='purchase_order_items' AND column_name='received_quantity';

-- 4) Check si une table d'idempotency receipt existe déjà
SELECT table_name FROM information_schema.tables
 WHERE table_schema='public' AND table_name ILIKE '%receipt%idempot%';

-- 5) Check movement_type CHECK constraint sur stock_movements (vérifier 'purchase' présent, et si on doit ajouter quelque chose)
SELECT pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conrelid='public.stock_movements'::regclass AND contype='c' AND conname ILIKE '%movement_type%';
```

**Decisions selon résultats :**
- Si `record_stock_movement_v1` a >5 callers RPCs → adapter le drop+recreate pour préserver compatibilité (paramètre `p_skip_wac` en fin de liste avec DEFAULT FALSE garantit rétro-compat positionelle ET nommée).
- Si table idempotency existante → réutiliser ; sinon créer `purchase_order_receipts_idempotency` en migration `_020`.

Rapport synthèse à conserver dans le commit Wave 0 ou inline dans le 1er commit Wave 1.

### Sub-phase 1.A.1 — Migrations DDL (010-013)

**Fichiers :**
- `supabase/migrations/20260527000010_add_landed_cost_columns_to_purchase_orders.sql` (CREATE)
- `supabase/migrations/20260527000011_add_weight_grams_to_products.sql` (CREATE)
- `supabase/migrations/20260527000012_add_landed_cost_columns_to_po_items.sql` (CREATE)
- `supabase/migrations/20260527000013_add_skip_wac_to_stock_movements.sql` (CREATE)

**Steps :**

- [ ] **Step 1** — Apply `_010` via MCP `apply_migration` (project_id `ikcyvlovptebroadgtvd`). SQL : voir spec §4 « DB ».
- [ ] **Step 2** — Apply `_011`.
- [ ] **Step 3** — Apply `_012`.
- [ ] **Step 4** — Apply `_013`.
- [ ] **Step 5** — Smoke check : `SELECT column_name FROM information_schema.columns WHERE table_name IN ('purchase_orders','products','purchase_order_items','stock_movements') AND column_name IN ('shipping_cost','allocation_method','weight_grams','landed_unit_cost','allocation_snapshot','skip_wac');` → expect 6 rows.
- [ ] **Step 6** — Commit (fichiers locaux) : `feat(db): session 23 — phase 1.A.1 — 4 migrations landed cost + skip_wac`.

### Sub-phase 1.A.2 — RPCs NEW + MODIFY

**Fichiers migrations :**
- `supabase/migrations/20260527000020_create_purchase_order_receipts_idempotency_table.sql` (CREATE — si nécessaire selon pre-flight)
- `supabase/migrations/20260527000021_create_receive_po_v1_rpc.sql` (CREATE)
- `supabase/migrations/20260527000022_create_recalculate_po_landed_costs_preview_v1_rpc.sql` (CREATE)
- `supabase/migrations/20260527000023_extend_record_stock_movement_v1_skip_wac.sql` (drop+recreate)
- `supabase/migrations/20260527000024_extend_receive_stock_v1_skip_wac.sql` (drop+recreate)

**Steps :**

- [ ] **Step 1** — Si pre-flight a montré absence de table idempotency : apply `_020` :
  ```sql
  CREATE TABLE purchase_order_receipts_idempotency (
    idempotency_key UUID PRIMARY KEY,
    po_id UUID NOT NULL REFERENCES purchase_orders(id),
    envelope JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX ON purchase_order_receipts_idempotency (po_id);
  REVOKE ALL ON purchase_order_receipts_idempotency FROM authenticated, anon, PUBLIC;
  -- Accessible uniquement via RPC SECURITY DEFINER
  ```

- [ ] **Step 2** — Apply `_021` `receive_po_v1`. Body suit la logique 1-13 du spec §4. Inclure `cost_price_correction` style audit dans `allocation_snapshot`. Test rapide via `execute_sql` après apply.

- [ ] **Step 3** — Apply `_022` `recalculate_po_landed_costs_preview_v1`. SQL pure (LANGUAGE sql), SECURITY DEFINER, permission `inventory.receive`.

- [ ] **Step 4** — Apply `_023` extend `record_stock_movement_v1` :
  - DROP FUNCTION `record_stock_movement_v1(<ancienne signature complète>)` ;
  - CREATE OR REPLACE avec `p_skip_wac BOOLEAN DEFAULT FALSE` en fin ;
  - Branche WAC : `IF NOT p_skip_wac THEN UPDATE products SET cost_price=... ; END IF;`
  - REVOKE/GRANT existants préservés.

- [ ] **Step 5** — Apply `_024` extend `receive_stock_v1` :
  - DROP FUNCTION `receive_stock_v1(<ancienne signature>)` ;
  - CREATE OR REPLACE avec `p_skip_wac BOOLEAN DEFAULT FALSE` en fin ;
  - Propagation à `record_stock_movement_v1(..., p_skip_wac := p_skip_wac)`.

- [ ] **Step 6** — Re-test smoke via MCP : appeler `receive_po_v1` sur un PO test avec 1 ligne, vérifier que envelope est conforme.

- [ ] **Step 7** — Commit : `feat(db): session 23 — phase 1.A.2 — receive_po_v1 + preview + skip_wac propagation`.

### Sub-phase 1.A.3 — Tests pgTAP

**Fichier :** `supabase/tests/landed_cost.test.sql` (CREATE)

**Steps :**

- [ ] **Step 1** — Read `supabase/tests/inventory.test.sql` pour comprendre le pattern de bootstrap pgTAP (fixtures, role switching, plan).
- [ ] **Step 2** — Author 12 cas T1-T12 selon spec §5. Bootstrap : créer supplier + 3 products test (avec UUIDs déterministes pour reproductibilité) + 1 PO confirmed + 3 lines.
- [ ] **Step 3** — Run via MCP `execute_sql` wrap BEGIN/ROLLBACK :
  ```sql
  BEGIN;
    \i supabase/tests/landed_cost.test.sql  -- ou inline du content
  ROLLBACK;
  ```
- [ ] **Step 4** — Expect 12/12 passes. Si fail : itération.
- [ ] **Step 5** — Commit : `test(db): session 23 — phase 1.A.3 — pgTAP landed cost 12 cas`.

### Sub-phase 1.A.4 — Vitest live RPC

**Fichier :** `supabase/tests/functions/receive-po.test.ts` (CREATE)

**Steps :**

- [ ] **Step 1** — Read `supabase/tests/functions/inventory-*.test.ts` pour pattern (bootstrap supplier+products via SQL, supabase-js client, cleanup `afterAll`).
- [ ] **Step 2** — Author 5 scénarios selon spec §5 Vitest live. Variables d'env `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (pour bootstrap admin) + `SUPABASE_ANON_KEY` (pour tester perms si pertinent).
- [ ] **Step 3** — Run : `cd supabase/tests && npx vitest run functions/receive-po` (DEV-S22-1.B-06 reminder : pas dans pnpm workspace).
- [ ] **Step 4** — Vérifier cleanup propre (aucun product/PO test résiduel).
- [ ] **Step 5** — Commit : `test(db,supabase): session 23 — phase 1.A.4 — receive_po_v1 live tests`.

**DoD Stream A :**

- 4 migrations DDL + 4-5 migrations RPC appliquées sur V3 dev cloud
- pgTAP 12/12 passes
- Vitest live 5/5 passes
- 4 commits sur `swarm/session-23`

**Complexity :** M+ (~5-6h). **Dependencies :** Phase 0.1.

---

## 5. Wave 1 — Stream B : Domain helper pure TS (Phase 1.B)

**Module(s) :** `@breakery/domain` package.
**Executor :** 1 subagent `coder` sonnet, name `stream-b`.

### Sub-phase 1.B.1 — `landedCostAllocation.ts` + tests

**Fichiers :**
- `packages/domain/src/inventory/landedCostAllocation.ts` (CREATE)
- `packages/domain/src/inventory/__tests__/landedCostAllocation.test.ts` (CREATE)
- `packages/domain/src/inventory/index.ts` (MODIFY si re-export existe)

**Steps :**

- [ ] **Step 1** — Read `packages/domain/src/inventory/` pour comprendre conventions (pure TS, IO-free, named exports).
- [ ] **Step 2** — Author `landedCostAllocation.ts` selon spec §4 « Domain helper ». Fonction pure :
  ```ts
  export function calculateLandedCostAllocation(
    lines: PoLineForAllocation[],
    shipping_cost: number,
    method: AllocationMethod
  ): AllocationResult[]
  ```
  Logique :
  - Si `method === 'by_weight'` et au moins 1 ligne a `product_weight_grams === null` → fallback method = 'by_value' pour TOUTES les lignes, set `fallback_reason='no_weight_on_N_lines'`.
  - Calcul des metrics : value=`qty*unit_cost`, weight=`qty*weight_grams`, quantity=`qty`.
  - share = `metric_i / sum(metrics)`. Si sum=0 → toutes shares = 1/N (degenerate case).
  - landed = `unit_cost + (shipping_share / qty)`.

- [ ] **Step 3** — Author 8-10 cas tests Vitest co-localisés. Couvrir :
  - Happy path by_value 3 lignes égales
  - Happy path by_weight 3 lignes diff weights
  - Happy path by_quantity 3 lignes
  - Fallback : tous weight NULL
  - Fallback : 1 weight NULL
  - shipping_cost=0 → landed = base
  - 1 seule ligne → share=1
  - Degenerate : sum metrics=0 (qty=0 partout) → distribute égalitaire

- [ ] **Step 4** — Run : `pnpm --filter @breakery/domain test landed-cost`. Expect 8-10/10 green.

- [ ] **Step 5** — Re-export depuis `packages/domain/src/inventory/index.ts` si pattern barrel utilisé.

- [ ] **Step 6** — Commit : `feat(domain): session 23 — phase 1.B.1 — landed cost allocation pure helper + tests`.

**DoD Stream B :**

- 1 fichier helper + tests verts (8-10/10)
- 1 commit sur `swarm/session-23`

**Complexity :** S (~1h). **Dependencies :** Phase 0.1.

---

## 6. Wave 2 — UI BO (Phase 2.A)

**Module(s) :** 07-purchasing-suppliers (BO), 05-products-categories (form extension).
**Executor :** 1 subagent `coder` sonnet, name `stream-ui`, **après** sync Wave 1.

### Sub-phase 2.A.1 — Types regen post-Wave 1

**Fichier :** `packages/supabase/src/types.generated.ts` (MODIFY via MCP)

- [ ] **Step 1** — Regen via MCP `generate_typescript_types(project_id='ikcyvlovptebroadgtvd')`.
- [ ] **Step 2** — Write result dans `packages/supabase/src/types.generated.ts`.
- [ ] **Step 3** — `pnpm typecheck` global : doit passer (changement de types peut révéler usages cassés ailleurs).
- [ ] **Step 4** — Commit : `chore(types): session 23 — phase 2.A.1 — regen post landed cost migrations`.

### Sub-phase 2.A.2 — `ReceivePoPage` + composants

**Fichiers :**
- `apps/backoffice/src/features/purchasing/ReceivePoPage.tsx` (CREATE)
- `apps/backoffice/src/features/purchasing/components/ShippingAllocationControls.tsx` (CREATE)
- `apps/backoffice/src/features/purchasing/components/ReceivePoLineCard.tsx` (CREATE)
- `apps/backoffice/src/features/purchasing/components/AllocationPreviewModal.tsx` (CREATE)
- `apps/backoffice/src/features/purchasing/hooks/useReceivePo.ts` (CREATE)
- `apps/backoffice/src/App.tsx` (MODIFY : ajout route `/purchasing/pos/:po_id/receive`)
- `apps/backoffice/src/i18n/fr.json` (MODIFY : ~25 strings ajoutées)

**Steps :**

- [ ] **Step 1** — Read pages purchasing existantes (`PurchaseOrderDetailPage.tsx`, `PurchaseOrderForm.tsx`) pour pattern.
- [ ] **Step 2** — Read `packages/ui/src/components/CenterModal.tsx` pour API du modal (S22 lock-in).
- [ ] **Step 3** — Author `useReceivePo.ts` hook : `useQuery` PO+items+products (1 select join), `useQuery` preview RPC (refetch on shipping_cost/method change), `useMutation` `receive_po_v1` (invalidate `po-detail`, `inventory-*`).
- [ ] **Step 4** — Author 3 composants enfants.
- [ ] **Step 5** — Author `ReceivePoPage.tsx` qui orchestre. Permission gate via `usePermissions().has('inventory.receive')`.
- [ ] **Step 6** — Wire route dans `App.tsx`.
- [ ] **Step 7** — Modify `PurchaseOrderDetailPage.tsx` : bouton "Receive" déjà existant → wire vers nouvelle route via `useNavigate`.
- [ ] **Step 8** — i18n : ajouter strings clés sous `purchasing.receive.*`, `purchasing.po.shipping.*`. Vérifier qu'aucune string en dur n'est restée.
- [ ] **Step 9** — Run : `pnpm --filter @breakery/backoffice dev` puis navigation manuelle pour smoke visuel.
- [ ] **Step 10** — Commit : `feat(backoffice): session 23 — phase 2.A.2 — ReceivePoPage + landed cost UI`.

### Sub-phase 2.A.3 — MODIFY ProductFormDrawer + PurchaseOrderForm + PurchaseOrderDetailPage

**Fichiers :**
- `apps/backoffice/src/features/products/ProductFormDrawer.tsx` (MODIFY)
- `apps/backoffice/src/features/purchasing/PurchaseOrderForm.tsx` (MODIFY)
- `apps/backoffice/src/features/purchasing/PurchaseOrderDetailPage.tsx` (MODIFY)

**Steps :**

- [ ] **Step 1** — `ProductFormDrawer` : ajout input `weight_grams` (number, nullable, suffix "g"). Section "Inventaire", à côté de `unit`. i18n string.
- [ ] **Step 2** — `PurchaseOrderForm` : ajout section "Frais de port" (shipping_cost input + allocation_method select). Warning inline si method=by_weight et lignes avec product weight NULL. i18n.
- [ ] **Step 3** — `PurchaseOrderDetailPage` : ajout colonne "Landed cost" dans table lignes (display `landed_unit_cost` ou "—" avec tooltip).
- [ ] **Step 4** — Run typecheck + dev visual smoke.
- [ ] **Step 5** — Commit : `feat(backoffice): session 23 — phase 2.A.3 — product weight + PO shipping form extensions`.

### Sub-phase 2.A.4 — BO smoke tests

**Fichier :** `apps/backoffice/src/features/purchasing/__tests__/receive-po-page.smoke.test.tsx` (CREATE)

**Steps :**

- [ ] **Step 1** — Read `apps/backoffice/src/__tests__/btob-dashboard.smoke.test.tsx` pour pattern (QueryClient mock, router mock).
- [ ] **Step 2** — Author 4 cas selon spec §5 BO smoke.
- [ ] **Step 3** — Run : `pnpm --filter @breakery/backoffice test receive-po-page`.
- [ ] **Step 4** — Commit : `test(backoffice): session 23 — phase 2.A.4 — receive po page smoke`.

**DoD Wave 2 :**

- 5 fichiers nouveaux + 4 fichiers modifiés
- BO smoke green
- UI manuel navigable (dev server)
- 4 commits sur `swarm/session-23`

**Complexity :** M+ (~5h). **Dependencies :** Wave 1 streams A+B DONE.

---

## 7. Wave 3 — Closeout (Phase 3.A)

**Fichiers :**
- `packages/supabase/src/types.generated.ts` (vérif re-regen si Wave 2 a modifié)
- `docs/workplan/backlog-by-module/07-purchasing-suppliers.md` (MODIFY)
- `docs/workplan/backlog-by-module/06-inventory-stock.md` (MODIFY)
- `docs/workplan/backlog-by-module/00-roadmap-globale.md` (MODIFY)
- `docs/workplan/plans/2026-05-19-session-23-INDEX.md` (MODIFY — fill §10)
- `CLAUDE.md` (MODIFY — bump current session pointer)

**Steps :**

- [ ] **Step 1** — Final quality gates : `pnpm typecheck && pnpm build && pnpm exec turbo run test --concurrency=1`.
- [ ] **Step 2** — Re-regen types si Wave 2 a touché des RPCs (improbable mais sécurité).
- [ ] **Step 3** — Status notes :
  - `07-purchasing-suppliers.md` TASK-07-012 : ajouter `**Status note (2026-05-19)** : S23 update — TASK-07-012 [DONE]. Landed cost shipping pro-rata complet : `purchase_orders.shipping_cost` + `allocation_method` (by_value/by_weight/by_quantity) + `products.weight_grams` + `purchase_order_items.landed_unit_cost` figé au 1er receipt + RPC `receive_po_v1` agrège multi-lignes avec snapshot allocation + UI `ReceivePoPage`. **Out of scope (decision utilisateur 2026-05-19) :** toggle douane/assurance (à demander si besoin réel), option `apply_retroactively` (incohérence comptable).`
  - `06-inventory-stock.md` : ajouter Status note S23 sur skip_wac (DEV-S17-1.C-01 closed) : `**Status note (2026-05-19)** : S23 update — DEV-S17-1.C-01 closed. Sample/promo opt-out via `record_stock_movement_v1.p_skip_wac BOOLEAN DEFAULT FALSE` + `stock_movements.skip_wac` colonne audit. Stock entre normalement mais `products.cost_price` non recalculé. Propagation à `receive_stock_v1` pour usage ad-hoc hors PO.`
- [ ] **Step 4** — Roadmap globale :
  - §Sessions complétées : ajouter ligne S23 (date, branch, thème, commits, migrations count)
  - §Indicateurs : ajouter 3 lignes :
    - `Landed cost shipping pro-rata | enabled | DONE S23 (3 méthodes : by_value/by_weight/by_quantity, skip douane/assurance)`
    - `Sample/promo skip WAC | enabled | DONE S23 (flag p_skip_wac sur record_stock_movement_v1 + receive_stock_v1)`
    - `Product weight_grams field | available | DONE S23 (NULL-tolerant, fallback by_value)`
  - §Actifs : strike item #7 (TASK-07-012)
- [ ] **Step 5** — CLAUDE.md `## Active Workplan` : bump current session pointer vers S23 (similar pattern aux closeouts précédents), garder S22 en "Previous session".
- [ ] **Step 6** — Fill INDEX §10 deviations (post-execution).
- [ ] **Step 7** — Final commit closeout + push :
  ```bash
  git push -u origin swarm/session-23
  gh pr create --title "session 23 — landed cost (shipping pro-rata) + sample/promo opt-out" --body "$(cat <<'EOF'
  ## Summary

  Closes **TASK-07-012** (landed cost shipping pro-rata) + **DEV-S17-1.C-01** (sample/promo opt-out) in one session.

  **DB :**
  - 4 DDL migrations (`20260527000010..013`) : `purchase_orders.shipping_cost` + `allocation_method` ; `products.weight_grams` NULLABLE ; `purchase_order_items.landed_unit_cost` + `allocation_snapshot` ; `stock_movements.skip_wac`.
  - 4-5 RPC migrations (`20260527000020..024`) : `receive_po_v1` (NEW, agrège receipt multi-lignes), `recalculate_po_landed_costs_preview_v1` (NEW, pure read UI preview), `record_stock_movement_v1` (MODIFY +p_skip_wac), `receive_stock_v1` (MODIFY +p_skip_wac propagation).

  **Domain :**
  - `packages/domain/src/inventory/landedCostAllocation.ts` pure-TS helper (mirrors SQL allocation logic) + 8-10 unit tests.

  **UI BO :**
  - NEW `ReceivePoPage` (`/purchasing/pos/:po_id/receive`) + 3 composants + hook `useReceivePo`.
  - MODIFY `ProductFormDrawer` (+weight_grams), `PurchaseOrderForm` (+shipping_cost +allocation_method), `PurchaseOrderDetailPage` (+landed_cost column).
  - i18n fr.json ~25 strings.

  **Tests :**
  - pgTAP `landed_cost.test.sql` 12 cas (allocation methods, partial receipts, fallback, skip_wac, idempotency, perms).
  - Vitest live `receive-po.test.ts` 5 scénarios.
  - Domain unit 8-10 cas.
  - BO smoke 4 cas.

  **Out of scope (décision utilisateur 2026-05-19) :** toggle douane/assurance, DEV-S17-1.C-02 (stale current_stock guard), retroactive cost adjustment.

  ## Test plan
  - [ ] pgTAP `landed_cost.test.sql` 12/12 via cloud MCP.
  - [ ] Vitest live `cd supabase/tests && npx vitest run functions/receive-po`.
  - [ ] `pnpm --filter @breakery/domain test landed-cost` 8-10/10.
  - [ ] `pnpm --filter @breakery/backoffice test receive-po-page` green.
  - [ ] `pnpm typecheck && pnpm build && pnpm test --concurrency=1` green.
  - [ ] Manual UI : create PO with shipping_cost, confirm, receive partial 50%, vérifier landed_unit_cost figé + cost_price product augmenté via WAC.

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```

**Complexity :** M (~1.5h). **Dependencies :** Wave 2 DONE.

---

## 8. Parallelization map

| Wave | Phases | Parallel streams | Estim h wall-time |
|------|--------|------------------|-------------------|
| 0 | 0.1 | sequential | 0.5 |
| 1 | 1.A, 1.B | 2 parallel (subagent fan-out) | max(5-6, 1) = 5-6 |
| 2 | 2.A.1 → 2.A.2 → 2.A.3 → 2.A.4 | sequential (4 sub-phases) | 5 |
| 3 | 3.A | sequential | 1.5 |
| **TOTAL** | **6 phases** | — | **~12-13h wall-time ; ~13-14h serial** |

---

## 9. Comms entre subagents

```
lead (Claude)
  ├──► stream-a (backend-dev sonnet, run_in_background)
  │     · Pre-flight checks (empirical SQL)
  │     · 4 DDL + 4-5 RPC migrations
  │     · pgTAP 12 cas
  │     · Vitest live 5 scénarios
  │
  └──► stream-b (coder sonnet, run_in_background)
        · landedCostAllocation.ts + 8-10 tests

After both stream subagents complete + commit, lead :
  └──► stream-ui (coder sonnet)
        · Types regen
        · ReceivePoPage + composants + hook
        · Form extensions
        · BO smoke tests

After stream-ui complete + commit, lead :
  └──► closeout serial
        · Quality gates
        · Status notes + roadmap
        · INDEX §10
        · PR
```

---

## 10. Deviation packs (Session 23 → Session 24+)

*Finalized post-execution Phase 3.A. Format `DEV-S23-1.A-NN` / `DEV-S23-1.B-NN` / `DEV-S23-2.A-NN` / `DEV-S23-3.A-NN`. All informational unless marked otherwise.*

*(À remplir après exécution.)*

---

## 11. Out of scope (déféré Session 24+)

- DEV-S17-1.C-02 (stale current_stock guard sur WAC) — non priorisé S23
- Toggle douane/assurance dans PO + UI — exclu explicitement par décision utilisateur 2026-05-19
- TASK-07-013 (avoir comptable auto sur retour post-paiement)
- TASK-07-011 (multi-currency PO, dépend TASK-10-019)
- Option `apply_retroactively` mentionnée TASK-07-012 critère — écartée (incohérence comptable)
- Sweep complet des 25 EFs Retry-After (DEV-S22-1.B-07)
- Rotate birthday-cron secret to vault.secrets (DEV-S21-1.A.1-04)
- 5 NICE-TO-HAVE de S22 §10 informational items
- Mobile shell Capacitor (TASK-18-***)
- Compliance fiscale I1/I2/I3 — bloquée statut PKP
