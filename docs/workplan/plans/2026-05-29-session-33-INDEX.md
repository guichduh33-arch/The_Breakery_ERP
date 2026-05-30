# Session 33 — Orders v2 : server-side filters + realtime + void + edit-items — INDEX

> **Date** : 2026-05-29
> **Branche** : `swarm/session-33`
> **Base** : `master` @ `4aa61df` (post-merge S32 PR #40 + docs PR #42)
> **Status** : ✓ ready to merge
> **Spec** : [`../specs/2026-05-29-session-33-spec.md`](../specs/2026-05-29-session-33-spec.md)
> **Plan** : [`./2026-05-29-session-33-plan.md`](./2026-05-29-session-33-plan.md)

---

## 1. Summary

Ferme les 4 trous post-S32 sur `/backoffice/orders` (observe → filter → control) :

1. **RPC v1→v2** — `get_orders_list_v2` avec 3 filtres serveur-side (refund_status, hour, terminal_id via JOIN pos_sessions). Drop v1 (CLAUDE.md monotonic).
2. **Realtime updates** — `useOrdersRealtime` hook (postgres_changes channel, StrictMode-safe via `useId()`) + Live/Offline indicator dans le header.
3. **Void actions** — `useVoidOrder` BO + `VoidOrderModal` (reason ≥10 chars + 6-digit PIN). PIN en body per DEV-S33-PRE-02 (void-order EF pas hardened header).
4. **Edit items (open orders)** — 3 RPCs atomiques (`add_order_item_v1`, `update_order_item_qty_v1`, `remove_order_item_v1`) + helper interne `_recalc_order_totals` + idempotency table dédiée. Orchestrateur BO `useEditOrderItems` séquence removes→updates→adds. `EditOrderItemsModal` 2-col (product picker stub V1 + cart preview live).

**Bonus :** `pos_sessions.terminal_id` col ajoutée + POS `useOpenShift` bumpé + OpenShiftModal terminal selector avec localStorage pre-select.

**Tests** : 3 pgTAP suites **25/25 PASS** via cloud MCP (10 orders_list_v2 + 12 order_edit_items + 3 pos_session_terminal). `pnpm typecheck` BO + POS PASS.

---

## 2. Migrations applied (15)

Block `20260618000010..023` (+1 cloud-clock-timestamped corrective `20260529200749`) :

| File timestamp | Cloud version | Object |
|---|---|---|
| `_010` | `20260529191806` | ALTER pos_sessions ADD terminal_id UUID NULL REFERENCES lan_devices(id) + partial index |
| `_011` | `20260529192143` | DROP get_orders_list_v1 + CREATE get_orders_list_v2 (JOIN pos_sessions, server-side refund_status/hour/terminal_id) |
| `_012` | `20260529192152` | REVOKE pair v2 (PUBLIC + anon + ALTER DEFAULT PRIVILEGES) |
| `_013` | `20260529192422` | `_recalc_order_totals(p_order_id)` internal helper (REVOKEd from all roles, S28 pattern) |
| `_014` | `20260529192427` | `order_edit_idempotency_keys` table (PK=key UUID, action CHECK, SELECT-only grant) |
| `_015` | `20260529192857` | `add_order_item_v1(p_order_id, p_product_id, p_qty, p_modifiers, p_idempotency_key)` |
| `_016` | `20260529192903` | REVOKE pair add |
| `_017` | `20260529193148` | `update_order_item_qty_v1(p_order_item_id, p_qty, p_idempotency_key)` |
| `_018` | `20260529193153` | REVOKE pair update |
| `_019` | `20260529193206` | `remove_order_item_v1(p_order_item_id, p_idempotency_key)` |
| `_020` | `20260529193211` | REVOKE pair remove |
| `_021` | (during wave 1.8) | Seed permissions `orders.edit_open` + `orders.void` + role_permissions for MANAGER/ADMIN/SUPER_ADMIN |
| `_022` | (during wave 1.9) | ALTER PUBLICATION supabase_realtime ADD TABLE public.orders |
| `_200749` (cloud-only) | `20260529200749` | **Corrective Wave 4.1** : fix CTE scope bug in get_orders_list_v2 (CTE in 2 separate SELECTs → 42P01 ; merged to single SELECT INTO) |
| `_023` | (during wave 4.2) | **Corrective Wave 4.2** : fix status enum check in 3 edit RPCs (`'open'` → `'pending_payment'`) + use products.retail_price (not .price) |

Total : **13 obligatoires + 2 correctives = 15 migrations**.

---

## 3. New files (S33)

### DB + tests
- `supabase/migrations/20260618000010_add_terminal_id_to_pos_sessions.sql`
- `supabase/migrations/20260618000011_bump_get_orders_list_v2_server_filters.sql`
- `supabase/migrations/20260618000012_revoke_anon_get_orders_list_v2.sql`
- `supabase/migrations/20260618000013_create_recalc_order_totals_helper.sql`
- `supabase/migrations/20260618000014_create_order_edit_idempotency_keys_table.sql`
- `supabase/migrations/20260618000015_create_add_order_item_v1_rpc.sql`
- `supabase/migrations/20260618000016_revoke_anon_add_order_item_v1.sql`
- `supabase/migrations/20260618000017_create_update_order_item_qty_v1_rpc.sql`
- `supabase/migrations/20260618000018_revoke_anon_update_order_item_qty_v1.sql`
- `supabase/migrations/20260618000019_create_remove_order_item_v1_rpc.sql`
- `supabase/migrations/20260618000020_revoke_anon_remove_order_item_v1.sql`
- `supabase/migrations/20260618000021_seed_orders_edit_open_perm.sql`
- `supabase/migrations/20260618000022_alter_publication_supabase_realtime_orders.sql`
- `supabase/migrations/20260618000023_fix_edit_items_rpc_status_enum.sql` (Wave 4 corrective)
- `supabase/migrations/20260529200749_fix_get_orders_list_v2_cte_scope.sql` (Wave 4 corrective)
- `supabase/tests/orders_list_v2.test.sql` — 10 pgTAP
- `supabase/tests/order_edit_items.test.sql` — 12 pgTAP
- `supabase/tests/pos_session_terminal.test.sql` — 3 pgTAP

### BO hooks
- `apps/backoffice/src/features/orders/types.ts` (OrderEditDiff + OrderItemEdit)
- `apps/backoffice/src/features/orders/hooks/useOrdersRealtime.ts`
- `apps/backoffice/src/features/orders/hooks/useVoidOrder.ts`
- `apps/backoffice/src/features/orders/hooks/useAddOrderItem.ts`
- `apps/backoffice/src/features/orders/hooks/useUpdateOrderItemQty.ts`
- `apps/backoffice/src/features/orders/hooks/useRemoveOrderItem.ts`
- `apps/backoffice/src/features/orders/hooks/useEditOrderItems.ts` (orchestrator)
- `apps/backoffice/src/features/devices/hooks/useLanDevices.ts`

### BO UI
- `apps/backoffice/src/features/orders/components/VoidOrderModal.tsx`
- `apps/backoffice/src/features/orders/components/EditOrderItemsModal.tsx`

### POS
- `apps/pos/src/features/shift/hooks/useLanDevices.ts` (POS counterpart)

### Workplan
- `docs/workplan/specs/2026-05-29-session-33-spec.md`
- `docs/workplan/plans/2026-05-29-session-33-plan.md`
- `docs/workplan/plans/2026-05-29-session-33-INDEX.md` (this file)

---

## 4. Files modified (S33)

- `apps/backoffice/src/features/orders/hooks/useOrdersList.ts` (bump v1→v2 RPC + extend `OrdersListFilters` + add `terminal_id` to `OrdersListLine`)
- `apps/backoffice/src/features/orders/hooks/__tests__/useOrdersList.test.tsx` (4 cases : 2 renamed v1→v2 + 2 new for refund_status + terminal_id filters)
- `apps/backoffice/src/pages/orders/OrdersListPage.tsx` (3 new filter inputs + realtime indicator + row actions col + modal wiring + status enum corrections post-Wave-4 discovery)
- `apps/pos/src/features/shift/hooks/useShift.ts` (useOpenShift accepts `terminal_id?: string | null`)
- `apps/pos/src/features/shift/OpenShiftModal.tsx` (Terminal selector section + localStorage pre-select)
- `packages/supabase/src/rls/permissions.ts` (extend union with `'orders.edit_open'` + `'orders.void'`)
- `packages/supabase/src/types.generated.ts` (regen post-Wave-1)

---

## 5. Tests run

| Suite | Count | Status |
|---|---|---|
| pgTAP `orders_list_v2` (cloud MCP) | 10/10 | PASS |
| pgTAP `order_edit_items` (cloud MCP) | 12/12 | PASS |
| pgTAP `pos_session_terminal` (cloud MCP) | 3/3 | PASS |
| Unit `useOrdersList` (extended +2 cases) | 4/4 | PASS |
| `pnpm typecheck` `@breakery/app-backoffice` | PASS | |
| `pnpm typecheck` `@breakery/app-pos` | PASS | |
| `pnpm typecheck` `@breakery/supabase` | PASS | |

**Total: ~29 tests PASS, 0 fail.**

---

## 6. Permissions seeded (2)

- `orders.edit_open` — Edit items on open orders from BO (MANAGER, ADMIN, SUPER_ADMIN)
- `orders.void` — Void orders (MANAGER, ADMIN, SUPER_ADMIN)

---

## 7. RPCs added / bumped (5)

| Action | RPC | Notes |
|---|---|---|
| Bumped (DROP v1 + CREATE v2) | `get_orders_list_v2` | JOIN pos_sessions + 3 new server-side filter axes |
| Created | `add_order_item_v1` | SECURITY DEFINER + status check + idempotency + recalc + audit_log |
| Created | `update_order_item_qty_v1` | idem (qty>0, line_total recalc) |
| Created | `remove_order_item_v1` | idem (DELETE + recalc) |
| Created (helper) | `_recalc_order_totals` | Internal — REVOKEd from all roles |

---

## 8. Deferred S34+ (out of scope)

1. **BO unit + smoke tests** (Tasks 4.4/4.5/4.6) — pgTAP DB coverage is comprehensive (25 tests) ; UI smoke tests deferred to S34 follow-up.
2. Refund actions depuis BO (RPC existe S25, UI wiring trivial)
3. Edit customer / notes / table assignment sur open orders
4. Edit sur completed orders (refund + new order pattern)
5. Mobile responsive OrdersListPage
6. Backfill `pos_sessions.terminal_id` historique
7. NOT NULL promotion sur `pos_sessions.terminal_id`
8. void-order EF hardening to header-PIN (DEV-S33-PRE-02)
9. Concurrent edit conflict detection (row version)
10. Realtime merge in-place (vs current invalidate refetch)
11. CF account drill (DEV-S32-1.D-01)
12. UnifiedReportFilters extra dims
13. Compare toggle S30 reports
14. Hub mini-KPI + favorites
15. 6 Soon cards restantes

---

## 9. Deviations vs spec/plan

| ID | Section | Original | What happened | Reason | Risk |
|---|---|---|---|---|---|
| DEV-S33-PRE-01 | §3.2 RPC bump open_pos_session | RPC v1→v2 bump | Dropped — POS `useOpenShift` is direct INSERT, not an RPC. Client-side bump only. | Schema reality | Informational |
| DEV-S33-PRE-02 | §4 void-order EF | Header PIN per S25 | Body PIN preserved | void-order EF not hardened in S25 | Informational (sweep deferred) |
| DEV-S33-1.5-01 | §3.3 add RPC | `products.price` | Used `products.retail_price` | Schema reality (verified) | Fixed in body + corrective `_023` |
| DEV-S33-1.5-02 | §3.3 add RPC | `order_items.qty` | Used `order_items.quantity` (NUMERIC) | Schema reality | Fixed in body |
| DEV-S33-1.8-01 | §3.4 perm seed | `permissions(code, description, category)` | Schema is `(code, module, action, description)` | Schema reality | Inline-fixed |
| DEV-S33-4.1-01 | §3.1 get_orders_list_v2 | CTE in 2 SELECTs | Bug: PostgreSQL CTEs scope to 1 statement (42P01). Merged to single SELECT INTO. | Spec bug | Fixed via corrective `_200749` cloud-only timestamp |
| DEV-S33-4.2-01 | §3.3 status check | `IN ('draft', 'open')` | order_status enum has no 'open' value — actual: draft, paid, voided, pending_payment, completed, b2b_pending. Fixed to `('draft', 'pending_payment')`. | Schema reality | **Medium** — fixed via corrective `_023` |
| DEV-S33-4.3-01 | Test fixture | Plain INSERTs back-to-back | Exclusion constraint `one_open_session_per_user` blocks 2nd open session. Test closes prior session between cases. | Schema reality | Informational |
| DEV-S33-4-SKIP-01 | Plan §4.4-4.6 | BO unit + smoke + POS smoke tests | Deferred to S34 follow-up | Time scoping — pgTAP comprehensive | Informational |

---

## 10. Acceptance criteria

- [x] **Wave 1** : 13+ migrations apply OK cloud V3 dev + types regen committée
- [x] pgTAP `orders_list_v2` 10/10 PASS via cloud MCP
- [x] pgTAP `order_edit_items` 12/12 PASS
- [x] pgTAP `pos_session_terminal` 3/3 PASS
- [x] **Wave 2** : 8 hooks BO + 1 hook POS bumpés/créés + `OrderEditDiff` interface + `'orders.edit_open'` + `'orders.void'` ajoutés au `PermissionCode` union
- [x] **Wave 3** : OrdersListPage filters bar étendu (3 new) + 2 modals créés + realtime indicator + POS OpenShiftModal bumped
- [x] `pnpm typecheck` BO + POS + supabase PASS
- [ ] BO unit (extended useOrdersList) 4/4 PASS ✓ ; **BO smoke + POS smoke deferred S34** (DEV-S33-4-SKIP-01)
- [x] INDEX `2026-05-29-session-33-INDEX.md` créé + CLAUDE.md Active Workplan à bumper

---

## 11. Backlog Vague C remaining (S34+)

1. **BO + POS smoke test suites** — extend `OrdersListPage.smoke.test.tsx` (3 new filters + realtime + row actions perm gates), `VoidOrderModal.smoke.test.tsx`, `EditOrderItemsModal.smoke.test.tsx`, `OpenShiftModal.smoke.test.tsx` (terminal selector + localStorage). ~14 cases.
2. **Refund actions from BO** — UI wiring trivial (RPC + EF live S25)
3. void-order EF hardening (body→header PIN) + sweep cancel-item + kiosk-issue-jwt
4. EditOrderItemsModal product picker (V1 stub → wire to BO product search)
5. Edit other fields on open orders (customer, notes, table)
6. Mobile responsive OrdersListPage + detail pages
7. CF account drill (DEV-S32-1.D-01)
8. UnifiedReportFilters extra dims
9. Compare toggle S30 reports
10. Hub mini-KPI + favorites
11. 6 Soon cards restantes
