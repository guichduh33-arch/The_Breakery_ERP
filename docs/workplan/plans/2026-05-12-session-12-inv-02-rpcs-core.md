# Session 12 — Phase 2 sub-plan : RPCs core (closing the gap)

> **Date** : 2026-05-13
> **Branche** : `swarm/session-12-phase-2`
> **Parent INDEX** : [`./2026-05-12-session-12-inventory-complete-INDEX.md`](./2026-05-12-session-12-inventory-complete-INDEX.md)
> **Spec source** : [`../specs/2026-05-12-session-12-inventory-complete-spec.md`](../specs/2026-05-12-session-12-inventory-complete-spec.md) §0-2

## Contexte (état au démarrage)

Phase 2 MVP est déjà en prod (commits c9c3fe0…d798704) :

- ✅ RPCs `record_stock_movement_v1`, `adjust_stock_v1`, `receive_stock_v1`, `waste_stock_v1`, `get_stock_levels_v1` + idempotency hotfix + `unit` hotfix + section constraint relax
- ✅ Page `apps/backoffice/src/pages/Inventory.tsx` (Stock list filtrable + 3 modals + history drawer)
- ✅ 7 hooks + 7 composants + 3 tests modaux dans `features/inventory/`
- ✅ Phase 1 foundations (sections, units, enum, perms v8 inventory) + pgTAP T1-T15+

**Gap restant pour boucler Phase 2** = Incoming Stock vertical (RPC manquant + page) + tests T16-T28 pgTAP + 3 Vitest live RPC family.

## Décisions

- **Permission `record_incoming_stock_v1`** : réutilise `inventory.receive` (MANAGER+ déjà whitelisted dans `has_permission` v7). Incoming = réception sans PO formel, conceptuellement même droit que `receive_stock_v1`.
- **Migration #** : prochaine séquence monotonic = `20260516000021`. Vérifier `supabase/migrations/` avant de figer.
- **Movement type** : `'incoming'` (enum extension migration `20260516000014` ; section constraint exemption migration `20260516000020`).
- **Supplier optionnel** : `p_supplier_id UUID DEFAULT NULL` ; si fourni → check actif+non-deleted (même règle que `receive_stock_v1`).
- **Idempotency** : `p_idempotency_key UUID DEFAULT NULL`.
- **Délégation** : `record_incoming_stock_v1` délègue à `record_stock_movement_v1` avec `p_movement_type := 'incoming'` (suit le pattern `receive_stock_v1` migration `20260516000008`).
- **Reason par défaut** : `'Stock receipt'` (sans supplier) ou `'Receipt from <supplier_code>'` (avec supplier).

## Task A — RPC `record_incoming_stock_v1` + pgTAP T16-T20

**Files**
- `supabase/migrations/20260516000021_create_record_incoming_stock_rpc.sql` (CREATE — modèle = `20260516000008_create_receive_stock_rpc.sql`, supplier rendu optionnel)
- `supabase/tests/inventory.test.sql` (APPEND T16-T20)

**RPC signature**
```sql
record_incoming_stock_v1(
  p_product_id      UUID,
  p_quantity        DECIMAL(10,3),
  p_supplier_id     UUID          DEFAULT NULL,
  p_unit_cost       DECIMAL(14,2) DEFAULT NULL,
  p_reason          TEXT          DEFAULT NULL,
  p_idempotency_key UUID          DEFAULT NULL
) RETURNS JSONB
```

**pgTAP T16-T20** (inserter après T15 dans `inventory.test.sql`)
- T16 — cashier role → RPC raises `forbidden` (P0003)
- T17 — manager + qty <= 0 → raises `quantity_must_be_positive`
- T18 — manager + valid (sans supplier) → INSERT `stock_movements` row movement_type=`incoming` + `products.current_stock += qty` + audit row
- T19 — manager + supplier_id pointant un supplier soft-deleted → raises `supplier_not_found_or_inactive`
- T20 — manager + idempotency_key déjà utilisé → JSONB `idempotent_replay=true` + pas de doublon dans `stock_movements`

**Commit** : `feat(db): session 12 — phase 2 — record_incoming_stock_v1 RPC + pgTAP T16-T20`

## Task B — UI Incoming Stock (page + form + hook + route + smoke)

**Files**
- `apps/backoffice/src/features/inventory/hooks/useRecordIncomingStock.ts` (CREATE — modèle = `useReceiveStock.ts`)
- `apps/backoffice/src/features/inventory/components/IncomingStockForm.tsx` (CREATE — réutilise `ProductTypeahead`, `useInventoryReferenceData` pour suppliers)
- `apps/backoffice/src/features/inventory/__tests__/IncomingStockForm.test.tsx` (CREATE)
- `apps/backoffice/src/pages/IncomingStock.tsx` (CREATE)
- `apps/backoffice/src/pages/__tests__/IncomingStock.test.tsx` (CREATE — smoke)
- `apps/backoffice/src/routes/index.tsx` (MODIFY — ajouter `<Route path="inventory/incoming" element={<PermissionGate required="inventory.receive">…} />`)

**UX**
- Form fields : Product (typeahead requis), Quantity (decimal > 0, requis), Supplier (dropdown actives, **optionnel**), Unit cost (decimal ≥ 0, optionnel), Reason (texte, optionnel — placeholder "Stock receipt")
- Submit → `useRecordIncomingStock` → toast success / inline error mapping (`forbidden`, `quantity_must_be_positive`, `supplier_not_found_or_inactive`, `product_not_found`)
- Page : titre "Incoming Stock", description courte, form fields, bouton "Record receipt"
- Permission gate : `inventory.receive`
- **Pas de modification de la sidebar** dans cette task (la sidebar reste flat à 1 entrée Inventory pour Phase 2 ; la restructuration sidebar avec sous-entrées est livrée plus tard quand Phases 3-7 ajoutent les autres onglets — cohérent avec spec §C21).

**Acceptance**
- Manager peut accéder `/backoffice/inventory/incoming` (cashier → redirect `/backoffice`)
- Soumettre sans supplier → OK, row `stock_movements.supplier_id=NULL`
- Soumettre avec supplier valide → OK
- Soumettre supplier inactif → erreur inline `supplier_not_found_or_inactive`
- Soumettre qty 0 → validation client bloque submit
- Smoke test : page se monte, form rendu, submit appelle mutation avec idempotencyKey UUID frais

**Commit** : `feat(backoffice): session 12 — phase 2 — Incoming Stock page + form + hook + route`

## Task C — Vitest live RPC family + pgTAP T21-T28

**Files**
- `supabase/tests/functions/inventory-stock.test.ts` (CREATE)
- `supabase/tests/functions/inventory-incoming.test.ts` (CREATE)
- `supabase/tests/functions/inventory-wastage.test.ts` (CREATE)
- `supabase/tests/inventory.test.sql` (APPEND T21-T28)

**Couverture par fichier Vitest live** (live RPC via service-role client en local supabase)
- `inventory-stock.test.ts` — `adjust_stock_v1` (positive/negative delta, idempotency replay, forbidden MANAGER) + `receive_stock_v1` (supplier valid, supplier_not_found, idempotency)
- `inventory-incoming.test.ts` — `record_incoming_stock_v1` (avec supplier, sans supplier, idempotency, forbidden cashier, qty<=0)
- `inventory-wastage.test.ts` — `waste_stock_v1` (valid waste, insufficient_stock, reason_required, idempotency)

**pgTAP T21-T28** (inserter après T20)
- T21 — `get_stock_levels_v1` paginated `total_count` correct
- T22 — `get_stock_levels_v1` `p_search` filtre SKU + name
- T23 — `get_stock_levels_v1` `p_category_id` filtre
- T24 — `get_stock_levels_v1` `p_low_stock_only` filtre via `min_stock_threshold`
- T25 — `adjust_stock_v1` negative beyond zero → `insufficient_stock` (P0002)
- T26 — `adjust_stock_v1` idempotency replay → même `movement_id` + `idempotent_replay=true`
- T27 — `waste_stock_v1` reason < 3 chars → `reason_required`
- T28 — `waste_stock_v1` qty > current_stock → `insufficient_stock`

**Commit** : `test(db,supabase): session 12 — phase 2 — Vitest live RPC + pgTAP T21-T28`

## Verification (one-shot avant merge)

```bash
pnpm db:reset && pnpm db:types
pnpm test:pgtap
pnpm --filter @breakery/supabase test inventory
pnpm --filter @breakery/backoffice test inventory
pnpm typecheck && pnpm lint && pnpm build
```

## Phase 2 closing gate

- ✅ `record_incoming_stock_v1` appliquée + pgTAP T16-T20 verts
- ✅ `/backoffice/inventory/incoming` accessible (manager) + smoke vert
- ✅ 3 Vitest live RPC family verts
- ✅ pgTAP T16-T28 (13 nouveaux tests) tous verts
- ✅ `types.generated.ts` régénéré + commit
- ✅ `pnpm typecheck && pnpm lint && pnpm build` clean
- ✅ Aucun mouvement `stock_movements` inséré en raw (toujours via RPCs)
