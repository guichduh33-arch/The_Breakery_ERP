# 03 — RPC Functions

> **Last verified**: 2026-05-03
> **Source of truth**: `supabase/migrations/` and live introspection via `database.generated.ts` (`Database['public']['Functions']`).
> **Companion**: [01-schema-overview.md](01-schema-overview.md), [02-tables-reference.md](02-tables-reference.md), [04-triggers.md](04-triggers.md).

This file documents every Postgres function that AppGrav V2 invokes via `supabase.rpc()`. Pure trigger functions (e.g. `update_updated_at`, `audit_trigger_func`) live in [04-triggers.md](04-triggers.md).

Conventions used below:

| Marker | Meaning |
|--------|---------|
| `SECURITY DEFINER` | Runs with the function owner's privileges (typically `postgres`); RLS is bypassed inside the body |
| `STABLE` | Same args within a single statement → same result (Postgres can cache) |
| `VOLATILE` | Default; effectful or non-deterministic |
| `SET search_path = public` | Pinned to `public` to defeat search_path injection |
| `verify_jwt: true` | Edge Function-level — not applicable here, but most RPCs require an authenticated session through Supabase auth |

The 41 RPCs called from V2 source code are organised into 9 functional groups. Each section lists the call signature, return shape, security flags, lead migration, the consumer files in the V2 codebase, and an example TypeScript invocation.

---

## 1. Auth & Permissions

### `is_authenticated() → BOOLEAN`
**Migration**: `20260316100000_rls_performance_optimization.sql` (line 23)
**Security**: `STABLE SECURITY DEFINER SET search_path = public`
**Granted**: `authenticated`, `anon`

Helper used inside RLS `USING` clauses. Replaced inline `auth.uid() IS NOT NULL` in 136 policies for caching benefits.

```sql
CREATE OR REPLACE FUNCTION public.is_authenticated()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT (auth.uid() IS NOT NULL) $$;
```

Used by every RLS policy created since 2026-03-16. Not invoked from TS directly.

---

### `user_has_permission(p_user_id UUID, p_permission_code VARCHAR) → BOOLEAN`
**Migration**: `011_functions_triggers.sql` (line 231) — refined in `20260216200000_fix_permission_functions_searchpath.sql`, `20260222025651_…`, `20260222030200_…`, `20260222035028_fix_user_has_permission_volatile_to_stable.sql`.
**Security**: `STABLE SECURITY DEFINER SET search_path = public`

Returns TRUE if the user has the permission via either:
1. A direct `user_permissions` grant (with `is_granted = TRUE`, not yet expired), AND no direct revoke
2. A role-based grant via `user_roles → role_permissions → permissions`

Direct revoke takes precedence over any grant.

**Consumers**:
- `src/services/financial/refundService.ts:51`
- `src/services/financial/voidService.ts:34`
- `src/services/pos/tabletOrderService.ts:62`
- All RLS WITH CHECK clauses for write operations

```ts
const { data: hasPerm } = await supabase.rpc('user_has_permission', {
  p_user_id: userId,
  p_permission_code: 'sales.refund',
});
if (!hasPerm) throw new Error('Permission denied');
```

---

### `is_admin(p_user_id UUID) → BOOLEAN`
**Migration**: `011_functions_triggers.sql` (line 266); refined in `20260216200000_…`.
**Security**: `STABLE SECURITY DEFINER`
TRUE if the user has any role with code `SUPER_ADMIN` or `ADMIN`.

---

### `verify_user_pin(p_user_id UUID, p_pin TEXT) → BOOLEAN`
**Migration**: `20260210100000_remove_plaintext_pin.sql` (replaced earlier plaintext fallback).
**Security**: `SECURITY DEFINER`. Compares `p_pin` against `pin_hash` (bcrypt) using `crypt()`.

**Consumers**:
- `src/services/authService.ts:222`
- `src/hooks/auth/useAuthService.ts:10`

```ts
const { data: isValid } = await supabase.rpc('verify_user_pin', {
  p_user_id: profile.id,
  p_pin: enteredPin,
});
```

---

### `mobile_verify_pin(p_pin TEXT) → JSON`
Mobile flow: looks up the user by PIN (across active profiles) and returns the profile JSON if matched. Used for tablet/mobile PIN-only sessions where `auth.uid()` may be NULL.
**Consumer**: `src/hooks/auth/useMobileAuth.ts:28`

---

### `get_user_permissions(p_user_id UUID) → SETOF permissions`
Returns the merged effective permission set for a user (role grants + direct grants − direct revokes).
**Consumer**: `src/services/authService.ts:284`

---

### `get_display_names(user_ids UUID[]) → TABLE(user_id UUID, display_name TEXT)`
Bulk resolves a set of user UUIDs to display names without round-tripping through RLS-protected `user_profiles`.
**Consumer**: `src/hooks/purchasing/usePurchaseOrderDetail.ts:66`

---

## 2. Sales / POS — Order lifecycle

### `complete_order_with_payments(p_order_id UUID, p_payments JSONB, p_staff_id UUID, p_session_id UUID DEFAULT NULL) → JSONB`
**Migration**: `20260322100000_create_complete_order_with_payments_rpc.sql`. Refined in `20260329140000_fix_payment_total_validation.sql`, `20260401110000_fix_complete_order_rpc_invalid_column.sql`, `20260414120000_audit_fix_recreate_rpcs_add_cogs.sql`, `20260429234000_add_idempotency_to_complete_order_rpc.sql`.
**Security**: `SECURITY DEFINER SET search_path = public`. Granted to `authenticated`.

Atomically:
1. Validates inputs (order exists, payments array non-empty)
2. For each payment: inserts a row into `order_payments` (`status='completed'`)
3. Sums payment amounts; updates `orders.total = sum, payment_status='paid', status='completed', completed_at=NOW(), staff_id, session_id`
4. The `trg_create_sale_journal_entry` AFTER UPDATE trigger fires → JE with revenue/PB1/cash split
5. The stock deduction triggers fire → `stock_movements` rows
6. Returns `{order_id, order_number, total_paid, change_given, payment_count}`

**`p_payments` shape**:
```json
[
  {"method": "cash", "amount": 50000, "cash_received": 60000},
  {"method": "qris", "amount": 30000}
]
```

**Idempotency**: optional `idempotency_key` column on `order_payments` (since `20260429234000_…`). Repeated calls with same key short-circuit and return the prior result.

**Consumer**: `src/services/pos/orderService.ts:389`

```ts
const { data, error } = await supabase.rpc('complete_order_with_payments', {
  p_order_id: orderId,
  p_payments: payments, // JSONB array
  p_staff_id: staffId,
  p_session_id: sessionId,
});
```

---

### `complete_order_as_outstanding(p_order_id UUID, p_staff_id UUID, p_session_id UUID DEFAULT NULL) → JSONB`
**Migration**: `20260407200000_pos_outstanding.sql`.
**Security**: `SECURITY DEFINER`.

Marks an order as `status='completed'` and `payment_status='unpaid'` (creates an outstanding receivable). Used when a customer leaves before paying. Does NOT create JE for revenue (no payment yet); kitchen prep is still recorded.
**Consumer**: `src/services/pos/orderService.ts:451`

---

### `pay_outstanding_order(p_order_id UUID, p_payments JSONB, p_staff_id UUID, p_session_id UUID) → JSONB`
**Migration**: `20260407200000_pos_outstanding.sql`.
Counterpart to the above: settles an outstanding order. Same payment shape as `complete_order_with_payments`. Triggers JE creation now that revenue is recognised.
**Consumer**: `src/services/pos/orderService.ts:509`

---

### `create_pos_transaction(payload JSONB) → JSONB`
**Migration**: `20260205150000_create_order_payments.sql` (and refits).
Builder RPC: receives a single payload with order header + items + payments and creates everything in one transaction. Returns `{order_id, order_number}`.
**Consumer**: `src/services/pos/orderService.ts:288`

---

### `refund_pos_transaction(p_order_id UUID, p_reason TEXT DEFAULT 'Refunded from POS', p_refunded_by UUID DEFAULT auth.uid()) → JSONB`
**Migration**: `20260318184800_create_refund_rpc.sql` — extended in `20260330500200_pos_live_stock_triggers.sql` to restore cafe stock.
**Security**: `SECURITY DEFINER`.

Sets order status to `voided`, reverses payment + creates the reversing JE (via the sale-JE trigger's reversal path). Restores `pos_live_stock` rows for cafe items. Requires `sales.refund` permission.

**Consumer**: `src/services/pos/refundService.ts:16`

---

### `record_payment_incident(p_idempotency_key UUID, p_payment_method TEXT, p_amount BIGINT, p_terminal_id UUID DEFAULT NULL, p_polling_attempts INT DEFAULT 3) → JSONB`
**Migration**: `20260430000000_record_payment_incident_rpc.sql`.
Inserts a `payment_incidents` row. Idempotent — returns existing record if key already used.
**Consumer**: payment incident reporting flow (POS).

---

### `noop_ping() → BOOLEAN`
**Migration**: `20260430200000_add_noop_ping_rpc.sql`. Returns TRUE. Used as a connectivity probe.

---

## 3. Sessions / Shifts (Cash Register)

### `get_user_open_shift(p_user_id UUID) → TABLE`
**Migration**: `20260205070000_add_missing_shift_lan_functions.sql`. Returns the row of an open `pos_session` for the user, or empty.
**Consumer**: `src/hooks/useShift.ts:119, 212, 290, 313, 440`.

### `get_terminal_open_shifts(p_terminal_id VARCHAR) → TABLE`
Same but per terminal. Consumer: `src/hooks/useShift.ts:164`.

### `open_shift(p_user_id UUID, p_opening_cash DECIMAL, p_terminal_id VARCHAR, p_notes TEXT DEFAULT NULL) → JSONB`
**Migration**: `20260205070000_add_missing_shift_lan_functions.sql`. Reused in `20260210110003_db008_fix_open_shift.sql`.
**Security**: `SECURITY DEFINER`.

Creates `pos_sessions` row (status `open`), generates `session_number` via `generate_session_number()` trigger, returns the new session as JSONB.
**Consumer**: `src/hooks/useShift.ts:304`.

### `close_shift(p_session_id UUID, p_actual_cash DECIMAL, p_actual_qris DECIMAL, p_actual_edc DECIMAL, p_closed_by VARCHAR, p_notes TEXT DEFAULT NULL) → JSONB`
**Migration**: `20260205070000_…`, refined in `20260210100004_fix_close_shift_status_filter.sql`.
Calculates expected vs actual, computes discrepancies, updates session row (`status='closed'`, `closed_at=NOW()`).

### `close_shift_with_snapshot(p_session_id UUID, p_closing_cash NUMERIC, p_notes TEXT DEFAULT NULL) → JSONB`
**Migration**: `20260430180000_caissapp_shift_snapshots_and_close_rpc.sql`.
Atomic close + snapshot insertion into `shift_snapshots`. New canonical RPC for caissapp module.
**Consumer**: caissapp close-shift flow.

---

## 4. Loyalty

### `add_loyalty_points(p_customer_id UUID, p_order_id UUID, p_order_amount NUMERIC, p_created_by UUID DEFAULT NULL) → INTEGER`
**Migration**: `011_functions_triggers.sql` (line 285); ported in `20260207043009_remote_schema.sql`.
Calculates `FLOOR(amount / category.points_per_amount * category.points_multiplier)`, updates `customers.loyalty_points / lifetime_points / total_spent / total_visits / last_visit_at`, inserts a row in `loyalty_transactions` with `transaction_type='earn'`, returns earned points.

**Consumer**: `src/hooks/customers/useCustomers.ts:242` (typed `as never` because not in generated types).

```ts
await supabase.rpc('add_loyalty_points' as never, {
  p_customer_id: customerId,
  p_order_id: orderId,
  p_order_amount: orderTotal,
  p_created_by: staffId,
});
```

### `redeem_loyalty_points(p_customer_id UUID, p_points INTEGER, p_order_id UUID DEFAULT NULL, p_description TEXT DEFAULT 'Points redemption', p_created_by UUID DEFAULT NULL) → BOOLEAN`
Same migration. Raises `Insufficient loyalty points` exception if balance < requested. Inserts a `redeem` transaction.

**Consumer**: `src/hooks/customers/useCustomers.ts:263`.

---

## 5. Pricing

### `get_customer_product_price(p_product_id UUID, p_customer_category_slug VARCHAR) → DECIMAL`
**Migration**: `011_functions_triggers.sql` (line 375); ported in `20260207043009_remote_schema.sql`.
Resolves the price for a product based on the customer category's `price_modifier_type`:
- `retail` → `products.retail_price`
- `wholesale` → `products.wholesale_price` (fallback to retail)
- `custom` → `product_category_prices.custom_price` for the (category, product) pair (fallback to retail)
- `discount_percentage` → `retail * (1 - discount_percentage/100)`

Used internally by views and B2B pricing logic.

---

## 6. Accounting — Read RPCs

### `get_account_balance(p_account_id UUID, p_end_date DATE) → NUMERIC`
**Migration**: `20260220030000_create_missing_accounting_rpcs.sql` (line 151).
**Security**: `SECURITY DEFINER`.
Sums posted JE lines for the account up to and including `p_end_date`, applying balance_type sign (debit-normal vs credit-normal).
**Consumers**: `src/services/accounting/calkService.ts:133, 143, 153`.

### `get_balance_sheet_data(p_end_date DATE) → TABLE(account_id UUID, …)`
Returns the balance sheet as a flat table (Assets, Liabilities, Equity).
**Consumer**: `src/hooks/accounting/useBalanceSheet.ts:28`.

### `get_income_statement_data(p_start_date DATE, p_end_date DATE) → TABLE(...)`
Revenue, COGS, Operating Expenses by account for the period.
**Consumers**: `src/hooks/accounting/useIncomeStatement.ts:26`, `src/services/accounting/calkService.ts:116`.

### `get_trial_balance_data(p_end_date DATE) → TABLE(account_id UUID, debit NUMERIC, credit NUMERIC, balance NUMERIC)`
Per-account totals at the as-of date.
**Consumer**: `src/hooks/accounting/useTrialBalance.ts:29`.

### `calculate_vat_payable(p_year INT, p_month INT) → TABLE(collected NUMERIC, deductible NUMERIC, payable NUMERIC)`
**Migration**: `20260220030000_create_missing_accounting_rpcs.sql` (line 24). Granted to `authenticated`, `service_role`.

VAT collected = sum of credits − debits on account `2110` (PB1 Payable) for posted JE lines in the month range. VAT deductible = sum of debits − credits on account `1400` (VAT Input). Payable = collected − deductible.

**Consumers**: `src/hooks/accounting/useVATManagement.ts:27`, `src/services/accounting/calkService.ts:177`.

### `get_vat_by_category(p_year INT, p_month INT) → TABLE(category_name TEXT, total_sales NUMERIC, vat_collected NUMERIC, order_count BIGINT, items_sold BIGINT)`
Same migration. Per-category VAT breakdown.
**Consumer**: `src/hooks/accounting/useVATManagement.ts:47`.

### `auto_match_bank_lines(p_statement_id UUID, p_tolerance NUMERIC) → JSONB`
Tries to match unreconciled `bank_statement_lines` to existing `journal_entry_lines` (or expenses) within an amount tolerance.
**Consumer**: `src/hooks/accounting/useBankReconciliation.ts:165`.

---

## 7. Accounting — Atomic Mutation RPCs

### `approve_expense_with_journal(p_expense_id UUID, p_approved_by UUID) → JSON`
**Migration**: `20260323100100_atomic_expense_approval_and_role_permissions.sql` (line 22).
**Security**: `SECURITY DEFINER SET search_path = public`. Granted to `authenticated`.

Atomically:
1. Locks `expenses` row, sets `status='approved', approved_by, approved_at=NOW()` (only if currently `pending`)
2. Looks up `expense_categories.account_id` for the debit account
3. Determines credit account from `payment_method` (`cash` → 1110, else → 1120)
4. Idempotent: returns the prior expense JSON if a matching `journal_entries` row already exists (`reference_type='expense', reference_id=p_expense_id`)
5. Otherwise creates the JE header + lines (and VAT line if applicable)
6. Returns the expense as JSON

**Consumer**: `src/hooks/expenses/useExpenses.ts:193`.

```ts
const { data, error } = await supabase.rpc('approve_expense_with_journal', {
  p_expense_id: expenseId,
  p_approved_by: staffId,
});
```

### `update_role_permissions(p_role_id UUID, p_permission_ids UUID[]) → INT`
**Migration**: `20260323100100_…` (line 172).
**Security**: `SECURITY DEFINER`.

Atomically replaces the entire permission set for a role: deletes existing rows in `role_permissions`, inserts the new ones. Returns the count of inserted rows.
**Consumer**: `src/hooks/settings/useRoles.ts:235`.

### `next_expense_number() → TEXT`
Generates the next expense number (`EXP-YYYYMMDD-NNN`) using `sequence_tracker` for thread-safety.
**Consumer**: `src/hooks/expenses/useExpenses.ts:104`.

---

## 8. Inventory & Production

### `get_cafe_stock_status() → TABLE(product_id UUID, product_name TEXT, product_sku TEXT, product_image TEXT, current_stock NUMERIC, …)`
**Migration**: `20260330500100_pos_live_stock_rpcs.sql`.
**Security**: `SECURITY DEFINER`.
Returns the current cafe-section stock for all tracked products.
**Consumers**: `src/hooks/pos/useCafeStock.ts:25`, `src/pages/pos/posCheckoutHandler.ts:32`.

### `receive_cafe_stock(p_items JSONB, p_staff_id UUID DEFAULT NULL) → JSONB`
**Migrations**: `20260330500100_…`, fixed in `20260401100000_…`, `20260407100000_fix_receive_cafe_stock_profile_lookup.sql`.
Bulk-receives stock from warehouse into the cafe section. `p_items` shape: `[{product_id, quantity}]`. Inserts `stock_movements` (`movement_type='cafe_receive'`) and updates `pos_live_stock`. Resolves auth.uid() → user_profiles.id with PIN-only fallback.
**Consumer**: `src/hooks/pos/useCafeStockReception.ts:33`.

### `finalize_inventory_count(p_count_id UUID) → JSONB`
**Migrations**: `20260208120000_…`, `20260210110001_…`. Finalises a stock-take: creates compensating `stock_movements` (`adjustment_in`/`adjustment_out`) for each variance line, transitions count status `in_progress → finalized`. Triggers JE via the stock-movement trigger.

### `get_unit_conversion_factor(p_product_id UUID, p_from_uom TEXT, p_to_uom TEXT) → NUMERIC`
Resolves a per-product UOM conversion using `product_uoms`.

### `calculate_product_cost(p_product_id UUID) → NUMERIC`
Computes the unit cost for a product from its recipe (sum of `material.cost_price * recipe.quantity`).

### `get_reorder_suggestions_data(p_threshold_days INT DEFAULT 7) → TABLE`
Suggests reorder quantities based on consumption velocity (last 30 days) vs current stock.
**Consumer**: `src/services/inventory/inventoryAlerts.ts:142`.

### `get_production_suggestions_data(...) → TABLE`
Suggests what to produce next based on stock alerts and historical demand.
**Consumer**: `src/services/inventory/inventoryAlerts.ts:199`.

### Production / Receive RPCs (atomic)
- `production_record_create(...)` — `20260502061925_create_production_record_rpc.sql`. Atomic production batch creation: inserts `production_records`, deducts raw materials per recipe, increments finished good stock.
- `receive_purchase_order(p_po_id UUID, p_items JSONB, p_receiver_id UUID DEFAULT NULL) → TABLE` — `20260503002703_create_receive_purchase_order_rpc.sql`. Atomic PO receive: updates `purchase_order_items.quantity_received`, advances PO status (`partially_received` or `received`), inserts `stock_movements` (`purchase`) and history rows.

---

## 9. Reporting RPCs

### `get_pl_monthly_trend(p_months INT) → TABLE(month_label TEXT, revenue NUMERIC, cogs NUMERIC, opex NUMERIC, net_profit NUMERIC)`
**Consumer**: `src/pages/reports/components/PLMonthlyTrendTab.tsx:32`.

### `get_production_efficiency(...) → TABLE`
**Consumer**: `src/pages/reports/components/ProductionEfficiencyTab.tsx:41`.

### `get_production_report(...) → TABLE`
**Consumer**: `src/pages/reports/components/ProductionReportTab.tsx:66`.

### `get_staff_performance_report(p_start DATE, p_end DATE) → TABLE`
**Consumer**: `src/pages/reports/components/StaffPerformanceTab.tsx:25`.

### `get_void_discount_by_staff(p_start DATE, p_end DATE) → TABLE`
**Migration**: refined in `20260414130000_fix_void_discount_by_staff_rpc.sql`.
**Consumer**: `src/pages/reports/components/VoidDiscountByStaffTab.tsx:57`.

### `get_kds_service_speed_stats(...) → TABLE`
KDS performance analytics.

### `get_overdue_invoices() → TABLE`
B2B AR aging.

### `get_sales_comparison(p_period TEXT) → TABLE`
Period-over-period revenue comparison.

### `get_reporting_dashboard_summary() → JSON`
Aggregate snapshot for the reports landing page.

---

## 10. Settings

| RPC | Signature | Purpose |
|-----|-----------|---------|
| `update_setting` | `(p_key TEXT, p_value JSONB, p_updated_by UUID) → JSON` | Updates a single setting; logs to `settings_history` via `settings_sync_on_update` trigger |
| `update_settings_bulk` | `(p_settings JSONB) → JSON` | Bulk-update via `[{key, value}, …]` |
| `reset_setting` | `(p_key TEXT) → JSON` | Resets a single setting to its `default_value` |
| `reset_category_settings` | `(p_category_id UUID) → JSON` | Resets every setting in a category |
| `get_settings_by_category` | `(p_category_slug TEXT) → TABLE` | Lookup by category slug |

**Migrations**: `20260205160000_add_settings_rpc_functions.sql`, `20260212110004_fix_settings_functions_permissions.sql`.

**Consumers**: `src/stores/settings/coreSettingsStore.ts:158, 190, 204, 216`, `src/services/settingsService.ts:63, 73, 82, 91`.

---

## 11. LAN / Devices

| RPC | Purpose |
|-----|---------|
| `register_lan_node(p_node_id, p_device_type, p_ip, p_port, p_metadata)` | Upserts a `lan_nodes` row, sets `status='online'`, updates `last_heartbeat=NOW()` |
| `update_lan_node_heartbeat(p_node_id)` | Refreshes `last_heartbeat`, sets `status='online'` if it was `offline` |
| `mark_stale_lan_nodes_offline()` | Sets nodes whose `last_heartbeat < NOW() - 120s` to `status='offline'` |
| `get_online_lan_nodes()` | Returns rows where `status='online'` |
| `get_lan_hub_node()` | Returns the unique hub row (`is_hub=TRUE`) |

All `SECURITY DEFINER`. Hub-client architecture detail: [../06-lan-architecture/](../06-lan-architecture/).

---

## 12. Imports & Bulk

| RPC | Purpose | Migration |
|-----|---------|-----------|
| `import_customer(p_payload JSONB)` | Idempotent customer upsert by phone or email; returns `{customer_id, action: created|updated|skipped}` | `20260313130000_add_upsert_import_rpcs.sql` |
| `import_supplier(p_payload JSONB)` | Same, by name+phone | `20260313130000_…` |
| `import_purchase_order(...)` | Bulk PO import from CSV | `20260313130000_…` |
| `create_purchase_order(...)` / `update_purchase_order(...)` / `delete_purchase_order_items(...)` | PO CRUD wrappers | `20260204100000_…` |

**Consumers**: `src/services/customers/csvImportService.ts:170`, `src/services/purchasing/supplierImportExportService.ts:221`.

---

## 13. Misc / Internal

| RPC | Purpose |
|-----|---------|
| `next_expense_number()` | Thread-safe expense numbering |
| `get_next_daily_sequence(p_kind TEXT)` | Generic daily sequence using `sequence_tracker` |
| `resolve_mapping_account(p_mapping_key TEXT) → UUID` | Looks up `accounting_mappings.account_code` then `accounts.id` |
| `check_fiscal_period_open(p_date DATE) → BOOLEAN` | Returns TRUE if the fiscal_period for `p_date` is not closed/locked |
| `close_fiscal_year(p_year INT)` | Locks all months for the year + creates closing JE |
| `get_active_users_for_login() → TABLE(id, name, avatar_url, role, …)` | Returns the active-user roster shown on the PIN login screen — bypasses `user_profiles` RLS |

---

## Cross-references

- Tables backing these RPCs: [02-tables-reference.md](02-tables-reference.md)
- Triggers wired to write paths used by these RPCs: [04-triggers.md](04-triggers.md)
- End-to-end flows that orchestrate multiple RPCs: [../08-flows-end-to-end/](../08-flows-end-to-end/)
- Module hooks (`useExpenses`, `useShift`, `useVATManagement`, …): [docs/v2/modules/](../../v2/modules/)
- Edge Functions (different invocation contract): [../05-integrations/](../05-integrations/)
