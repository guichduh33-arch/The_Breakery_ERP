# Session 23 — Spec : Landed cost (shipping pro-rata) + sample/promo opt-out

**Date :** 2026-05-19
**Branch :** `swarm/session-23` (off `f2742a4` master post-S22 squash-merge PR #26)
**Source de la décision :** brainstorming utilisateur 2026-05-19 — option « WAC landed cost (TASK-07-012) » avec scope complet 3 méthodes, **sans toggle douane/assurance**, + bonus DEV-S17-1.C-01 (sample/promo opt-out).
**INDEX :** [`../plans/2026-05-19-session-23-INDEX.md`](../plans/2026-05-19-session-23-INDEX.md)
**Migration block réservé :** `20260527000010..099` (post-S22 block `20260526000010..014`).

---

## 1. Goal

Fermer le gap métier identifié dans la roadmap globale §Actifs ligne #7 :

> **TASK-07-012 — Landed cost (répartition frais de port pro-rata)** — partial S17, complet S23.

Concrètement :

1. Permettre la saisie de frais de port sur un PO (`shipping_cost`) et le choix d'une méthode d'allocation (`by_value` | `by_weight` | `by_quantity`).
2. À la réception, répartir automatiquement le `shipping_cost` sur les lignes selon la méthode → calculer un `landed_unit_cost` par ligne = `unit_cost + shipping_share / qty_ordered`.
3. Alimenter `record_stock_movement_v1` avec ce `landed_unit_cost` → WAC met à jour `products.cost_price` avec le vrai coût de revient (inclut le port).
4. Fermer DEV-S17-1.C-01 (opt-out WAC pour samples/promos) via flag `skip_wac` sur les mouvements.

**Hors scope (out-of-scope explicite) :**

- Toggle douane/assurance (exclu par décision utilisateur — `shipping_cost` est l'unique canal de frais réparti).
- DEV-S17-1.C-02 (guard sur `current_stock` périmé dans WAC) — non demandé.
- Cancel/reverse PO receipt — TASK-07-013 reste deferred.
- Multi-currency PO (TASK-07-011) — dépend de TASK-10-019.
- Recalcul rétroactif des coûts historiques (option `apply_retroactively` mentionnée dans le critère d'acceptation TASK-07-012 → écarté ici, pratique non standard et risque d'incohérence comptable).

---

## 2. Décisions clés (D1-D8)

| ID | Décision | Rationale |
|----|----------|-----------|
| **D1** | `shipping_cost` est **orthogonal** au `subtotal`/`total_amount`/`vat_amount` du PO. | Évite de modifier les triggers JE comptables existants. Le shipping reste un coût d'inventaire intégré dans `cost_price` via WAC, pas dans la dette fournisseur. Si l'utilisateur paie le shipping au même supplier, c'est une dépense séparée (à traiter par TASK-07-013 futur si besoin). |
| **D2** | `allocation_method` est figé au niveau **PO** (pas par ligne). | UI plus simple, modèle plus simple, conforme à TASK-07-012 critère 1. Un utilisateur ayant des besoins mixtes crée 2 POs séparés. |
| **D3** | `landed_unit_cost` est **figé au 1er receipt** dans `purchase_order_items.landed_unit_cost`. | Math stable sur partial receipts : la 2e/3e réception utilise la même valeur figée. Évite que la dernière ligne reçue absorbe les arrondis. |
| **D4** | Allocation calculée sur la **quantité ordonnée** (`po_items.quantity`), pas sur la qty reçue. | Garantit math stable même en cas de receipt partiel asymétrique. |
| **D5** | Fallback `by_weight` → `by_value` si **au moins 1 product** sans `weight_grams` sur le PO. | Pragmatique : préfère un résultat dégradé clair (avec audit trail dans `allocation_snapshot.fallback_reason`) à un blocage dur. Le warning UI prévient avant validation. |
| **D6** | Nouveau RPC `receive_po_v1` **agrège** les receipts multi-lignes en un seul call. | Atomicité (1 advisory_lock PO), 1 idempotency_key pour toute la session de réception, UI plus simple. `receive_stock_v1` legacy garde son usage ad-hoc (non-PO). |
| **D7** | Flag `skip_wac BOOLEAN DEFAULT FALSE` ajouté à `record_stock_movement_v1` (paramètre + colonne). | Le stock entre normalement, mais `products.cost_price` n'est pas modifié. Audit clair via la colonne. Permet aux samples gratuits / retours promo d'entrer sans polluer le coût. |
| **D8** | Pas de nouvelle permission. `inventory.receive` couvre `receive_po_v1` ; `skip_wac` accessible aux mêmes rôles (managers+) — restriction UI seulement (checkbox cachée si pas manager+, mais RPC accepte). | Pattern S22 conforme : éviter la prolifération de permissions micro-granulaires sans besoin opérationnel. |

---

## 3. Architecture overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Wave 1.A — DB + RPC (Stream A, backend-dev)                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Migrations 010-013 (PO cols + product weight + skip_wac) │   │
│  │ RPC receive_po_v1 (NEW) — agrège receipt multi-lignes    │   │
│  │ RPC recalculate_po_landed_costs_preview_v1 (NEW, pure)   │   │
│  │ RPC record_stock_movement_v1 (MODIFY +p_skip_wac)        │   │
│  │ RPC receive_stock_v1 (MODIFY +p_skip_wac propagation)    │   │
│  │ pgTAP landed_cost.test.sql (12 cas)                      │   │
│  │ Vitest live receive-po.test.ts                           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Wave 1.B — Domain (Stream B, coder, parallèle)                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ packages/domain/src/inventory/landedCostAllocation.ts    │   │
│  │ Tests unitaires (8-10 cas, pure TS, IO-free)             │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│                     ▼ sync gate (Wave 1 DONE)                  │
│                                                                 │
│  Wave 2 — UI BO (1 stream serial, coder)                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ ReceivePoPage (NEW)                                      │   │
│  │ + composants ShippingAllocationControls, ReceivePoLine,  │   │
│  │   AllocationPreviewModal                                 │   │
│  │ ProductFormDrawer (MODIFY : +weight_grams)               │   │
│  │ PurchaseOrderForm (MODIFY : +shipping_cost +method)      │   │
│  │ PurchaseOrderDetailPage (MODIFY : +landed_cost column)   │   │
│  │ Hook useReceivePo                                        │   │
│  │ i18n fr.json (~25 nouvelles strings)                     │   │
│  │ BO smoke tests                                           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Wave 3 — Closeout (lead serial)                                │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ pnpm typecheck && build && test                          │   │
│  │ Types regen (MCP)                                        │   │
│  │ Status notes : 07-purchasing TASK-07-012 DONE            │   │
│  │                06-inventory DEV-S17-1.C-01 closed        │   │
│  │ Roadmap globale §Sessions + Indicateurs (3 lignes)       │   │
│  │ INDEX §10 deviations                                     │   │
│  │ Commit + push + PR                                       │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Deliverables

### DB (4 migrations, block `20260527000010..013`)

| # | Migration | Effet |
|---|-----------|-------|
| 010 | `add_landed_cost_columns_to_purchase_orders.sql` | `purchase_orders.shipping_cost NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK >=0` + `allocation_method TEXT NOT NULL DEFAULT 'by_value' CHECK IN (by_value, by_weight, by_quantity)` + COMMENT |
| 011 | `add_weight_grams_to_products.sql` | `products.weight_grams NUMERIC(10,2) NULL CHECK (NULL OR >0)` + COMMENT |
| 012 | `add_landed_cost_columns_to_po_items.sql` | `purchase_order_items.landed_unit_cost NUMERIC(14,4) NULL` + `allocation_snapshot JSONB NULL` + COMMENT |
| 013 | `add_skip_wac_to_stock_movements.sql` | `stock_movements.skip_wac BOOLEAN NOT NULL DEFAULT FALSE` + COMMENT |

### RPCs (2 NEW, 2 MODIFY)

**RPC `receive_po_v1` (NEW)** — fichier `20260527000021_create_receive_po_v1_rpc.sql` (précédé éventuellement de `_020_create_purchase_order_receipts_idempotency_table.sql` selon résultat du pre-flight check Phase 1.A.0)

Signature :
```sql
receive_po_v1(
  p_po_id            UUID,
  p_lines            JSONB,           -- [{"po_item_id":"uuid","received_qty":12.5}, ...]
  p_shipping_override NUMERIC(14,2)  DEFAULT NULL,
  p_idempotency_key  UUID            DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
```

Returns envelope :
```json
{
  "ok": true,
  "po_id": "uuid",
  "movements": [
    {
      "po_item_id": "uuid",
      "product_id": "uuid",
      "movement_id": "uuid",
      "received_qty": 12.5,
      "landed_unit_cost": 12875.0,
      "allocation_snapshot": { "method": "by_value", "shipping_total": 50000, "line_share": 0.333, "fallback_reason": null }
    }
  ],
  "total_received_value": 312500,
  "po_status": "partial"
}
```

Body :
1. `has_permission(auth.uid(), 'inventory.receive')` ; raise `forbidden` ERRCODE='P0003' sinon
2. Idempotency replay : check `purchase_order_receipts_idempotency` (table existing pattern S22 ou table dédiée à créer si absent — vérifier en Step 1 de phase 1.A)
3. `SELECT ... FOR UPDATE` sur `purchase_orders` WHERE id=p_po_id AND status IN ('confirmed','partial')
4. Load PO + lines + products (joint `weight_grams`)
5. Snapshot calcul : pour chaque ligne demandée, si `landed_unit_cost IS NULL` calcule maintenant ; sinon réutilise
6. Pour la méthode `by_weight` : check si tous products du PO ont `weight_grams` set ; si pas → fallback `by_value` global pour ce PO + `allocation_snapshot.fallback_reason='no_weight_on_<n>_lines'`
7. `share = line_metric / sum(line_metrics)` (metric = `quantity * unit_cost` pour by_value, `quantity * weight_grams` pour by_weight, `quantity` pour by_quantity)
8. `shipping_share = COALESCE(p_shipping_override, po.shipping_cost) * share`
9. `landed_unit_cost = po_item.unit_cost + (shipping_share / po_item.quantity)`
10. UPDATE `purchase_order_items` SET landed_unit_cost, allocation_snapshot (1er passage uniquement), received_quantity += received_qty
11. Call `record_stock_movement_v1(product, 'purchase', received_qty, unit_cost=landed_unit_cost, supplier_id=po.supplier_id, ...)` par ligne
12. UPDATE `purchase_orders` SET status = (CASE sum(received_qty)>=sum(quantity) WHEN true THEN 'received' ELSE 'partial' END), received_date = now() si full, received_by = auth.uid()
13. Store envelope + RETURN

`REVOKE EXECUTE FROM PUBLIC ; GRANT EXECUTE TO authenticated`

**RPC `recalculate_po_landed_costs_preview_v1` (NEW)** — fichier `20260527000022_create_recalculate_po_landed_costs_preview_v1_rpc.sql`

Signature :
```sql
recalculate_po_landed_costs_preview_v1(p_po_id UUID) RETURNS JSONB
LANGUAGE sql SECURITY DEFINER SET search_path = public
```

**Pure read** (SQL function, pas d'UPDATE). Returns la même structure qu'allocation_snapshot mais projetée pour TOUTES les lignes (que reçues ou pas). Utilisé par l'UI pour montrer le coût projeté avant le clic Receive.

Permission : `has_permission(..., 'inventory.receive')`. `REVOKE/GRANT` standard.

**RPC `record_stock_movement_v1` (MODIFY)** — fichier `20260527000023_extend_record_stock_movement_v1_skip_wac.sql`

Drop+recreate (convention S15-S17 versioning monotonic) avec ajout `p_skip_wac BOOLEAN DEFAULT FALSE` :
- Si TRUE : insert movement avec `skip_wac=TRUE`, skip la branche WAC update sur `products.cost_price` (mais update `current_stock` normalement)
- Si FALSE : comportement existant inchangé

**RPC `receive_stock_v1` (MODIFY)** — fichier `20260527000024_extend_receive_stock_v1_skip_wac.sql`

Ajout `p_skip_wac BOOLEAN DEFAULT FALSE` propagé à `record_stock_movement_v1`. Utile pour receipts ad-hoc hors-PO (samples).

### Domain helper (1 fichier + tests)

`packages/domain/src/inventory/landedCostAllocation.ts` — fonction pure :

```ts
export type AllocationMethod = 'by_value' | 'by_weight' | 'by_quantity';
export interface PoLineForAllocation {
  po_item_id: string;
  quantity: number;
  unit_cost: number;
  product_weight_grams: number | null;
}
export interface AllocationResult {
  po_item_id: string;
  base_unit_cost: number;
  landed_unit_cost: number;
  allocation_share: number;
  shipping_share: number;
  method_used: AllocationMethod;          // 'by_value' si fallback
  fallback_reason: string | null;
}

export function calculateLandedCostAllocation(
  lines: PoLineForAllocation[],
  shipping_cost: number,
  method: AllocationMethod
): AllocationResult[]
```

Tests unitaires `__tests__/landedCostAllocation.test.ts` — 8-10 cas (cf §5 Tests).

### UI (1 page NEW, 3 pages MODIFY, 1 hook)

**ReceivePoPage (NEW)** — `apps/backoffice/src/features/purchasing/ReceivePoPage.tsx`

Route `/purchasing/pos/:po_id/receive`, gated par permission `inventory.receive`.

Composants enfants (tous co-localisés dans `apps/backoffice/src/features/purchasing/components/`) :
- `ShippingAllocationControls` — inputs `shipping_cost` (display read-only depuis PO) + `allocation_method` (display) + override input
- `ReceivePoLineCard` — par ligne : qty input (default = `quantity - received_quantity`) + preview landed cost + skip_wac checkbox (gated par role manager+)
- `AllocationPreviewModal` — déclenché par bouton "Preview allocation" : appelle `recalculate_po_landed_costs_preview_v1` et affiche tableau allocation_share + fallback_reason. Réutilise `CenterModal` du design system.

Hook `useReceivePo(poId)` :
- `useQuery(['po-receive', poId])` → load PO + items + product weights via select join
- `useQuery(['po-landed-preview', poId])` → call preview RPC (refetch on input change)
- `useMutation(receive_po_v1)` → invalidate `po-detail` + `inventory-*` queries on success

**ProductFormDrawer (MODIFY)** — `apps/backoffice/src/features/products/ProductFormDrawer.tsx`

Ajout champ `weight_grams` (number input, NULLABLE, suffix "g", placeholder "Non applicable", helper text "Pour calcul landed cost by_weight"). Position : section "Inventaire" à côté de `unit`.

**PurchaseOrderForm (MODIFY)** — `apps/backoffice/src/features/purchasing/PurchaseOrderForm.tsx`

Ajout section "Frais de port" : input `shipping_cost` (number, default 0) + select `allocation_method` (by_value / by_weight / by_quantity, default by_value) + helper text "Réparti automatiquement sur les lignes au receipt" + warning inline si method=`by_weight` et au moins 1 product sans `weight_grams` ("X produits sans poids → fallback par valeur").

**PurchaseOrderDetailPage (MODIFY mineur)** — `apps/backoffice/src/features/purchasing/PurchaseOrderDetailPage.tsx`

Ajout colonne "Landed cost" dans le tableau des lignes (affiche `landed_unit_cost` si set, sinon "—" avec tooltip "À calculer au receipt").

**i18n** — `apps/backoffice/src/i18n/fr.json` — ~25 nouvelles strings sous clés `purchasing.receive.*`, `purchasing.po.shipping.*`, `products.form.weight_grams.*`.

---

## 5. Tests

### pgTAP DB — `supabase/tests/landed_cost.test.sql` (12 cas T1-T12)

| # | Cas | Assert principal |
|---|---|---|
| T1 | `by_value` sur 3 lignes égales (qty=10, unit_cost=100 each), shipping=300 | chaque ligne reçoit share=1/3 → landed=110 |
| T2 | `by_weight` avec products weight=100g/50g/250g | shares pondérés selon `qty*weight` |
| T3 | `by_weight` avec 1 product weight NULL | fallback `by_value` global, snapshot.fallback_reason='no_weight_on_1_lines' |
| T4 | `by_quantity` lignes qty=10,20,30 | shares = 10/60, 20/60, 30/60 |
| T5 | Partial receipt (50% qty puis 50% restant) | landed_unit_cost figé au 1er call, identique au 2e call |
| T6 | shipping_override > po.shipping_cost | override utilisé, snapshot.shipping_total reflète |
| T7 | Idempotency replay (même p_idempotency_key) | 2e call return envelope identique, pas de double-movement, received_quantity inchangé |
| T8 | `skip_wac=TRUE` via record_stock_movement_v1 direct | movement inséré avec skip_wac=true, current_stock+=qty, products.cost_price INCHANGÉ |
| T9 | Permission denied (anon) | RAISE `forbidden` ERRCODE='P0003' |
| T10 | Status auto : received<ordered → 'partial' ; received=ordered → 'received' | UPDATE testé |
| T11 | shipping_cost=0 | landed_unit_cost = unit_cost (pas de modif) |
| T12 | Allocation snapshot stocké JSONB lisible | `allocation_snapshot->>'method'` = 'by_value' |

### Vitest live RPC — `supabase/tests/functions/receive-po.test.ts`

Bootstrap : crée supplier + 3 products (2 avec weight, 1 sans) + 1 PO confirmed avec 3 lignes. Cleanup en `afterAll`.

Tests :
1. Happy path full receipt by_value → vérif WAC met à jour `cost_price` sur les 3 products (sélecte post-receipt)
2. Partial receipt 50% → vérif `landed_unit_cost` figé, 2e receipt utilise même valeur (pas de double-allocation)
3. Method `by_weight` avec 1 NULL → vérif fallback by_value enregistré dans snapshot, RPC ne lève pas
4. Idempotency : appel x2 avec même key → mêmes movements, pas de double
5. `receive_stock_v1` ad-hoc (non-PO) avec `p_skip_wac=true` → stock+1, cost_price inchangé

### Domain unit — `packages/domain/src/inventory/__tests__/landedCostAllocation.test.ts`

8-10 cas pure-TS :
- Happy path by_value (3 lignes égales)
- Happy path by_weight (3 lignes diff weights)
- Happy path by_quantity
- Fallback by_value si tous weight NULL
- Fallback by_value si 1 weight NULL
- shipping_cost=0 → landed = base
- 1 seule ligne → share=1 → landed = base + shipping/qty
- Lignes avec qty fractionnaires (decimal)

### BO smoke — `apps/backoffice/src/features/purchasing/__tests__/receive-po-page.smoke.test.tsx`

Mount `ReceivePoPage` avec QueryClient mock + react-router mock. Cas :
1. Render initial : PO header + 3 lignes affichées + boutons disabled (qty=0)
2. Changer qty + click "Preview allocation" → modal s'ouvre avec table d'allocation
3. Click "Confirm receipt" → mutation appelée avec payload {p_po_id, p_lines: [...]}
4. Toast success + redirect mock vérifié

---

## 6. Risks & mitigations

| Risque | Sévérité | Mitigation |
|--------|----------|------------|
| R1 — `record_stock_movement_v1` est appelé par d'autres RPCs (`adjust_stock_v1`, `waste_stock_v1`, etc.) — modifier sa signature peut casser des callers | high | Ajout `p_skip_wac DEFAULT FALSE` — rétro-compat garantie. Mais drop+recreate doit lister tous les sites caller pour audit (Step 1 de phase 1.A). Vérifier via `grep "record_stock_movement_v1" supabase/migrations/`. |
| R2 — `purchase_orders.idempotency_key` existe déjà au niveau PO (création), réutiliser ce champ peut collisionner avec idempotency receipt | medium | Créer table dédiée `purchase_order_receipts_idempotency(idempotency_key UUID PRIMARY KEY, po_id, lines_jsonb, envelope_jsonb, created_at)` OU utiliser le pattern S22 `record_rate_limit_v1` qui stocke directement dans le payload. Décision à finaliser en phase 1.A Step 1 après check schema. |
| R3 — UI race : 2 managers ouvrent `ReceivePoPage` simultanément | medium | `SELECT ... FOR UPDATE` dans `receive_po_v1` sérialise. Le 2e voit la version mise à jour au refresh post-mutation. Pas besoin de pessimistic lock UI. |
| R4 — `landed_unit_cost` figé au 1er receipt = si l'utilisateur s'aperçoit après coup d'une erreur shipping, pas de recalcul | low | Documenté D3. Workaround : utiliser `update_cost_price_v1` (S22) pour correction manuelle. Acceptable car partial receipt = math stable. |
| R5 — by_weight avec products mixed (certains weight set, d'autres NULL) → comportement surprenant | medium | UI warning explicite avant validation. RPC log `fallback_reason` détaillé. Test T3 couvre. |
| R6 — Migration order critique : `_011 products.weight_grams` doit précéder `_020 receive_po_v1` qui le SELECT | low | Numérotation séquentielle 010-013 (DDL) → 020-023 (RPCs). Respecté dans le plan. |
| R7 — Types regen post-migration oublié → CI cassée | medium | Wave 3 Phase 3.A step explicite. Convention CLAUDE.md respectée. |
| R8 — `received_quantity` actuellement int dans `purchase_order_items` ? À vérifier | low | Type generated.ts ligne 2915 : `received_quantity: number` (numeric). OK. Mais vérifier le type SQL réel pour décimaux (0.5kg). |

---

## 7. Acceptance criteria (DoD)

- [ ] 4 migrations appliquées sur V3 dev cloud `ikcyvlovptebroadgtvd` via MCP `apply_migration`
- [ ] 2 RPCs nouveaux créés + 2 RPCs modifiés (avec drop+recreate clean)
- [ ] pgTAP `landed_cost.test.sql` 12/12 green via MCP `execute_sql` BEGIN/ROLLBACK
- [ ] Vitest live `receive-po.test.ts` green (cleanup en afterAll vérifié)
- [ ] Domain unit `landedCostAllocation.test.ts` 8-10 cas green
- [ ] BO smoke `receive-po-page.smoke.test.tsx` green
- [ ] `pnpm typecheck && pnpm build && pnpm test --concurrency=1` green
- [ ] Types regen via MCP committed dans `packages/supabase/src/types.generated.ts`
- [ ] 1 page BO NEW + 3 pages MODIFY accessibles via UI manuelle
- [ ] i18n fr.json complet (pas de string en dur)
- [ ] Status notes :
  - `07-purchasing-suppliers.md` TASK-07-012 → `[DONE]` avec note S23
  - `06-inventory-stock.md` Status note S23 update sur skip_wac (DEV-S17-1.C-01 closed)
- [ ] Roadmap globale :
  - §Sessions complétées : ligne S23 ajoutée
  - §Indicateurs : 2-3 nouvelles lignes (landed cost enabled, skip_wac enabled, weight_grams field)
  - §Actifs : strike item #7 (TASK-07-012)
- [ ] INDEX §10 deviations rempli
- [ ] PR posté avec test plan et bullets

---

## 8. Out of scope (déféré S24+)

- DEV-S17-1.C-02 (stale current_stock guard sur WAC) — non demandé
- Toggle douane/assurance — exclu explicitement par décision utilisateur 2026-05-19
- Cancel/reverse PO receipt (TASK-07-013) — séparé, dépend de purchase trigger refactor
- Multi-currency PO (TASK-07-011) — dépend TASK-10-019
- Option `apply_retroactively` mentionnée TASK-07-012 critère — écartée (incohérence comptable rétroactive risquée)
- Sweep complet des 25 EFs Retry-After (DEV-S22-1.B-07) — non priorisé S23
- Rotate birthday-cron secret to vault.secrets (DEV-S21-1.A.1-04) — non priorisé S23
- 5 NICE-TO-HAVE de S22 §10 (CI wire eslint-rules, docstring sweep, MarginWatch visual QA, workspace fix supabase/tests) — non priorisés S23
- Mobile shell Capacitor (TASK-18-***) — XL, session dédiée future
- Compliance fiscale I1/I2/I3 — bloquée PKP
