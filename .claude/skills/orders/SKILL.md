---
name: orders
description: >-
  Orders domain expert — order lifecycle, list v2 server-filters, edit-items RPCs,
  void/refund, realtime. Cross-app business logic (POS writes + BO management); distinct
  from pos-specialist (POS UI surface) and backoffice-specialist (BO UI surface). Use this
  skill whenever the task mentions order(s) / commande(s), statut de commande, void /
  annulation, refund / remboursement, pending_payment, held order / commande en attente,
  ardoise, complete_order_with_payment, pay_existing_order, fire_counter_order,
  create_tablet_order, order items / lignes de commande, totaux de commande, orders
  realtime — or touches apps/backoffice features/orders, POS order-history, or any supabase
  migration/test with order in the name. Invoke it BEFORE editing any order lifecycle RPC
  or status transition, even a small one.
pathPatterns:
  - 'apps/backoffice/src/features/orders/**'
  - 'apps/backoffice/src/pages/**/Order*'
  - 'apps/pos/src/features/order-history/**'
  - 'supabase/migrations/*order*.sql'
  - 'supabase/tests/*order*.test.sql'
  - 'supabase/tests/complete_order_v10_display.test.sql'
promptSignals:
  phrases:
    - 'order list'
    - 'order status'
    - 'edit order item'
    - 'void order'
    - 'order refund'
    - 'pending_payment'
    - 'get_orders_list'
    - 'order totals'
    - 'orders realtime'
    - 'complete_order'
    - 'add_order_item'
    - 'remove_order_item'
---

# Orders — The Breakery ERP

Expert on order business logic across POS (writes) and Backoffice (management). Two use-cases:

1. **Guide** changes to the order lifecycle — new status transitions, edit-items flows, new filters.
2. **Audit** order integrity — status guards, idempotency, realtime consistency, totals recalc.

**`CLAUDE.md` est la source de vérité** pour les patterns projet (RPC versioning, REVOKE pairs, PIN header, idempotency). Ce skill ajoute uniquement la surface map ordres, les noms réels vérifiés, et les checklists préventives spécifiques.

**Anti-overlap boundary :** ce skill couvre la logique métier ordres (RPCs, tables, enums, guards). `pos-specialist` couvre l'UI POS (ProductGrid, CartSidebar, …). `backoffice-specialist` couvre l'UI BO (OrdersListPage, filtres, ExportButtons). Les trois coexistent sans collision.

---

## Mental model — Order lifecycle

```
POS create                          BO management
──────────                          ─────────────
complete_order_with_payment_v10     get_orders_list_v2
 ↓ status: paid                      ↓ cursor-paginé, 11 filtres JSONB
pay_existing_order_v3
 ↓ draft → pending_payment → paid   add/update/remove_order_item_v1
create_tablet_order_v2               ↓ draft | pending_payment uniquement
 ↓ status: draft                     ↓ _recalc_order_totals atomique
create_b2b_order_v1
 ↓ status: b2b_pending              void_order_rpc
                                     ↓ status: voided (manager PIN)
refund_order_rpc_v2
 ↓ INSERT refunds row               useOrdersRealtime
 ↓ PIN header x-manager-pin          ↓ postgres_changes INSERT+UPDATE
 ↓ idempotency header                ↓ StrictMode-safe via useId
```

### order_status enum — valeurs réelles (vérifiées migrations S5/S24 + corrective S33 `_023`)

```
draft | paid | voided | pending_payment | completed | b2b_pending
```

> **PAS de valeur `open`** — le corrective `20260618000023` a corrigé exactement ce bug dans les 3 RPCs edit-items (était `IN ('draft', 'open')`, doit être `IN ('draft', 'pending_payment')`). Ne jamais introduire `'open'`.

### order_type enum (vérifié migration S24)

```
dine_in | take_out | delivery | b2b | tablet
```

### Schema reality (noms de colonnes réels — diffèrent de l'intuition)

| Table | Colonne réelle | Pas |
|-------|---------------|-----|
| `orders` | `total` | `total_amount` |
| `orders` | `served_by` | `created_by` |
| `order_items` | `name_snapshot` | `product_name` |
| `order_items` | `modifiers` (JSONB array) | `modifiers_json` |
| `refunds` | `total` | `amount` |
| `customers` | `name` | `full_name` |

`orders.session_id` est NULL autorisé pour `order_type = 'b2b'` et `created_via = 'tablet'` (CHECK relaxed S24 `_007` + S25 `_014`).

---

## RPCs — noms vérifiés dans `supabase/migrations/`

### Write RPCs (JAMAIS d'INSERT direct — passe toujours par RPC)

| RPC | Fichier migration | Notes |
|-----|------------------|-------|
| `complete_order_with_payment_v10` | `20260530190828` | Double déduction `display_stock` + `current_stock` pour `is_display_item`. Drop v9 in same migration. |
| `pay_existing_order_v3` | `20260507000005` + bumps | `draft → pending_payment → paid` |
| `create_tablet_order_v2(p_client_uuid UUID)` | `20260602000011` | `p_client_uuid` REQUIRED, idempotency via `tablet_order_idempotency_keys`. |
| `refund_order_rpc_v2` | `20260517000014` | PIN via header `x-manager-pin`. `p_idempotency_key` propagé par EF `refund-order` v7. |
| `void_order_rpc` | `20260512000009` | Manager PIN gated (`pos.sale.void`). Émet JE-VOID + stock `sale_void` + reverse loyalty. |
| `create_b2b_order_v1` | `20260601000022` | Gate `validate_b2b_credit_limit_v1`. Status `b2b_pending`. |
| `mark_item_served` | (S5) | KDS/tablet — marque l'item servi. |

### List & edit RPCs (S32/S33)

**`get_orders_list_v2(p_start TEXT, p_end TEXT, p_filters JSONB, p_limit INT, p_cursor TIMESTAMPTZ)`**
(migration `20260618000011`, drops v1 in same file)
- Gate: `orders.read`
- 11 filtres JSONB : `status`, `order_type`, `customer_id`, `served_by`, `total_min`, `total_max`, `customer_type`, `payment_method`, `terminal_id`, `hour` (0-23 Asia/Makassar), `refund_status` (none|partial|full)
- `terminal_id` via JOIN `pos_sessions` → requiert que l'ordre ait un `session_id`
- Computed output : `refund_status`, `has_modifiers`, `payment_method_primary` (ou `'mixed'`), `items_count`, `customer_name`, `served_by_name`, `terminal_id`

**Edit-items (seulement sur `draft` | `pending_payment`) :**

| RPC | Signature | Action clé |
|-----|-----------|-----------|
| `add_order_item_v1` | `(p_order_id, p_product_id, p_qty, p_modifiers, p_idempotency_key)` | `name_snapshot` + `retail_price` (pas `.price`) |
| `update_order_item_qty_v1` | `(p_order_item_id, p_qty, p_idempotency_key)` | qty > 0 (sinon utiliser remove) |
| `remove_order_item_v1` | `(p_order_item_id, p_idempotency_key)` | DELETE + recalc |

Les 3 appellent `_recalc_order_totals(order_id)` (helper interne, non callable directement). Idempotency via table dédiée `order_edit_idempotency_keys` (colonnes: `key UUID PK`, `action TEXT`, `order_id UUID`, `result JSONB`). Chaque RPC a sa propre action string : `'add'`, `'update_qty'`, `'remove'`.

Orchestrateur BO `useEditOrderItems` : séquence `removes → updates → adds` pour éviter les conflits de totaux.

### Permissions (vérifiées migration `20260618000021`)

```
orders.read       — MANAGER / ADMIN / SUPER_ADMIN (S31 _010)
orders.edit_open  — MANAGER / ADMIN / SUPER_ADMIN (S33 _021)
orders.void       — MANAGER / ADMIN / SUPER_ADMIN (S33 _021)
```

---

## Critical patterns (ordres-spécifiques)

1. **Jamais d'INSERT direct dans `orders`** — toujours via RPC. Les RPCs gèrent atomiquement : JE triggers, loyalty, promotions, `display_stock` double-déduction, `table_state`.
2. **Status guard sur edit-items** — `('draft', 'pending_payment')` uniquement. Lever P0002 sinon. Ne pas ajouter `'open'` (valeur inexistante dans l'enum).
3. **`products.retail_price`** (pas `.price`) — vérifié dans le corrective `_023`. Utiliser `retail_price` pour `unit_price` dans les edit-items RPCs.
4. **Idempotency keys propres par RPC** — ne pas partager une même `p_idempotency_key` entre deux appels RPC distincts dans `useEditOrderItems`. Générer un UUID par call.
5. **PIN en header** — `refund_order_rpc_v2` et `void_order_rpc` lisent le PIN via header `x-manager-pin`, jamais dans le body JSON (loggé par PostgREST/pgaudit).
6. **Realtime StrictMode-safe** — `useOrdersRealtime` utilise `useId()` pour nommer le channel ; pas de channel name statique (collisions StrictMode double-mount).
7. **`orders.session_id` nullable** — NULL autorisé pour `b2b` ET `tablet` via 2 CHECK distincts. Ne jamais resserrer à NOT NULL global.
8. **display_stock double-déduction** — `complete_order_with_payment_v10` (v10 seulement) décrémente à la fois `display_stock.quantity` ET `products.current_stock` pour les `is_display_item=true`. Non-display : `current_stock` seulement (comportement v9 inchangé).

---

## Audit checklist

- [ ] **Status transition valide** — seuls les états de l'enum réel sont utilisés. Grep `'open'` dans les nouvelles migrations ordres.
- [ ] **Edit-items guard** — les 3 RPCs vérifient `status IN ('draft', 'pending_payment')` (pas `'open'`).
- [ ] **Totals cohérents** — après chaque edit-item, `orders.total = SUM(order_items.line_total) + tax_amount - discount_amount`. Vérifiable via `_recalc_order_totals`.
- [ ] **Idempotency replay** — même `p_idempotency_key` + même `action` retourne le `result` JSONB stocké sans mutation.
- [ ] **`order_edit_idempotency_keys` isolé** — pas de GRANT EXECUTE exposant cette table à `anon` ou `authenticated` hors des RPCs SECURITY DEFINER.
- [ ] **Refund integrity** — `SUM(refunds.total) <= orders.total` pour un même order_id. `refund_status` computed par `get_orders_list_v2` en découle.
- [ ] **REVOKE pair complet** — chaque nouveau RPC ordres a les 3 lignes (PUBLIC + anon + ALTER DEFAULT PRIVILEGES). Vérifier `20260618000012/016/018/020`.
- [ ] **Types regen** — toute migration ordres touchant la signature d'un RPC doit déclencher `generate_typescript_types` → `packages/supabase/src/types.generated.ts`.

---

## Sources de vérité (pointeurs)

```
Migrations (historique chronologique)
  supabase/migrations/20260503000008_init_complete_order_rpc.sql        — v1 initial
  supabase/migrations/20260530190828_bump_complete_order_v10.sql        — v10 display-stock
  supabase/migrations/20260617000013_create_get_orders_list_v1_rpc.sql  — list v1 (dropped by v2)
  supabase/migrations/20260618000011_bump_get_orders_list_v2_server_filters.sql
  supabase/migrations/20260618000013..020_*.sql                         — edit-items RPCs + REVOKE
  supabase/migrations/20260618000021_seed_orders_edit_open_perm.sql
  supabase/migrations/20260618000023_fix_edit_items_rpc_status_enum.sql — corrective 'open'→'pending_payment'

Tests (vérité comportementale)
  supabase/tests/orders_read_perm.test.sql           — S31 perm gate
  supabase/tests/orders_list_v1.test.sql             — S32 (remplacé par v2)
  supabase/tests/orders_list_v2.test.sql             — S33, 10/10 PASS
  supabase/tests/order_edit_items.test.sql           — S33, 12/12 PASS
  supabase/tests/complete_order_v10_display.test.sql — display-stock double-déduction

Docs / workplan
  CLAUDE.md — §S32 (get_orders_list_v1, schema discoveries) + §S33 (v2 server-filters, edit-items, realtime, void)
  docs/workplan/specs/2026-05-29-session-33-spec.md
  docs/workplan/plans/2026-05-29-session-33-plan.md
```

---

## Verification before claiming complete

```bash
# Type & lint (cheap, run first)
pnpm typecheck

# pgTAP via MCP execute_sql (BEGIN/ROLLBACK envelope)
# Fichiers : orders_list_v2.test.sql, order_edit_items.test.sql, complete_order_v10_display.test.sql

# BO smoke
pnpm --filter @breakery/app-backoffice test orders

# POS smoke
pnpm --filter @breakery/app-pos test order
```

Baseline : ~24 BO échecs env-gated (`VITE_SUPABASE_URL Required`) ≠ régression (DEV-S25-2.A-02).

---

## When to escalate

- Ajouter une valeur à `order_status` ou `order_type` → confirm business intent, enum ADD VALUE doit vivre dans sa propre TX, puis vérifier tous les guards existants (status IN (…)).
- Modifier la signature de `complete_order_with_payment_v10` → bump obligatoire (`_v11`), `DROP v10` dans la même migration. Vérifier tous les callers POS/BO.
- Relax ou tighten la contrainte `orders.session_id` → peut casser les flows tablet ou B2B (cf. S25 corrective `_014`).
- Nouveau filtre `get_orders_list_v2` impliquant un JOIN sur une table sans index → profiler d'abord.
- Changement du mécanisme PIN (ex. `void-order` EF sweep POST-S30 déféré) → coordonner avec `security-auth` skill.
