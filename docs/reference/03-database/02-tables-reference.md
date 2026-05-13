# 02 — Tables Reference

> **Last verified**: 2026-05-03
> **Source of truth**: `src/types/database.generated.ts` (regenerated 2026-05-01) and migrations under `supabase/migrations/`. Use `/gen-types` after every schema change to keep them aligned.
> **Companion**: high-level overview in [01-schema-overview.md](01-schema-overview.md). RPCs in [03-rpc-functions.md](03-rpc-functions.md). Triggers in [04-triggers.md](04-triggers.md).

This file documents the ~92 production tables grouped by domain. Each entry lists the most load-bearing columns; for the exhaustive list always consult `database.generated.ts`. Enums refer to types declared in [`src/types/database.enums.ts`](../../../src/types/database.enums.ts) and migration `001_extensions_enums.sql`.

---

## A. Auth & Users

### `user_profiles`
**Domain**: Auth & Users · **Migration**: `008_users_permissions.sql`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | `gen_random_uuid()` |
| `auth_user_id` | uuid UNIQUE | FK conceptually → `auth.users.id` (Supabase) |
| `name`, `first_name`, `last_name`, `display_name` | varchar | |
| `employee_code` | varchar(20) UNIQUE | |
| `phone`, `email` | varchar | |
| `role` | enum `user_role` | Legacy column kept for back-compat |
| `pin_code` | varchar(10) | **Removed in `20260210100000_remove_plaintext_pin.sql`** — should be NULL in prod |
| `pin_hash` | varchar(255) | bcrypt of PIN |
| `last_login_at`, `failed_login_attempts`, `locked_until` | timestamptz / int | |
| `password_changed_at`, `must_change_password` | | |
| `can_apply_discount`, `can_cancel_order`, `can_access_reports` | bool | Legacy capability flags |
| `preferred_language`, `timezone`, `avatar_url` | | |
| `is_active` | bool | Soft delete |
| `created_at`, `updated_at`, `created_by`, `updated_by` | | |

Indexes: `idx_user_profiles_role`, `idx_user_profiles_active` (partial), `idx_user_profiles_auth` (partial), `idx_user_profiles_employee_code`.
Triggered by: `on_auth_user_created` on `auth.users` → `handle_new_user()` (`20260222035037_…`).

### `roles`
**Domain**: Auth · **Migration**: `008_users_permissions.sql`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `code` | varchar(50) UNIQUE | `SUPER_ADMIN`, `ADMIN`, `MANAGER`, `CASHIER`, … |
| `name_fr`, `name_en`, `name_id` | varchar(100) | Tri-locale |
| `description` | text | |
| `is_system` | bool | System roles cannot be deleted |
| `is_active` | bool | |
| `hierarchy_level` | int | Higher = more privileged |
| `created_at`, `updated_at` | | |

### `permissions`
**Domain**: Auth · **Migration**: `008_users_permissions.sql`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `code` | varchar(100) UNIQUE | Format `module.action` (e.g. `sales.void`) |
| `module` | varchar(50) | `sales`, `inventory`, `accounting`, etc. |
| `action` | varchar(50) | `view`, `create`, `update`, `delete`, `void`, `discount`, `refund`, … |
| `name_fr`, `name_en`, `name_id` | varchar(150) | |
| `description` | text | |
| `is_sensitive` | bool | Triggers extra audit on grant/revoke |

### `role_permissions`
| Column | Type |
|--------|------|
| `id` uuid PK · `role_id` uuid FK → roles · `permission_id` uuid FK → permissions · `granted_at` timestamptz · `granted_by` uuid · UNIQUE(role_id, permission_id) |

### `user_roles`
| Column | Type | Notes |
|--------|------|-------|
| `id` uuid PK · `user_id` uuid FK → user_profiles · `role_id` uuid FK → roles · `valid_from`, `valid_until` timestamptz · `assigned_by` uuid · `created_at` |

### `user_permissions`
Per-user grants/revokes that override the role grant.
Columns: `id` · `user_id` FK · `permission_id` FK · `is_granted` bool · `valid_from`, `valid_until` timestamptz · `granted_by` uuid.

### `user_sessions`
Server-side session token store (since `20260212120000_secure_session_tokens.sql`). Token is hashed via trigger `tr_hash_session_token` (`016_integrity_fixes.sql`).
Columns: `id` · `user_id` FK · `token_hash` varchar · `device_info` jsonb · `ip_address` inet · `user_agent` text · `expires_at` timestamptz · `created_at` · `ended_at` · `end_reason` enum `session_end_reason`.

### `audit_logs`
Append-only. Driven by `audit_trigger_func()` (`20260321160000_…`).
Columns: `id` uuid PK · `user_id` uuid · `action` enum `audit_action` · `module` varchar · `entity_type` varchar · `entity_id` uuid · `old_values` jsonb · `new_values` jsonb · `severity` enum `audit_severity` · `ip_address` inet · `user_agent` text · `created_at`.

---

## B. Catalog (Products / Recipes / Suppliers)

### `categories`
**Migration**: `002_core_products.sql`

| Column | Type | Notes |
|--------|------|-------|
| `id` uuid PK · `name` varchar(100) · `icon` varchar(10) · `color` varchar(7) · `dispatch_station` enum (default `none`) · `is_raw_material` bool · `sort_order` int · `is_active` bool · `created_at`, `updated_at` |

Indexes: `idx_categories_sort`, `idx_categories_active` (partial), `idx_categories_dispatch`.

### `sections`
Logical production / sales sections (`section_type` enum).
Columns: `id` · `name` · `code` UNIQUE · `description` · `is_active` · `sort_order` · `created_at`, `updated_at`.

### `products`
Master catalog. **Heavily-used hot table**.

| Column | Type | Notes |
|--------|------|-------|
| `id` uuid PK · `sku` varchar(50) UNIQUE (auto from uuid) · `name` varchar(200) · `description` text |
| `category_id` uuid FK → categories(id) ON DELETE SET NULL |
| `section_id` uuid FK → sections(id) ON DELETE SET NULL |
| `product_type` enum `product_type` (`finished`/`semi_finished`/`raw_material`) |
| `retail_price`, `wholesale_price`, `cost_price` decimal(12,2) |
| `current_stock`, `min_stock_level` decimal(10,3) · `unit` varchar(20) |
| `deduct_ingredients` bool · `is_made_to_order` bool |
| `pos_visible`, `available_for_sale` bool |
| `image_url` text · `is_active` bool · `created_at`, `updated_at` |

Partial indexes: visible+available, low-stock alert.

### `product_sections`
M:N bridge product ↔ section. Columns: `id` · `product_id` FK · `section_id` FK · `is_primary` bool · UNIQUE(product_id, section_id).

### `product_modifiers`
Variant catalogue (single/multiple groups). Belongs to a product *or* a category (CHECK constraint enforces XOR).
Columns: `id` · `product_id` FK · `category_id` FK · `group_name` · `group_type` enum (`single`/`multiple`) · `group_required` bool · `option_id`, `option_label`, `option_icon` · `price_adjustment` decimal · `is_default` · `option_sort_order` · `is_active`.

### `product_uoms`
Per-product unit-of-measure conversions.
Columns: `id` · `product_id` FK · `uom_name` · `uom_code` · `conversion_factor` decimal(10,4) · `is_base_uom` · `is_purchase_uom` · `is_sale_uom` · `barcode` · `price_override` · UNIQUE(product_id, uom_code).

### `product_types`
Configurable product-type taxonomy. Migration `20260218170000_create_product_types.sql`.
Columns: `id` · `name` · `slug` UNIQUE · `description` · `is_system` · `is_active`.

### `product_price_history`
Audit trail of price changes. Migration `20260221080215_create_product_price_history.sql`.
Columns: `id` · `product_id` FK · `field_name` (`retail_price`/`wholesale_price`/`cost_price`) · `old_value`, `new_value` decimal · `changed_by` uuid · `reason` text · `created_at`.

### `product_category_prices`
Custom prices per `customer_categories`. Migration `003_customers_loyalty.sql`.
Columns: `id` · `product_id` FK · `customer_category_id` FK · `custom_price` decimal · `is_active`.

### `recipes` (BOM)
Columns: `id` · `product_id` FK (the finished good) · `material_id` FK (the raw material) · `quantity` decimal(10,4) · `unit` · `is_active` · UNIQUE(product_id, material_id).

### `suppliers`
Vendor master.
Columns: `id` · `name` · `code` UNIQUE · `contact_person` · `phone`, `email`, `address` · `payment_terms` enum · `bank_account` · `notes` · `is_active`.

---

## C. Customers & Loyalty

### `customer_categories`
**Migration**: `003_customers_loyalty.sql`

| Column | Type | Notes |
|--------|------|-------|
| `id` uuid PK · `name` text · `slug` text UNIQUE · `description` text · `color` text · `icon` text |
| `price_modifier_type` text CHECK ∈ {`retail`,`wholesale`,`custom`,`discount_percentage`} |
| `discount_percentage` numeric(5,2) |
| `loyalty_enabled` bool · `points_per_amount` numeric(10,2) (default 1000) · `points_multiplier` numeric(5,2) |
| `auto_discount_enabled`, `auto_discount_threshold`, `auto_discount_percentage` |
| `sort_order`, `is_default`, `is_active` · `created_at`, `updated_at` |

Drives `get_customer_product_price()` RPC.

### `loyalty_tiers`
Bronze / Silver / Gold / Platinum thresholds.
Columns: `id` · `name` · `slug` · `min_lifetime_points` int · `color` · `icon` · `points_multiplier` · `discount_percentage` · `free_delivery` · `priority_support` · `birthday_bonus_points` · `is_active`.

### `customers`
Customer master with loyalty.

| Column | Type | Notes |
|--------|------|-------|
| `id` uuid PK · `name`, `phone`, `email`, `address` |
| `customer_type` enum `customer_type` (`retail`/`b2b`) · `category_id` FK → customer_categories |
| `loyalty_qr_code` varchar UNIQUE | Generated by `tr_generate_customer_qr_code` (BRK-XXXXXX-YYMM) |
| `loyalty_points`, `lifetime_points` int |
| `total_spent`, `total_visits` numeric/int · `last_visit_at` |
| `birthday`, `gender`, `notes`, `tax_id` |
| `credit_limit`, `credit_status` (since `20260402100000_…`) |
| `is_active` · `created_at`, `updated_at`, `created_by`, `updated_by` |

### `loyalty_transactions`
Append-only ledger.
Columns: `id` · `customer_id` FK · `order_id` FK nullable · `transaction_type` enum `loyalty_transaction_type` (`earn`/`redeem`/`expire`/`adjust`/`bonus`/`refund`) · `points` int (signed) · `points_balance_after` int · `order_amount`, `points_rate`, `multiplier` · `description` · `created_by` uuid · `created_at`.

### `loyalty_rewards`
Catalogue of rewards.
Columns: `id` · `name` · `description` · `points_cost` int · `reward_type` (`discount`/`free_product`/`other`) · `value` decimal · `product_id` FK nullable · `is_active`.

### `loyalty_redemptions`
Per-redemption record.
Columns: `id` · `customer_id` FK · `reward_id` FK · `order_id` FK nullable · `points_used` · `status` (`pending`/`fulfilled`/`cancelled`) · `redeemed_at`.

---

## D. POS & Orders

### `pos_terminals`
**Migration**: `004_sales_orders.sql`
Columns: `id` · `terminal_name` · `device_id` UNIQUE · `is_hub` bool · `location` · `status` · `mode` (`primary`/`secondary`) · `default_printer_id`, `kitchen_printer_id` (FK) · `kds_station` · `allowed_payment_methods` text[] · `default_order_type` · `floor_plan_id` · `auto_logout_timeout` int.

### `pos_sessions`
Cash drawer / shift management.
Columns: `id` · `session_number` UNIQUE (gen by trigger) · `terminal_id` FK · `opened_at`, `opened_by`, `opening_cash`, `opening_cash_details` jsonb · `closed_at`, `closed_by`, `closing_cash`, `closing_cash_details` jsonb · `total_cash_sales`, `total_card_sales`, `total_qris_sales`, `total_edc_sales`, `total_orders`, `total_discounts`, `total_refunds` · `expected_cash`, `cash_difference`, `difference_reason` · `tips_cash`, `tips_card` · `manager_validated`, `manager_id` · `notes` · `status` enum `session_status`.

### `shift_snapshots`
**Migration**: `20260430180000_caissapp_shift_snapshots_and_close_rpc.sql`. Atomic snapshot at close-shift time.
Columns: `id` · `session_id` FK · `snapshot_data` jsonb · `created_at` · `created_by`.

### `orders`
**Heavily-used hot table**. Migration `004_sales_orders.sql`.

| Column | Type | Notes |
|--------|------|-------|
| `id` uuid PK · `order_number` varchar(30) UNIQUE (gen by trigger) |
| `order_type` enum `order_type` · `table_number` varchar(10) |
| `customer_id` uuid FK → customers ON DELETE SET NULL · `customer_name` |
| `status` enum `order_status` (`new`→`preparing`→`ready`→`served`→`completed`/`cancelled`/`voided`) |
| `payment_status` enum `payment_status` (`unpaid`/`partial`/`paid`) |
| `subtotal`, `discount_value`, `discount_amount`, `tax_rate`, `tax_amount`, `total` decimal(12,2) |
| `discount_type` enum `discount_type` · `discount_reason`, `discount_requires_manager`, `discount_manager_id` |
| `payment_method` enum `payment_method` · `payment_details` jsonb · `cash_received`, `change_given` |
| `points_earned`, `points_used` int · `points_discount` decimal |
| `is_offline` bool · `offline_id` · `synced_at` |
| `staff_id` uuid · `session_id` uuid FK → pos_sessions |
| `created_at`, `updated_at`, `completed_at`, `cancelled_at`, `cancelled_by`, `cancellation_reason` |

Triggers: `tr_generate_order_number`, `tr_update_orders_timestamp`, `trg_create_sale_journal_entry` (AFTER UPDATE OF status), `tr_deduct_stock_on_sale_*` (3 variants), `audit_orders`.

### `order_items`
Columns: `id` · `order_id` FK ON DELETE CASCADE · `product_id` FK SET NULL · `product_name`, `product_sku` (denormalised) · `combo_id` varchar nullable · `quantity` decimal · `unit_price`, `modifiers_total`, `total_price` decimal · `modifiers` jsonb · `selected_variants` jsonb · `combo_selections` jsonb · `item_status` enum `item_status` · `dispatch_station` enum `dispatch_station` · `is_locked` bool (PIN required to modify) · `sent_to_kitchen_at`, `prepared_at`, `prepared_by`.

### `order_payments`
Split-payment ledger (one row per method).
Columns: `id` · `order_id` FK · `payment_method` enum · `amount` decimal(12,2) · `cash_received` decimal · `change_given` decimal · `transaction_ref` varchar · `status` (`pending`/`completed`/`failed`/`refunded`) · `created_at` · `created_by`.

### `order_payment_items`
**Migration**: `20260331100000_split_payment_by_item.sql`. Allocates a payment to specific order_items.
Columns: `id` · `payment_id` FK → order_payments · `order_item_id` FK · `amount` decimal.

### `order_activity_log`
**Migration**: `20260311100000_create_order_activity_log.sql`. Action log for an order (void, discount, refund, send-to-kitchen). Extended in `20260401120000_extend_order_activity_log_actions.sql`.
Columns: `id` · `order_id` FK · `action` varchar · `actor_id` uuid · `metadata` jsonb · `created_at`.

### `floor_plan_items`
Tables / seats for dine-in.
Columns: `id` · `name` · `x`, `y`, `width`, `height` decimal · `seats` int · `floor_plan_id` uuid · `shape` (`square`/`round`) · `is_active`.

---

## E. Inventory & Stock

### `stock_locations`
**Migration**: `005_inventory_stock.sql`
Columns: `id` · `name` · `code` UNIQUE · `location_type` enum `location_type` · `parent_id` FK self · `is_default` · `is_active`.

### `stock_movements`
**Append-only ledger**. Hot table.

| Column | Type | Notes |
|--------|------|-------|
| `id` uuid PK · `movement_id` varchar(30) UNIQUE (gen by trigger) |
| `product_id` uuid FK → products ON DELETE CASCADE |
| `movement_type` enum `movement_type` |
| `from_location_id`, `to_location_id` uuid FK → stock_locations |
| `quantity` decimal(10,3) (signed) · `unit_cost` decimal(12,2) |
| `reference_type` varchar (`order`/`po`/`production`/…) · `reference_id` uuid |
| `stock_before`, `stock_after` decimal(10,3) (set by `record_stock_before_after` BEFORE INSERT trigger) |
| `reason` text · `staff_id` uuid · `batch_number` · `expiry_date` |
| `created_at` |

Triggers: `tr_record_stock_before_after` (BEFORE), `tr_update_product_stock` (AFTER), `audit_stock_movements`, `create_stock_movement_journal_entry` (AFTER, see `20260402110000_…`).

### `section_stock`
Per-(product, section) cache. Maintained by `trg_sync_product_stock` trigger.
Columns: `id` · `product_id` FK · `section_id` FK · `current_stock` decimal · `updated_at` · UNIQUE(product_id, section_id).

### `production_records`
Production batch register.
Columns: `id` · `production_id` UNIQUE (gen by trigger) · `product_id` FK · `section_id` FK · `quantity_produced`, `quantity_waste` decimal · `production_date` date · `staff_id`, `staff_name` · `stock_updated`, `materials_consumed` bool · `notes` · `created_at`, `updated_at`.

Now created atomically via RPC `production_record_create` (migration `20260502061925_create_production_record_rpc.sql`).

### `inventory_counts`
Stock-take headers.
Columns: `id` · `count_number` UNIQUE (gen by trigger) · `count_date` date · `section_id` FK nullable · `status` enum `count_status` · `started_by`, `started_at`, `finalized_by`, `finalized_at`, `validated_by`, `validated_at` · `notes`.

### `inventory_count_items`
Count lines.
Columns: `id` · `count_id` FK · `product_id` FK · `system_qty`, `physical_qty`, `variance` decimal · `unit_cost` decimal · `reason` text.

Finalisation via `finalize_inventory_count(p_count_id)` RPC (migrations `20260208120000_…`, `20260210110001_…`).

### `internal_transfers`
Inter-section transfers.
Columns: `id` · `transfer_number` UNIQUE (gen by trigger) · `from_section_id`, `to_section_id` FK · `status` enum `transfer_status` · `notes` · `created_by`, `received_by` · timestamps.

### `transfer_items`
Lines per transfer. `id` · `transfer_id` FK · `product_id` FK · `quantity` decimal · `received_quantity`. Trigger `trg_update_transfer_totals` recalcs the header (migration `20260203120000_…`).

### `pos_live_stock`
Live cafe-section stock board (`/pos/live-stock`).
**Migration**: `20260330500000_pos_live_stock_schema.sql`.
Columns: `id` · `product_id` FK · `current_stock` decimal · `updated_at` · `last_movement_id` FK.

### `payment_incidents`
**Migration**: `20260428185000_create_payment_incidents.sql`. Logs incidents during checkout (failed EDC, mismatched cash, etc.).
Columns: `id` · `order_id` FK · `payment_method` · `amount` decimal · `incident_type` · `description` · `recorded_by` uuid · `recorded_at`.

### `sequence_tracker`
Daily counter table for thread-safe receipt / PO / transfer numbering. Migration `20260212130000_thread_safe_invoice_number.sql`.
Columns: `id` · `kind` varchar · `seq_date` date · `last_value` int · UNIQUE(kind, seq_date).

---

## F. Purchasing

### `purchase_orders`
Migrations: `005_inventory_stock.sql` (initial), `20260204100000_fix_missing_functions_and_views.sql` (refit).

| Column | Type | Notes |
|--------|------|-------|
| `id` uuid PK · `po_number` varchar(30) UNIQUE (gen by trigger) |
| `supplier_id` uuid FK → suppliers |
| `status` enum `po_status` (`draft`/`sent`/`confirmed`/`partially_received`/`received`/`cancelled`/`modified`) |
| `payment_status` enum `po_payment_status` |
| `order_date`, `expected_date`, `received_date` |
| `subtotal`, `tax_rate`, `tax_amount`, `total_amount` decimal(12,2) |
| `expense_type` (`ingredients`/`raw_materials`/`packaging`/`equipment`/...) |
| `created_by`, `received_by`, `cancelled_by` uuid · `notes` |
| `created_at`, `updated_at` |

Triggers: `tr_generate_po_number`, `tr_update_purchase_orders_timestamp`, `trg_create_purchase_journal_entry` (AFTER UPDATE → status='received'), `audit_purchase_orders`.

### `purchase_order_items`
Columns: `id` · `purchase_order_id` FK · `product_id` FK · `quantity_ordered`, `quantity_received` decimal(10,3) · `unit_cost` decimal(12,2) · `total_cost` · `notes`.

Triggers: `purchase_order_items_insert_trigger`, `_update_trigger`, `_delete_trigger` recompute PO totals (migration `20260204100000_…`).

### `purchase_order_history`
Status changelog.
Columns: `id` · `po_id` FK · `action` enum `po_history_action` · `actor_id` uuid · `metadata` jsonb · `created_at`.

### `purchase_order_returns`
Returned items.
Columns: `id` · `po_id` FK · `product_id` FK · `quantity` decimal · `reason` · `returned_by` uuid · `returned_at`.

### `po_attachments`
Storage refs.
Columns: `id` · `po_id` FK · `file_path` text (Supabase Storage path) · `file_name` · `mime_type` · `uploaded_by` · `uploaded_at`.

---

## G. B2B & Wholesale

### `b2b_orders`
**Migration**: `007_b2b_wholesale.sql`.

| Column | Type | Notes |
|--------|------|-------|
| `id` uuid PK · `order_number` UNIQUE (gen by trigger) |
| `customer_id` uuid FK → customers |
| `status` enum `b2b_status` |
| `payment_terms` enum `payment_terms` |
| `delivery_status` enum `b2b_delivery_status` |
| `subtotal`, `discount_amount`, `tax_amount`, `total_amount`, `paid_amount` decimal |
| `expected_delivery_date`, `actual_delivery_date` |
| `notes`, `internal_notes` text |
| timestamps + actors |

Triggers: `tr_generate_b2b_order_number`, `tr_update_b2b_totals_on_items` (AFTER on b2b_order_items), `tr_update_b2b_totals_on_payments`.

### `b2b_order_items`
Columns: `id` · `b2b_order_id` FK · `product_id` FK · `quantity_ordered`, `quantity_delivered` decimal · `unit_price`, `total_price` decimal · `notes`.

### `b2b_payments`
Columns: `id` · `payment_number` UNIQUE (gen by trigger) · `b2b_order_id` FK · `amount` decimal · `payment_method` enum · `payment_date` · `reference` · `notes` · `created_by`.

### `b2b_deliveries`
Delivery slips.
Columns: `id` · `delivery_number` UNIQUE (gen by trigger) · `b2b_order_id` FK · `status` enum · `scheduled_date`, `delivered_at` · `driver_name`, `vehicle` · `notes`.

### `b2b_price_lists`, `b2b_price_list_items`, `b2b_customer_price_lists`
Named price lists with per-product overrides and customer assignments. Standard FK columns + `is_active` + `valid_from`/`valid_until`.

---

## H. Combos & Promotions

### `product_combos`, `product_combo_groups`, `product_combo_group_items`, `product_combo_items`
**Migration**: `006_combos_promotions.sql`. Combo header + selection groups + eligible products + fixed items. Standard `id`/`name`/`price`/`is_active` columns.

### `promotions`
Columns: `id` · `name` · `code` UNIQUE · `promotion_type` enum `promotion_type` (`percentage`/`fixed_amount`/`buy_x_get_y`/`free_product`) · `discount_value` decimal · `min_order_amount` decimal · `max_discount_amount` decimal · `valid_from`, `valid_until` · `usage_limit`, `usage_count` int · `is_active` · timestamps.

### `promotion_products`
Eligibility scope. Columns: `id` · `promotion_id` FK · `product_id` FK nullable · `category_id` FK nullable.

### `promotion_free_products`
Auto-included free items. Columns: `id` · `promotion_id` FK · `product_id` FK · `quantity`.

### `promotion_usage`
Per-order usage. Columns: `id` · `promotion_id` FK · `order_id` FK · `discount_applied` decimal · `created_at`.

---

## I. Accounting

### `accounts` (Chart of Accounts)
**Migration**: `20260323100200_create_accounting_tables.sql`.

| Column | Type | Notes |
|--------|------|-------|
| `id` uuid PK · `code` varchar UNIQUE | E.g. `1110` Cash, `2110` PB1 Payable, `4100` Sales |
| `name` varchar | |
| `account_class` int | 1=Asset, 2=Liability, 3=Equity, 4=Revenue, 5=COGS, 6=Expense |
| `account_type` varchar | `asset`, `liability`, `equity`, `revenue`, `expense` |
| `balance_type` varchar | `debit` / `credit` |
| `parent_id` uuid FK self ON DELETE **RESTRICT** (since `20260330600300_…`) |
| `level` int · `node_type` varchar · `is_postable`, `is_system`, `is_active` bool |
| `created_at`, `updated_at` |

### `accounting_mappings`
Logical key → account_code lookup (e.g. `WASTE_EXPENSE` → 5300).
Columns: `id` · `mapping_key` varchar UNIQUE · `account_code` varchar · `description` · `is_active` · timestamps.
Resolved by RPC `resolve_mapping_account(p_key)`.

### `journal_entries`
| Column | Type | Notes |
|--------|------|-------|
| `id` uuid PK · `entry_number` varchar UNIQUE (format `JE-YYYYMMDD-NNNN`) |
| `entry_date` date · `description` text |
| `reference_type` varchar (`sale`, `purchase`, `expense`, `void`, `production`, `waste`, `adjustment`, `manual`) |
| `reference_id` uuid (or text for some triggers) |
| `status` varchar (`draft`/`posted`/`locked`) — transitions enforced by `trg_enforce_journal_status` |
| `total_debit`, `total_credit` decimal(15,2) |
| `created_by` uuid · timestamps |

### `journal_entry_lines`
Columns: `id` · `journal_entry_id` FK ON DELETE CASCADE · `account_id` FK → accounts · `debit`, `credit` decimal(15,2) · `description` · `created_at`. Constraint: exactly one of debit/credit > 0.

### `general_ledger`
Materialised view of journal_entry_lines joined with accounts. Refreshed by trigger on JE post.

### `vat_filings`
Monthly PB1 (Pajak Restoran 10%) filings.
Columns: `id` · `period_year` int · `period_month` int · `status` (`draft`/`filed`/`amended`) · `total_collected`, `total_deductible`, `total_payable` decimal · `filed_at`, `filed_by` · `notes` · UNIQUE(period_year, period_month).

### `fiscal_periods`
Year/month with status (`open`/`closed`/`locked`). Status transitions enforced by `trg_enforce_fiscal_period_status` (`20260330600300_…`).
Columns: `id` · `year` int · `month` int · `status` · `closed_at`, `closed_by`, `locked_at`, `locked_by` · UNIQUE(year, month).

### `expenses`
Operational expenses.

| Column | Type | Notes |
|--------|------|-------|
| `id` uuid PK · `expense_number` varchar UNIQUE (`next_expense_number()` RPC) |
| `category_id` uuid FK → expense_categories |
| `amount`, `tax_amount`, `total_amount` decimal(12,2) |
| `payment_method` varchar (`cash`/`bank`/...) |
| `description` text · `expense_date` date |
| `status` varchar (`pending`/`approved`/`rejected`/`paid`) |
| `submitted_by`, `approved_by`, `approved_at`, `paid_at` |
| `attachment_path` text · `created_at`, `updated_at` |

Approval triggers JE creation via RPC `approve_expense_with_journal` (atomic).

### `expense_categories`
Columns: `id` · `name` · `code` UNIQUE · `account_id` uuid FK → accounts · `requires_approval` bool · `is_active`.

### `bank_statements`
Imported bank statement headers.
Columns: `id` · `account_id` FK → accounts · `statement_date` · `start_balance`, `end_balance` decimal · `imported_by` · `imported_at`.

### `bank_statement_lines`
Imported lines.
Columns: `id` · `statement_id` FK · `transaction_date` · `description` · `amount` decimal (signed) · `reference` · `is_reconciled` bool · `matched_je_id` uuid FK nullable.

### `reconciliation_adjustments`
Manual adjustments during bank reconciliation.
Columns: `id` · `statement_id` FK · `account_id` FK · `amount` decimal · `description` · `created_by` · `created_at`.

---

## J. Settings & System

### `settings`
**Migration**: `009_system_settings.sql`. Single source for all configurable parameters.
Columns: `id` · `key` varchar UNIQUE · `category_id` FK → settings_categories · `value` jsonb · `value_type` varchar · `default_value` jsonb · `description` · `is_system` · `is_active` · `updated_by` · timestamps.

Driven by RPCs: `update_setting`, `update_settings_bulk`, `reset_setting`, `reset_category_settings`, `get_settings_by_category`. Audited via trigger `settings_sync_on_update` → `settings_history` (`20260428190000_…`).

### `settings_categories`
Columns: `id` · `name` · `slug` UNIQUE · `description` · `icon` · `sort_order` · `is_active`.

### `settings_history`
Append-only history of every change. Columns: `id` · `setting_id` FK · `old_value`, `new_value` jsonb · `changed_by` uuid · `changed_at`.

### `business_config`
Single-row company info. Columns: `id` · `business_name` · `legal_name` · `npwp` · `address` · `phone`, `email`, `website` · `currency` (`IDR`) · `default_tax_rate` decimal · `logo_url` · timestamps.

### `business_hours`
Per-day open/close hours. Columns: `id` · `day_of_week` int (0–6) · `open_time`, `close_time` time · `is_closed` bool.

### `tax_rates`
Active and historical tax rates. Columns: `id` · `name` · `code` UNIQUE · `rate` decimal(5,4) · `is_inclusive` bool · `is_default` · `valid_from`, `valid_until` · `is_active`.

### `payment_methods`
Configured payment methods + accounting accounts.
Columns: `id` · `code` enum `payment_method` · `display_name` · `is_active` · `requires_reference` bool · `account_id` uuid FK → accounts · `sort_order`.

### `pos_config`
POS-specific behaviour flags (singleton row keyed by `id`).
Columns: `id` · `session_timeout_minutes` int · `auto_logout_enabled` · `display_timeout_seconds` · `cash_drawer_alert_threshold` decimal · `printer_retry_count` int · `enable_offline_mode` · `enable_kitchen_print` · …

### `printer_configurations`
Per-device printer config.
Columns: `id` · `name` · `printer_type` (`receipt`/`kitchen`/`barista`/`label`) · `connection_type` (`network`/`usb`/`bluetooth`) · `ip_address` inet · `port` int · `paper_width` int · `is_default` · `is_active` · `terminal_id` FK nullable.

### `terminal_settings` (legacy)
Per-terminal scoped overrides. Being migrated into `device_configurations`. Columns: `id` · `terminal_id` FK · `key` · `value` jsonb · timestamps.

### `sound_assets`
Notification sounds.
Columns: `id` · `name` · `key` UNIQUE · `file_url` text · `is_default` · `is_active`.

---

## K. LAN / Hub-Client / Devices

### `lan_nodes`
Runtime registry of online nodes (KDS, displays, tablets, mobile).
**Migration**: `010_lan_sync_display.sql`.
Columns: `id` · `node_id` varchar UNIQUE · `device_type` enum `device_type` (`desktop`/`tablet`/`pos`/`mobile`/`kds`/`display`) · `status` enum `lan_node_status` (`online`/`offline`/`connecting`) · `is_hub` bool · `ip_address` inet · `port` int · `last_heartbeat` timestamptz · `metadata` jsonb · timestamps.

Heartbeat staleness handled by RPC `mark_stale_lan_nodes_offline` (cron-style). Threshold 120 s.

### `device_configurations`
**Migration**: `20260330800000_create_device_configurations.sql`. Persistent per-device key-value config (replaces `terminal_settings`).
Columns: `id` · `device_id` varchar · `key` varchar · `value` jsonb · `category` varchar · `updated_by` uuid · timestamps · UNIQUE(device_id, key).

### `kds_stations`
Kitchen-display routing.
Columns: `id` · `name` · `dispatch_station` enum (`barista`/`kitchen`/`display`/`none`) · `terminal_id` FK · `is_active` · `notes`.

### `printer_configurations` (also Domain J)
### `pos_terminals` (also Domain D)
### `floor_plan_items` (also Domain D)

---

## L. Misc / Idempotency

### `idempotency_keys`
**Migration**: `20260211100000_create_idempotency_keys.sql`. Used by `complete_order_with_payments` (since `20260429234000_add_idempotency_to_complete_order_rpc.sql`).
Columns: `id` · `key` varchar UNIQUE · `endpoint` · `request_hash` · `response_data` jsonb · `expires_at` · `created_at`.

### `b2b_order_history`
Migration `20260206100000_create_b2b_order_history.sql`. Status changelog of B2B orders. Columns: `id` · `b2b_order_id` FK · `action` · `actor_id` uuid · `metadata` jsonb · `created_at`.

---

## M. Reporting Views (read-only)

These appear in `database.generated.ts` because they are queryable like tables. They are **views**, not tables, and most are RLS-protected via the underlying table policies. The complete catalogue is in [01-schema-overview.md §5](01-schema-overview.md). Key examples:

| View | Purpose |
|------|---------|
| `view_daily_kpis` | Daily revenue, orders, AOV |
| `view_hourly_sales` | Sales by hour (WITA timezone since `20260414100100_…`) |
| `view_payment_method_stats` | Payment method breakdown (uses `order_payments`) |
| `view_pos_outstanding` / `_history` | Unpaid orders pending payment |
| `view_inventory_valuation` | Stock × cost = inventory value |
| `view_stock_alerts` / `_warning` / `_waste` | Stock alerts & waste |
| `view_session_cash_balance` / `_discrepancies` / `_summary` | Cash drawer reconciliation |
| `view_profit_loss`, `view_ar_aging` | Accounting reports |
| `view_customer_insights`, `view_sales_by_customer`, `view_sales_by_hour` | Customer & sales analytics |
| `view_product_sales`, `view_unsold_products`, `view_category_sales` | Product analytics |
| `view_production_summary` | Production analytics |
| `view_kds_queue_status` | Live KDS queue snapshot |
| `view_order_type_distribution` | Dine-in / takeaway / delivery / b2b mix |
| `view_section_stock_details`, `view_expired_stock` | Section & expiry views |
| `order_search_view` | Global order search (since `20260501000000_…`) |
| `v_*` (12 views) | Auth-filtered passthrough used by all UI list pages |

Total: 30+ views. See `database.generated.ts` for column shape (auto-derived from view definitions).

---

## N. Cross-references

- Schema overview & domain map: [01-schema-overview.md](01-schema-overview.md)
- RPC functions: [03-rpc-functions.md](03-rpc-functions.md)
- Triggers and trigger-driven flows: [04-triggers.md](04-triggers.md)
- Module specs: [../04-modules/](../04-modules/) — each module's "Tables" section provides a higher-level narrative
- End-to-end flows (POS sale, refund, PO receive…): [../08-flows-end-to-end/](../08-flows-end-to-end/)
- Conventions: [../11-conventions/](../11-conventions/)
