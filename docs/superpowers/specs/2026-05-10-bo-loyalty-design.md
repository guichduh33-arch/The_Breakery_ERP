# BO Loyalty Management — Design Spec

**Date:** 2026-05-10
**Status:** Approved by user (sections 1–3)
**Builds on:** sessions 3 (loyalty schema) and 9 (promotions BO pattern)
**Out of scope:** POS-side redemption flow, B2B customers, configurable tier thresholds, bulk ops, CSV export.

---

## 1. Goal

Add a backoffice page to manage retail customers and their loyalty points, mirroring the promotions BO module shipped in session 9. Three capability tiers:

- **BO1 — list & search** customers with points balance and computed tier badge.
- **BO2 — drilldown** into per-customer transaction history (read-only ledger view).
- **BO3 — write actions** behind a new `loyalty.adjust` permission: customer CRUD (create / edit / soft-delete) and manual points adjustment with mandatory reason.

The earning side (`complete_order_with_payment`) already exists from session 3 and is not modified.

## 2. Architecture

### 2.1 Migrations (3 new)

All dated `20260512xxxxxx` (after session 9 promotion migrations at `20260511*`).

| File | Purpose |
|---|---|
| `20260512000001_init_loyalty_tier_helper.sql` | `get_loyalty_tier(p_lifetime_points INT) RETURNS TEXT` — pure SQL function returning `'bronze'` / `'silver'` / `'gold'`. IMMUTABLE. Used in tests and any future RPC. |
| `20260512000002_init_adjust_loyalty_points_rpc.sql` | `adjust_loyalty_points(p_customer_id UUID, p_delta INT, p_reason TEXT)` SECURITY DEFINER (see §3.2). Plus the `auth_update_retail` policy on `customers` and column-level GRANT revocation on `loyalty_points` / `lifetime_points` / `total_spent` / `total_visits` / `last_visit_at` from role `authenticated`. |
| `20260512000003_seed_loyalty_adjust_permission.sql` | Insert `loyalty.adjust` permission row; extend `has_permission()` so `ADMIN` and `SUPER_ADMIN` (only) match it. |

### 2.2 Tier thresholds (hardcoded)

| Tier | Lifetime points |
|---|---|
| `bronze` | 0 – 499 |
| `silver` | 500 – 1999 |
| `gold` | ≥ 2000 |

Defined twice (deliberately):
- SQL: `get_loyalty_tier()` — used in tests and any RPC that needs to return a tier.
- TypeScript: `packages/domain/src/loyalty/tiers.ts` exports `LOYALTY_TIERS` and `getTierFromLifetimePoints(n)`. UI imports from there. A unit test asserts the two tables agree.

### 2.3 Package layout

```
packages/domain/src/loyalty/
  tiers.ts                # LOYALTY_TIERS, getTierFromLifetimePoints, LoyaltyTier type
  tiers.test.ts           # boundary cases incl. negative throws

packages/ui/src/loyalty/
  LoyaltyTierBadge.tsx    # bronze/silver/gold pill
  CustomerForm.tsx        # name/phone/email — used by create+edit modals
  LoyaltyAdjustForm.tsx   # sign toggle + amount + reason (>=5 chars)
  index.ts                # re-exports

apps/backoffice/src/features/loyalty/
  hooks/
    useLoyaltyCustomersList.ts
    useCustomerLoyaltyHistory.ts
    useCreateCustomer.ts
    useUpdateCustomer.ts
    useDeleteCustomer.ts
    useAdjustLoyaltyPoints.ts
    customerRowMappers.ts
  components/
    CustomerListRow.tsx
    CustomerFormModal.tsx
    CustomerDeleteConfirm.tsx
    LoyaltyHistoryDrawer.tsx
    LoyaltyAdjustModal.tsx

apps/backoffice/src/pages/Loyalty.tsx          # page entry
apps/backoffice/src/routes/index.tsx           # add /loyalty route
apps/backoffice/src/layouts/BackofficeLayout.tsx  # add sidebar link
```

## 3. Data flow

### 3.1 Page UX (`Loyalty.tsx`)

```
[Search: name/phone/email]   [Tier filter: all/bronze/silver/gold]   [+ New customer]

Name           Phone        Tier      Balance    Lifetime    Last visit    ⋯
Hassan Diop    +33 6 ...    [silver]    1240       2150       2 days       ⋯  ← row click → history drawer
...
```

Row "⋯" menu actions: **View history** / **Adjust points** / **Edit** / **Delete**.
Only **Adjust points** is hidden via `useHasPermission('loyalty.adjust')`. View history / Edit / Delete are visible to all authenticated BO users — DB-level access is gated by `is_authenticated()` RLS; app-level role gating (e.g., is the BO app reachable for CASHIER at all) is handled outside this spec by the existing routing layer, same as for promotions BO.

### 3.2 RPC: `adjust_loyalty_points`

```sql
adjust_loyalty_points(
  p_customer_id UUID,
  p_delta       INT,    -- signed: positive = add, negative = subtract
  p_reason      TEXT
) RETURNS TABLE (
  txn_id          UUID,
  new_balance     INT,
  new_lifetime    INT
)
```

Guards (in order, raised as `EXCEPTION` with the literal sqlstate-like message in single quotes for client-side error mapping):

1. `has_permission(auth.uid(), 'loyalty.adjust')` → else `'forbidden'`.
2. `p_delta <> 0` AND `length(trim(p_reason)) >= 5` → else `'invalid_input'`.
3. `SELECT ... FROM customers WHERE id = p_customer_id FOR UPDATE`. If row not found or `deleted_at IS NOT NULL` → `'customer_deleted'`.
4. `IF (loyalty_points + p_delta) < 0 THEN RAISE 'insufficient_balance'`.
5. `INSERT INTO loyalty_transactions (customer_id, order_id, transaction_type, points, points_balance_after, description, created_by)` — note `order_id` is `NULL`, `transaction_type = 'adjust'`, `points = p_delta` (signed), `points_balance_after = loyalty_points + p_delta`, `created_by = (SELECT id FROM user_profiles WHERE auth_user_id = auth.uid())`.
6. `UPDATE customers SET loyalty_points = loyalty_points + p_delta, lifetime_points = lifetime_points + GREATEST(p_delta, 0)` WHERE id = p_customer_id.
7. RETURN the inserted txn_id and new balances.

Note: `complete_order_with_payment` already increments both balances on `earn`; this RPC follows the same convention (only positive deltas grow lifetime).

### 3.3 RLS

`customers` — current state has `auth_read` and `auth_insert_retail` only. Add:
```sql
CREATE POLICY "auth_update_retail" ON customers FOR UPDATE
  USING (is_authenticated() AND deleted_at IS NULL AND customer_type = 'retail')
  WITH CHECK (is_authenticated() AND customer_type = 'retail');
```
No `DELETE` policy — soft-delete only via the same UPDATE policy (`SET deleted_at = now()`).

Column-level GRANT: revoke `UPDATE` on `loyalty_points`, `lifetime_points`, `total_spent`, `total_visits`, `last_visit_at` from role `authenticated`. These columns are mutated only by SECURITY DEFINER functions (`complete_order_with_payment`, `adjust_loyalty_points`).

`loyalty_transactions` — keep existing `auth_read_own_view`. No INSERT/UPDATE/DELETE policy; ledger writes are RPC-only.

### 3.4 Hook contracts

| Hook | Returns | Query / mutation |
|---|---|---|
| `useLoyaltyCustomersList(filters)` | `CustomerRow[]` | Selects `id, name, phone, email, loyalty_points, lifetime_points, total_spent, total_visits, last_visit_at, created_at`. Filters: `search` (server-side `name ilike '%q%'` OR `phone like 'q%'`) + `tier` (`lifetime_points` range). Order: `loyalty_points DESC, name ASC`. Excludes soft-deleted. |
| `useCustomerLoyaltyHistory(customerId)` | `LoyaltyTxnRow[]` | Selects all txn cols + `user_profiles!created_by(id, full_name)`. Limit 50, newest first. Enabled only when `customerId` is set. |
| `useCreateCustomer` | mutation `(values)` | `INSERT` via `from('customers').insert(values)`. Invalidates list. |
| `useUpdateCustomer` | mutation `(id, values)` | `UPDATE name/phone/email`. Invalidates list. |
| `useDeleteCustomer` | mutation `(id)` | `UPDATE` setting `deleted_at = now()`. Invalidates list. |
| `useAdjustLoyaltyPoints` | mutation `({customerId, delta, reason})` | `supabase.rpc('adjust_loyalty_points', {...})`. Invalidates list + history for that customer. |

### 3.5 Component contracts

| Component | Props | Behavior |
|---|---|---|
| `LoyaltyTierBadge` (UI) | `tier: LoyaltyTier` | Color-coded pill: bronze (warm tan), silver (gray), gold (amber). |
| `CustomerForm` (UI) | `defaultValues, onSubmit, submitting` | Controlled form with name (required, ≥2 chars), phone (optional, E.164 hint), email (optional, RFC-lite check). |
| `LoyaltyAdjustForm` (UI) | `currentBalance, onSubmit, submitting` | Sign toggle [+/−], amount (positive int), reason textarea (≥5 chars). Disables submit if negative result. |
| `CustomerListRow` (BO) | `row, onView, onAdjust, onEdit, onDelete, canAdjust` | Row + ⋯ menu. Tier badge computed from `lifetime_points`. |
| `CustomerFormModal` (BO) | `open, mode, initial?, onClose` | Wraps `CustomerForm`, calls create/update mutation, toast + invalidate. |
| `CustomerDeleteConfirm` (BO) | `customer, open, onClose` | Type-customer-name to confirm. Calls `useDeleteCustomer`. |
| `LoyaltyHistoryDrawer` (BO) | `customerId, open, onClose` | Lists txn rows: txn type pill, signed points, balance after, description, order link (if `order_id`), created_at, created_by name. |
| `LoyaltyAdjustModal` (BO) | `customer, open, onClose` | Wraps `LoyaltyAdjustForm`, calls `useAdjustLoyaltyPoints`. Shows current balance. Maps RPC errors to inline form errors per §3.6. |

### 3.6 Error handling

| Source | Error | UX |
|---|---|---|
| RPC `forbidden` | Permission revoked mid-session | Toast "Action not permitted" + close modal. |
| RPC `invalid_input` | Empty reason / zero delta | Inline form error (client validation primary; RPC defense-in-depth). |
| RPC `insufficient_balance` | Negative delta exceeds balance | Inline form error: "Customer only has X points." |
| RPC `customer_deleted` | Race — customer soft-deleted in another tab | Toast + invalidate list + close modal. |
| RLS denial on update/delete | Non-permitted role | Toast "Action not permitted." |
| Network / Supabase generic | Anything else | Toast "Something went wrong" + retry. |

No optimistic UI; React Query `invalidateQueries` after every mutation.

## 4. Testing

### 4.1 Domain unit tests — `packages/domain/src/loyalty/tiers.test.ts`
- `getTierFromLifetimePoints(0) === 'bronze'`
- `getTierFromLifetimePoints(499) === 'bronze'`
- `getTierFromLifetimePoints(500) === 'silver'`
- `getTierFromLifetimePoints(1999) === 'silver'`
- `getTierFromLifetimePoints(2000) === 'gold'`
- `getTierFromLifetimePoints(-1)` throws.

### 4.2 SQL tests — `supabase/tests/loyalty_adjust_rpc.sql`
- ADMIN, positive delta → balance + lifetime increase, ledger row exists with correct `points`, `points_balance_after`, `description`, `created_by`.
- ADMIN, negative delta within balance → balance decreases, lifetime unchanged.
- ADMIN, negative delta exceeding balance → `insufficient_balance` raised, no ledger row created (transaction rolled back).
- MANAGER → `forbidden`.
- `p_reason = 'hi'` → `invalid_input`.
- `p_delta = 0` → `invalid_input`.
- Soft-deleted customer → `customer_deleted`.
- `get_loyalty_tier(0/500/2000)` returns `'bronze'/'silver'/'gold'`.

### 4.3 RLS tests — `supabase/tests/loyalty_rls.sql`
- Authenticated user can `SELECT` from `customers` and `loyalty_transactions`.
- Authenticated user CANNOT `UPDATE customers SET loyalty_points = ...` directly (column GRANT denies).
- Authenticated user CAN `UPDATE customers SET name = ..., phone = ..., email = ...`.
- Authenticated user CANNOT `INSERT INTO loyalty_transactions`.
- `auth_update_retail` rejects b2b row updates (still gated by CHECK + policy).

### 4.4 Frontend smoke test — `apps/backoffice/src/__tests__/loyalty-list.smoke.test.tsx`
- Render `Loyalty.tsx` with mocked supabase returning two customers (bronze + silver).
- Verify rows render with correct tier badges.
- With `loyalty.adjust = true` permission → ⋯ menu shows Adjust points.
- With permission off → ⋯ menu hides only Adjust points; View history + Edit + Delete still visible.

## 5. Acceptance criteria

- [ ] All three migrations apply cleanly on a fresh DB.
- [ ] All four test suites (domain unit, SQL RPC, SQL RLS, frontend smoke) pass.
- [ ] Existing tests remain green (`pnpm test`, `pnpm --filter db test` or equivalent).
- [ ] Sidebar shows "Loyalty" link in BO; route `/loyalty` renders the page.
- [ ] Manual QA flow: create customer → adjust +500 → tier upgrades to silver in list view → adjust −100 → balance now 400, lifetime still 500 → soft-delete → row disappears from list.

## 6. Rollout

Single PR; no feature flag (mirrors how promotions BO shipped). Migrations are additive and independent of existing flows.
